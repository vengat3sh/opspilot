"""Controlled developer tools with path validation, approvals and audit logs."""
from __future__ import annotations

import difflib
import json
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth.service import log_audit
from ..config import Settings
from ..db.models import Project, ToolOperation, User
from ..schemas import ToolExecuteRequest, ToolOperationOut
from .projects import (
    assert_project_access,
    list_project_files,
    list_project_tree,
    read_project_file,
    resolve_project_root,
)
from .sandbox import run_in_sandbox, sandbox_available

READ_ONLY_TOOLS = {
    "project.tree",
    "project.list_files",
    "project.search_files",
    "project.read_file",
    "project.inspect_dependencies",
    "git.status",
    "git.diff",
    "git.log",
}
APPROVAL_TOOLS = {
    "project.propose_patch",
    "project.write_file",
    "project.run_tests",
    "project.run_build",
    "sandbox.command",
    "git.commit",
    "git.push",
    "deploy.trigger",
    "db.query",
}
UNAVAILABLE_TOOLS = {"git.commit", "git.push", "deploy.trigger", "db.query"}
SENSITIVE_KEYS = {"password", "secret", "token", "api_key", "apikey", "authorization", "cookie", "credential"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: ("[REDACTED]" if any(s in key.lower() for s in SENSITIVE_KEYS) else _redact(val))
            for key, val in value.items()
        }
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value


def operation_to_out(op: ToolOperation) -> ToolOperationOut:
    return ToolOperationOut(
        id=op.id,
        user_id=op.user_id,
        project_id=op.project_id,
        conversation_id=op.conversation_id,
        tool_name=op.tool_name,
        action=op.action,
        risk_level=op.risk_level,
        status=op.status,
        requires_approval=op.requires_approval,
        input=op.input_json,
        output=op.output_json,
        error_message=op.error_message,
        created_at=op.created_at,
        approved_at=op.approved_at,
        executed_at=op.executed_at,
    )


def _new_operation(
    db: Session,
    user: User,
    req: ToolExecuteRequest,
    *,
    risk_level: str,
    requires_approval: bool,
    status_value: str,
) -> ToolOperation:
    op = ToolOperation(
        user_id=user.id,
        project_id=req.project_id,
        conversation_id=req.conversation_id,
        tool_name=req.tool,
        action=req.tool,
        risk_level=risk_level,
        status=status_value,
        requires_approval=requires_approval,
        input_json=_redact(req.input),
    )
    db.add(op)
    db.commit()
    db.refresh(op)
    return op


def _finish(
    db: Session,
    op: ToolOperation,
    *,
    status_value: str,
    output: dict | None = None,
    error: str | None = None,
) -> ToolOperation:
    op.status = status_value
    op.output_json = output
    op.error_message = (error or "")[:4000] or None
    op.executed_at = _now() if status_value in {"completed", "failed", "unavailable"} else op.executed_at
    op.updated_at = _now()
    db.commit()
    db.refresh(op)
    return op


def _safe_git(root: Path, args: list[str], timeout: int = 15) -> dict:
    git = "git"
    try:
        result = subprocess.run(
            [git, *args],
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"ok": False, "error": f"Git command failed: {type(exc).__name__}"}
    return {
        "ok": result.returncode == 0,
        "returncode": result.returncode,
        "stdout": (result.stdout or "")[-20_000:],
        "stderr": (result.stderr or "")[-4000:],
    }


def _read_manifest(db: Session, user: User, project: Project, settings: Settings) -> dict:
    files = list_project_files(db, user, project.id, limit=500)
    manifests = [
        f for f in files
        if f.path.split("/")[-1] in {
            "requirements.txt", "pyproject.toml", "package.json", "pnpm-lock.yaml",
            "yarn.lock", "Dockerfile", "docker-compose.yml", "go.mod", "Cargo.toml",
            "pom.xml", "build.gradle", ".nvmrc", "runtime.txt",
        }
    ]
    return {
        "manifests": [
            {"path": f.path, "excerpt": (f.excerpt or "")[:3000]}
            for f in manifests[:20]
        ],
        "note": "Manifest excerpts come from the authorized repository index." if manifests else "No package manifests were found in the indexed files.",
    }


