"""Authorized, read-only project registration and repository indexing.

The service never accepts an arbitrary absolute host path from a client. A
project's ``workspace_path`` is relative to ``PROJECT_WORKSPACE_ROOT`` and is
resolved with a containment check before any filesystem access.
"""
from __future__ import annotations

import fnmatch
import hashlib
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Iterable

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..config import Settings
from ..db.models import OrganizationMember, Project, ProjectFile, User, WorkspaceMember
from ..schemas import ProjectCreateRequest, ProjectIndexResponse, ProjectItem, ProjectUpdateRequest

EXCLUDED_DIRS = {
    ".git", ".hg", ".svn", "node_modules", ".venv", "venv", "env", "__pycache__",
    ".mypy_cache", ".pytest_cache", ".ruff_cache", "dist", "build", ".next", ".nuxt",
    "coverage", "htmlcov", ".idea", ".vscode", "backups", ".cache", "target", "vendor",
    ".terraform", ".serverless",
}
EXCLUDED_FILE_PATTERNS = (
    ".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx", "*.jks", "*.keystore",
    "id_rsa*", "id_ed25519*", "credentials*", "secrets*", "*.sqlite", "*.sqlite3",
    "*.db", "*.dump", "*.bak", "*.log", "*.lock", "*.min.js", "*.map",
)
BINARY_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".tar",
    ".7z", ".rar", ".exe", ".dll", ".so", ".dylib", ".bin", ".woff", ".woff2",
    ".ttf", ".otf", ".mp3", ".mp4", ".mov", ".avi", ".class", ".pyc", ".wasm",
}
LANGUAGE_BY_EXT = {
    ".py": "Python", ".js": "JavaScript", ".jsx": "JavaScript", ".ts": "TypeScript",
    ".tsx": "TypeScript", ".go": "Go", ".rs": "Rust", ".java": "Java", ".kt": "Kotlin",
    ".rb": "Ruby", ".php": "PHP", ".cs": "C#", ".cpp": "C++", ".c": "C", ".h": "C/C++",
    ".sql": "SQL", ".html": "HTML", ".css": "CSS", ".scss": "SCSS", ".vue": "Vue",
    ".svelte": "Svelte", ".md": "Markdown", ".yml": "YAML", ".yaml": "YAML",
    ".json": "JSON", ".toml": "TOML", ".sh": "Shell", ".ps1": "PowerShell",
    ".dockerfile": "Docker", ".tf": "Terraform",
}
MANIFESTS = {
    "requirements.txt": "Python", "pyproject.toml": "Python", "Pipfile": "Python",
    "package.json": "Node.js", "pnpm-lock.yaml": "Node.js", "yarn.lock": "Node.js",
    "Dockerfile": "Docker", "docker-compose.yml": "Docker", "docker-compose.yaml": "Docker",
    "go.mod": "Go", "Cargo.toml": "Rust", "pom.xml": "Java", "build.gradle": "Java",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _is_admin(db: Session, user: User) -> bool:
    from ..auth.deps import get_user_role_names

    return bool(set(get_user_role_names(db, user)).intersection({"Super Admin", "Admin"}))


def _assert_org_access(db: Session, user: User, organization_id: uuid.UUID | None) -> None:
    if organization_id is None or _is_admin(db, user):
        return
    member = db.execute(
        select(OrganizationMember.id).where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.user_id == user.id,
        )
    ).scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this organization")


def _assert_workspace_access(db: Session, user: User, workspace_id: uuid.UUID | None) -> None:
    if workspace_id is None or _is_admin(db, user):
        return
    member = db.execute(
        select(WorkspaceMember.id).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user.id,
        )
    ).scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this workspace")


def assert_project_access(db: Session, user: User, project_id: uuid.UUID) -> Project:
    """Return an authorized project or raise a non-leaking 404."""
    project = db.get(Project, project_id)
    if not project or project.archived_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if project.owner_user_id == user.id or _is_admin(db, user):
        return project
    if project.organization_id:
        member = db.execute(
            select(OrganizationMember.id).where(
                OrganizationMember.organization_id == project.organization_id,
                OrganizationMember.user_id == user.id,
            )
        ).scalar_one_or_none()
        if member:
            return project
    if project.workspace_id:
        member = db.execute(
            select(WorkspaceMember.id).where(
                WorkspaceMember.workspace_id == project.workspace_id,
                WorkspaceMember.user_id == user.id,
            )
        ).scalar_one_or_none()
        if member:
            return project
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")


def _normalize_workspace_path(raw: str | None) -> str | None:
    if raw is None or not raw.strip():
        return None
    value = raw.strip().replace("\\", "/")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or (path.parts and ":" in path.parts[0]):
        raise HTTPException(status_code=400, detail="workspace_path must be relative to PROJECT_WORKSPACE_ROOT")
    if not path.parts:
        raise HTTPException(status_code=400, detail="workspace_path is invalid")
    return path.as_posix()


def _resolve_project_root(settings: Settings, project: Project) -> Path:
    raw_root = (settings.project_workspace_root or "").strip()
    if not raw_root:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="PROJECT_WORKSPACE_ROOT is not configured; repository indexing is unavailable",
        )
    root = Path(raw_root).expanduser().resolve()
    if not root.is_dir():
        raise HTTPException(status_code=503, detail="Configured PROJECT_WORKSPACE_ROOT is not a directory")
    if not project.workspace_path:
        raise HTTPException(status_code=400, detail="Project has no workspace_path configured")
    candidate = (root / project.workspace_path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Project workspace escapes the configured root") from exc
    if not candidate.is_dir():
        raise HTTPException(status_code=404, detail="Project workspace directory does not exist")
    return candidate


def resolve_project_root(settings: Settings, project: Project) -> Path:
    """Public containment-checked resolver used by the tool layer."""
    return _resolve_project_root(settings, project)


def _read_gitignore(root: Path) -> list[str]:
    path = root / ".gitignore"
    if not path.is_file():
        return []
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return []
    return [line.strip() for line in lines if line.strip() and not line.strip().startswith("#")]


def _ignored(relative: str, name: str, patterns: list[str]) -> bool:
    rel = relative.replace("\\", "/")
    for pattern in patterns:
        negated = pattern.startswith("!")
        p = pattern[1:] if negated else pattern
        p = p.lstrip("/")
        if p.endswith("/"):
            if rel == p.rstrip("/") or rel.startswith(p):
                return not negated
        elif fnmatch.fnmatch(rel, p) or fnmatch.fnmatch(name, p):
            return not negated
    return False


def _is_secret_or_binary(path: Path) -> bool:
    name = path.name.lower()
    if any(fnmatch.fnmatch(name, pattern.lower()) for pattern in EXCLUDED_FILE_PATTERNS):
        return True
    return path.suffix.lower() in BINARY_EXTENSIONS


def _looks_binary(data: bytes) -> bool:
    if b"\x00" in data[:4096]:
        return True
    try:
        data[:4096].decode("utf-8")
        return False
    except UnicodeDecodeError:
        return True


def _detect_tech_stack(root: Path) -> list[str]:
    detected: set[str] = set()
    for manifest, tech in MANIFESTS.items():
        if (root / manifest).exists():
            detected.add(tech)
    for child in root.iterdir() if root.is_dir() else []:
        if child.is_file() and child.name.lower() in {"package.json", "requirements.txt", "pyproject.toml"}:
            detected.add("Node.js" if child.name.lower() == "package.json" else "Python")
    return sorted(detected)


def create_project(db: Session, user: User, req: ProjectCreateRequest, settings: Settings) -> Project:
    _assert_org_access(db, user, req.organization_id)
    _assert_workspace_access(db, user, req.workspace_id)
    workspace_path = _normalize_workspace_path(req.workspace_path)
    duplicate = db.execute(
        select(Project.id).where(Project.owner_user_id == user.id, Project.name == req.name.strip())
    ).scalar_one_or_none()
    if duplicate:
        raise HTTPException(status_code=409, detail="A project with this name already exists")
    project = Project(
        owner_user_id=user.id,
        organization_id=req.organization_id,
        workspace_id=req.workspace_id,
        name=req.name.strip(),
        description=(req.description or "").strip() or None,
        repo_provider=(req.repo_provider or "local").strip().lower(),
        repo_url=(req.repo_url or "").strip() or None,
        default_branch=(req.default_branch or "main").strip() or "main",
        workspace_path=workspace_path,
        tech_stack=req.tech_stack or [],
        status="connected" if (req.repo_url or workspace_path) else "registered",
        indexing_status="not_indexed",
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def update_project(db: Session, user: User, project_id: uuid.UUID, req: ProjectUpdateRequest) -> Project:
    project = assert_project_access(db, user, project_id)
    if project.owner_user_id != user.id and not _is_admin(db, user):
        raise HTTPException(status_code=403, detail="Only the project owner can update project settings")
    if req.name is not None:
        project.name = req.name.strip()
    if req.description is not None:
        project.description = req.description.strip() or None
    if req.repo_url is not None:
        project.repo_url = req.repo_url.strip() or None
    if req.default_branch is not None:
        project.default_branch = req.default_branch.strip() or "main"
    if req.workspace_path is not None:
        project.workspace_path = _normalize_workspace_path(req.workspace_path)
    if req.tech_stack is not None:
        project.tech_stack = req.tech_stack
    if req.archived is not None:
        project.archived_at = _now() if req.archived else None
    project.updated_at = _now()
    db.commit()
    db.refresh(project)
    return project


def index_project(db: Session, user: User, project_id: uuid.UUID, settings: Settings) -> ProjectIndexResponse:
    project = assert_project_access(db, user, project_id)
    if project.owner_user_id != user.id and not _is_admin(db, user):
        raise HTTPException(status_code=403, detail="Only the project owner can re-index the repository")
    root = _resolve_project_root(settings, project)
    gitignore = _read_gitignore(root)
    seen: set[str] = set()
    skipped = 0
    indexed = 0
    total_files = 0
    max_bytes = max(1024, int(settings.project_max_file_bytes))
    max_files = max(1, int(settings.project_max_files))
    excerpt_chars = max(256, int(settings.project_index_excerpt_chars))

    project.indexing_status = "indexing"
    project.updated_at = _now()
    db.commit()

    try:
        for current, dirs, files in os.walk(root, followlinks=False):
            dirs[:] = sorted(d for d in dirs if d not in EXCLUDED_DIRS and not _ignored(
                str((Path(current) / d).relative_to(root)).replace("\\", "/"), d, gitignore
            ))
            for filename in sorted(files):
                if total_files >= max_files:
                    skipped += 1
                    continue
                full = Path(current) / filename
                try:
                    resolved = full.resolve()
                    resolved.relative_to(root)
                except (OSError, ValueError):
                    skipped += 1
                    continue
                rel = resolved.relative_to(root).as_posix()
                if rel in seen or _ignored(rel, filename, gitignore) or _is_secret_or_binary(resolved):
                    skipped += 1
                    continue
                try:
                    size = resolved.stat().st_size
                except OSError:
                    skipped += 1
                    continue
                if size > max_bytes:
                    skipped += 1
                    continue
                try:
                    data = resolved.read_bytes()
                except OSError:
                    skipped += 1
                    continue
                if _looks_binary(data):
                    skipped += 1
                    continue
                text = data.decode("utf-8", errors="ignore")
                digest = hashlib.sha256(data).hexdigest()
                excerpt = text[:excerpt_chars]
                language = LANGUAGE_BY_EXT.get(resolved.suffix.lower())
                existing = db.execute(
                    select(ProjectFile).where(ProjectFile.project_id == project.id, ProjectFile.path == rel)
                ).scalar_one_or_none()
                if existing:
                    existing.size_bytes = size
                    existing.language = language
                    existing.content_hash = digest
                    existing.excerpt = excerpt
                    existing.indexed = True
                    existing.is_binary = False
                    existing.updated_at = _now()
                else:
                    db.add(ProjectFile(
                        project_id=project.id,
                        path=rel,
                        size_bytes=size,
                        language=language,
                        content_hash=digest,
                        excerpt=excerpt,
                        indexed=True,
                        is_binary=False,
                    ))
                seen.add(rel)
                indexed += 1
                total_files += 1
            if total_files >= max_files:
                break

        # Remove stale metadata for files that no longer exist. This is scoped
        # to this project only and never touches another project's rows.
        if seen:
            stale = db.execute(select(ProjectFile).where(ProjectFile.project_id == project.id)).scalars().all()
            for row in stale:
                if row.path not in seen:
                    db.delete(row)
        else:
            db.execute(ProjectFile.__table__.delete().where(ProjectFile.project_id == project.id))

        stack = _detect_tech_stack(root)
        project.tech_stack = stack
        project.indexing_status = "indexed"
        project.status = "connected"
        project.last_indexed_at = _now()
        project.last_synced_at = _now()
        project.updated_at = _now()
        db.commit()
        return ProjectIndexResponse(
            project_id=str(project.id),
            indexing_status="indexed",
            indexed_files=indexed,
            skipped_files=skipped,
            root_configured=True,
            message=f"Indexed {indexed} text files from the authorized project workspace ({skipped} skipped).",
        )
    except HTTPException:
        db.rollback()
        project = db.get(Project, project_id)
        if project:
            project.indexing_status = "failed"
            db.commit()
        raise
    except Exception:
        db.rollback()
        project = db.get(Project, project_id)
        if project:
            project.indexing_status = "failed"
            db.commit()
        raise


def project_to_item(db: Session, project: Project) -> ProjectItem:
    indexed_files = db.execute(
        select(func.count()).select_from(ProjectFile).where(ProjectFile.project_id == project.id)
    ).scalar() or 0
    stack = project.tech_stack if isinstance(project.tech_stack, list) else []
    languages = sorted({LANGUAGE_BY_EXT.get("." + str(s).lower(), str(s)) for s in stack if s})
    return ProjectItem(
        id=str(project.id),
        name=project.name,
        repo_provider=project.repo_provider,
        repo_url=project.repo_url or "",
        default_branch=project.default_branch,
        status=project.status,
        language=", ".join(languages[:3]) or "Unknown",
        framework=", ".join(str(s) for s in stack[:3]) or "Unknown",
        last_synced=project.last_synced_at.isoformat() if project.last_synced_at else "Never",
        health="healthy" if project.indexing_status == "indexed" else "unknown",
        environments=0,
        open_prs=0,
        pending_changes=0,
        description=project.description,
        workspace_path=project.workspace_path,
        indexing_status=project.indexing_status,
        indexed_files=indexed_files,
        last_indexed_at=project.last_indexed_at.isoformat() if project.last_indexed_at else None,
        repository_inspected=indexed_files > 0,
        repo_connected=bool(project.repo_url or project.workspace_path),
    )


def list_projects(db: Session, user: User, q: str | None = None, limit: int = 100, offset: int = 0) -> list[ProjectItem]:
    stmt = select(Project).where(Project.archived_at.is_(None))
    if not _is_admin(db, user):
        # Owner, organization member, or workspace member. The OR subquery is
        # intentionally explicit so a project never leaks through a missing FK.
        org_ids = select(OrganizationMember.organization_id).where(OrganizationMember.user_id == user.id)
        ws_ids = select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == user.id)
        stmt = stmt.where(or_(Project.owner_user_id == user.id, Project.organization_id.in_(org_ids), Project.workspace_id.in_(ws_ids)))
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(Project.name).like(like), func.lower(Project.description).like(like)))
    rows = db.execute(stmt.order_by(Project.updated_at.desc()).offset(max(0, offset)).limit(max(1, min(limit, 200)))).scalars().all()
    return [project_to_item(db, p) for p in rows]