def _execute_read_only(
    db: Session,
    user: User,
    project: Project,
    req: ToolExecuteRequest,
    settings: Settings,
) -> dict:
    tool = req.tool
    data = req.input or {}
    if tool == "project.tree":
        return {"items": list_project_tree(db, user, project.id, limit=int(data.get("limit", 500)))}
    if tool == "project.list_files":
        rows = list_project_files(db, user, project.id, q=data.get("q"), limit=int(data.get("limit", 100)))
        return {"items": [{"path": r.path, "size_bytes": r.size_bytes, "language": r.language} for r in rows]}
    if tool == "project.search_files":
        q = str(data.get("q") or "").strip()
        if not q:
            raise HTTPException(status_code=422, detail="search_files requires a non-empty 'q'")
        rows = list_project_files(db, user, project.id, q=q, limit=int(data.get("limit", 50)))
        return {"query": q, "items": [{"path": r.path, "size_bytes": r.size_bytes, "excerpt": (r.excerpt or "")[:800]} for r in rows]}
    if tool == "project.read_file":
        path = str(data.get("path") or "").strip()
        if not path:
            raise HTTPException(status_code=422, detail="read_file requires 'path'")
        row = read_project_file(db, user, project.id, path, settings)
        return {
            "path": row.path,
            "size_bytes": row.size_bytes,
            "language": row.language,
            "content": (row.excerpt or "")[: settings.project_index_excerpt_chars],
            "indexed": row.indexed,
        }
    if tool == "project.inspect_dependencies":
        return _read_manifest(db, user, project, settings)
    root = resolve_project_root(settings, project)
    if tool == "git.status":
        return _safe_git(root, ["status", "--porcelain=v1", "--branch"])
    if tool == "git.diff":
        path = str(data.get("path") or "").strip()
        args = ["diff", "--stat", "--"]
        if path:
            args.append(path)
        return _safe_git(root, args)
    if tool == "git.log":
        count = max(1, min(int(data.get("limit", 20)), 100))
        return _safe_git(root, ["log", "--oneline", "-n", str(count)])
    raise HTTPException(status_code=404, detail="Unknown tool")


def _propose_patch(db: Session, user: User, project: Project, req: ToolExecuteRequest, settings: Settings) -> dict:
    data = req.input or {}
    path = str(data.get("path") or "").strip()
    proposed = data.get("content")
    if not path or not isinstance(proposed, str):
        raise HTTPException(status_code=422, detail="propose_patch requires 'path' and string 'content'")
    current_row = read_project_file(db, user, project.id, path, settings)
    current = current_row.excerpt or ""
    diff = "".join(difflib.unified_diff(
        current.splitlines(keepends=True),
        proposed.splitlines(keepends=True),
        fromfile=f"a/{path}",
        tofile=f"b/{path}",
    ))
    return {
        "path": path,
        "diff": diff[:30_000],
        "requires_approval": True,
        "note": "No file has been modified. Apply this patch through the approval workflow.",
    }


def _apply_write(db: Session, user: User, project: Project, op: ToolOperation, settings: Settings) -> dict:
    data = op.input_json or {}
    path = str(data.get("path") or "").strip()
    content = data.get("content")
    if not path or not isinstance(content, str):
        raise HTTPException(status_code=422, detail="write_file requires 'path' and string 'content'")
    root = resolve_project_root(settings, project)
    target = (root / path.replace("\\", "/").lstrip("/")).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Path escapes the authorized project root") from exc
    if target.is_dir():
        raise HTTPException(status_code=400, detail="Target is a directory")
    if len(content.encode("utf-8")) > settings.project_max_file_bytes:
        raise HTTPException(status_code=413, detail="Proposed file exceeds PROJECT_MAX_FILE_BYTES")
    backup = target.with_name(target.name + ".opspilot.bak")
    if target.exists():
        backup.write_bytes(target.read_bytes())
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return {
        "path": path,
        "bytes_written": len(content.encode("utf-8")),
        "backup_path": str(backup.relative_to(root)) if backup.exists() else None,
        "note": "File write completed inside the authorized workspace. Review the backup and diff before committing.",
    }