def get_project(db: Session, user: User, project_id: uuid.UUID) -> Project:
    return assert_project_access(db, user, project_id)


def list_project_tree(db: Session, user: User, project_id: uuid.UUID, limit: int = 500) -> list[dict]:
    project = assert_project_access(db, user, project_id)
    files = db.execute(
        select(ProjectFile.path, ProjectFile.size_bytes)
        .where(ProjectFile.project_id == project.id)
        .order_by(ProjectFile.path.asc())
        .limit(max(1, min(limit, 2000)))
    ).all()
    entries: dict[str, dict] = {}
    for path, size in files:
        entries[path] = {"path": path, "type": "file", "size_bytes": size}
        parts = path.split("/")
        for i in range(1, len(parts)):
            parent = "/".join(parts[:i])
            entries.setdefault(parent, {"path": parent, "type": "directory", "size_bytes": None})
    return sorted(entries.values(), key=lambda x: (x["type"] != "directory", x["path"]))


def list_project_files(db: Session, user: User, project_id: uuid.UUID, q: str | None = None, limit: int = 100) -> list[ProjectFile]:
    project = assert_project_access(db, user, project_id)
    stmt = select(ProjectFile).where(ProjectFile.project_id == project.id)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(ProjectFile.path).like(like), func.lower(ProjectFile.excerpt).like(like)))
    return db.execute(stmt.order_by(ProjectFile.path.asc()).limit(max(1, min(limit, 500)))).scalars().all()


def read_project_file(db: Session, user: User, project_id: uuid.UUID, path: str, settings: Settings) -> ProjectFile:
    project = assert_project_access(db, user, project_id)
    normalized = path.replace("\\", "/").lstrip("/")
    if not normalized or ".." in PurePosixPath(normalized).parts:
        raise HTTPException(status_code=400, detail="Invalid file path")
    row = db.execute(
        select(ProjectFile).where(ProjectFile.project_id == project.id, ProjectFile.path == normalized)
    ).scalar_one_or_none()
    if row:
        return row
    # If indexed metadata is absent, only read a safe file from the configured
    # project root (never an arbitrary path).
    root = _resolve_project_root(settings, project)
    candidate = (root / normalized).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid file path") from exc
    if not candidate.is_file() or candidate.stat().st_size > settings.project_max_file_bytes:
        raise HTTPException(status_code=404, detail="File not found or too large to inspect")
    if _is_secret_or_binary(candidate):
        raise HTTPException(status_code=403, detail="File is excluded from inspection")
    data = candidate.read_bytes()
    if _looks_binary(data):
        raise HTTPException(status_code=415, detail="Binary files cannot be inspected")
    return ProjectFile(
        project_id=project.id,
        path=normalized,
        size_bytes=len(data),
        language=LANGUAGE_BY_EXT.get(candidate.suffix.lower()),
        content_hash=hashlib.sha256(data).hexdigest(),
        excerpt=data.decode("utf-8", errors="ignore")[: settings.project_index_excerpt_chars],
        indexed=False,
        is_binary=False,
    )