def execute_tool(
    db: Session,
    user: User,
    req: ToolExecuteRequest,
    settings: Settings,
) -> ToolOperationOut:
    project = assert_project_access(db, user, req.project_id)
    if req.tool not in READ_ONLY_TOOLS and req.tool not in APPROVAL_TOOLS:
        raise HTTPException(status_code=404, detail="Unknown tool")

    if req.tool in READ_ONLY_TOOLS:
        op = _new_operation(db, user, req, risk_level="low", requires_approval=False, status_value="running")
        try:
            output = _execute_read_only(db, user, project, req, settings)
            op = _finish(db, op, status_value="completed", output=output)
            log_audit(db, user.id, "tool.execute", "tool_operation", str(op.id), None, {"tool": req.tool, "project_id": str(project.id)})
            return operation_to_out(op)
        except HTTPException as exc:
            op = _finish(db, op, status_value="failed", error=str(exc.detail))
            log_audit(db, user.id, "tool.execute.failed", "tool_operation", str(op.id), None, {"tool": req.tool, "project_id": str(project.id), "error": str(exc.detail)[:300]})
            raise
        except Exception as exc:
            op = _finish(db, op, status_value="failed", error=f"Tool execution failed: {type(exc).__name__}")
            log_audit(db, user.id, "tool.execute.failed", "tool_operation", str(op.id), None, {"tool": req.tool, "project_id": str(project.id), "error": type(exc).__name__})
            raise HTTPException(status_code=500, detail="Tool execution failed") from exc

    if req.tool in UNAVAILABLE_TOOLS:
        op = _new_operation(db, user, req, risk_level="high", requires_approval=True, status_value="unavailable")
        op.error_message = "This integration is not connected. Configure the provider before requesting execution."
        db.commit()
        log_audit(db, user.id, "tool.unavailable", "tool_operation", str(op.id), None, {"tool": req.tool})
        return operation_to_out(op)

    if req.tool == "project.propose_patch":
        op = _new_operation(db, user, req, risk_level="medium", requires_approval=False, status_value="running")
        try:
            output = _propose_patch(db, user, project, req, settings)
            op = _finish(db, op, status_value="completed", output=output)
            log_audit(db, user.id, "tool.patch.proposed", "tool_operation", str(op.id), None, {"tool": req.tool, "path": req.input.get("path")})
            return operation_to_out(op)
        except HTTPException as exc:
            _finish(db, op, status_value="failed", error=str(exc.detail))
            raise

    # Consequential tools require explicit approval. Execution is never
    # attempted here, and sandbox-dependent tools are marked unavailable when
    # Docker is absent rather than falling back to the host.
    if req.tool in {"project.run_tests", "project.run_build", "sandbox.command"}:
        available, reason = sandbox_available(settings)
        if not available:
            op = _new_operation(db, user, req, risk_level="high", requires_approval=True, status_value="unavailable")
            op.error_message = reason
            db.commit()
            log_audit(db, user.id, "tool.unavailable", "tool_operation", str(op.id), None, {"tool": req.tool, "reason": reason})
            return operation_to_out(op)
    op = _new_operation(db, user, req, risk_level="high", requires_approval=True, status_value="pending_approval")
    log_audit(db, user.id, "tool.approval.requested", "tool_operation", str(op.id), None, {"tool": req.tool, "project_id": str(project.id)})
    return operation_to_out(op)