def build_project_context(db: Session, user: User, project_id: uuid.UUID, query: str = "", max_files: int = 6) -> tuple[str, list[ProjectFile], Project]:
    project = assert_project_access(db, user, project_id)
    files = list_project_files(db, user, project_id, q=None, limit=500)
    if not files:
        context = (
            f"PROJECT CONTEXT: '{project.name}' is registered, but no repository files have been indexed. "
            "Do not claim to have inspected its source code. Tell the user that indexing is required."
        )
        return context, [], project
    terms = [t for t in query.lower().replace("/", " ").replace("_", " ").split() if len(t) > 2]
    selected: list[ProjectFile] = []
    for f in files:
        haystack = f"{f.path}\n{f.excerpt or ''}".lower()
        score = sum(1 for t in terms if t in haystack)
        if score or not terms:
            selected.append((score, f))  # type: ignore[arg-type]
    selected.sort(key=lambda pair: (-pair[0], pair[1].path))  # type: ignore[index]
    chosen = [pair[1] for pair in selected[: max(1, min(max_files, 10))]]  # type: ignore[index]
    stack = project.tech_stack if isinstance(project.tech_stack, list) else []
    tree = [f.path for f in files[:120]]
    lines = [
        "PROJECT CONTEXT (read-only, retrieved from the authorized repository index).",
        f"Project: {project.name}",
        f"Default branch: {project.default_branch}",
        f"Detected stack: {', '.join(str(s) for s in stack) or 'unknown'}",
        f"Indexed files: {len(files)}",
        "File tree (partial):",
        *[f"- {p}" for p in tree],
        "Relevant file excerpts:",
    ]
    for f in chosen:
        lines.append(f"\n--- {f.path} ({f.size_bytes} bytes) ---\n{(f.excerpt or '')[:2500]}")
    lines.append(
        "\nWhen answering, cite the exact file path for claims based on this context. "
        "Do not invent files, dependencies, build results, branch state, or repository facts that are not shown here."
    )
    return "\n".join(lines), chosen, project


def iter_project_file_rows(db: Session, project_id: uuid.UUID) -> Iterable[ProjectFile]:
    return db.execute(select(ProjectFile).where(ProjectFile.project_id == project_id)).scalars().all()