def list_operations(
    db: Session,
    user: User,
    *,
    conversation_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    limit: int = 50,
) -> list[ToolOperationOut]:
    stmt = select(ToolOperation).where(ToolOperation.user_id == user.id)
    if conversation_id:
        stmt = stmt.where(ToolOperation.conversation_id == conversation_id)
    if project_id:
        stmt = stmt.where(ToolOperation.project_id == project_id)
    rows = db.execute(stmt.order_by(ToolOperation.created_at.desc()).limit(max(1, min(limit, 200)))).scalars().all()
    return [operation_to_out(row) for row in rows]


def approve_operation(
    db: Session,
    user: User,
    operation_id: uuid.UUID,
    action: str,
    notes: str | None,
    settings: Settings,
) -> ToolOperationOut:
    op = db.get(ToolOperation, operation_id)
    if not op or (op.user_id != user.id and not _is_admin(db, user)):
        raise HTTPException(status_code=404, detail="Tool operation not found")
    if op.status not in {"pending_approval", "unavailable"}:
        raise HTTPException(status_code=409, detail=f"Operation is not awaiting approval ({op.status})")
    if action == "reject":
        op.status = "rejected"
        op.approved_by_user_id = user.id
        op.approved_at = _now()
        op.error_message = (notes or "Rejected by user")[:4000]
        op.updated_at = _now()
        db.commit()
        log_audit(db, user.id, "tool.approval.rejected", "tool_operation", str(op.id), None, {"tool": op.tool_name})
        db.refresh(op)
        return operation_to_out(op)

    if not op.project_id:
        raise HTTPException(status_code=409, detail="Operation has no project target")
    project = assert_project_access(db, user, op.project_id)
    op.approved_by_user_id = user.id
    op.approved_at = _now()
    op.status = "running"
    op.updated_at = _now()
    db.commit()

    try:
        if op.tool_name == "project.write_file":
            output = _apply_write(db, user, project, op, settings)
        elif op.tool_name in {"project.run_tests", "project.run_build", "sandbox.command"}:
            available, reason = sandbox_available(settings)
            if not available:
                _finish(db, op, status_value="unavailable", error=reason)
                log_audit(db, user.id, "tool.execution.unavailable", "tool_operation", str(op.id), None, {"tool": op.tool_name, "reason": reason})
                return operation_to_out(op)
            data = op.input_json or {}
            root = resolve_project_root(settings, project)
            if op.tool_name == "project.run_tests":
                command = data.get("command") or ["python", "-m", "pytest", "-q"]
            elif op.tool_name == "project.run_build":
                command = data.get("command") or ["npm", "run", "build"]
            else:
                command = data.get("command")
            if not isinstance(command, list) or not all(isinstance(part, str) for part in command):
                raise HTTPException(status_code=422, detail="Sandbox command must be an array of strings")
            result = run_in_sandbox(settings, root, command)
            output = {
                "available": result.available,
                "returncode": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "timed_out": result.timed_out,
                "message": result.message,
            }
            _finish(db, op, status_value="completed" if result.returncode == 0 else "failed", output=output, error=None if result.returncode == 0 else result.message)
            log_audit(db, user.id, "tool.execution.completed", "tool_operation", str(op.id), None, {"tool": op.tool_name, "returncode": result.returncode})
            return operation_to_out(op)
        else:
            _finish(db, op, status_value="unavailable", error="This operation is not connected to a provider.")
            return operation_to_out(op)
        op.status = "completed"
        op.output_json = output
        op.executed_at = _now()
        op.updated_at = _now()
        db.commit()
        db.refresh(op)
        log_audit(db, user.id, "tool.execution.completed", "tool_operation", str(op.id), None, {"tool": op.tool_name})
        return operation_to_out(op)
    except HTTPException as exc:
        _finish(db, op, status_value="failed", error=str(exc.detail))
        raise
    except Exception as exc:
        _finish(db, op, status_value="failed", error=f"Execution failed: {type(exc).__name__}")
        raise HTTPException(status_code=500, detail="Approved tool execution failed") from exc


def _is_admin(db: Session, user: User) -> bool:
    from ..auth.deps import get_user_role_names

    return bool(set(get_user_role_names(db, user)).intersection({"Super Admin", "Admin"}))
