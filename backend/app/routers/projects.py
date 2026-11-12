"""Authenticated, PostgreSQL-backed project and repository context APIs.

The previous in-memory project/demo store has been replaced. Deployment,
environment and incident records are intentionally empty until a real provider
is connected; they are not fabricated.
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth.deps import get_current_user
from ..auth.service import log_audit
from ..config import Settings, get_settings
from ..db.models import ToolOperation, User
from ..db.session import get_db
from ..schemas import (
    DeploymentItem,
    EnvironmentItem,
    IncidentItem,
    ProjectContextResponse,
    ProjectCreateRequest,
    ProjectFileItem,
    ProjectIndexResponse,
    ProjectItem,
    ProjectTreeItem,
    ProjectUpdateRequest,
    ProjectWorkflow,
    WorkflowStage,
)
from ..services.projects import (
    build_project_context,
    create_project,
    get_project,
    index_project,
    list_project_files,
    list_project_tree,
    list_projects,
    project_to_item,
    update_project,
)

router = APIRouter(prefix="/api/v1", tags=["projects"])
DB = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


@router.get("/projects", response_model=list[ProjectItem])
def list_all(
    db: DB,
    user: CurrentUser,
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[ProjectItem]:
    return list_projects(db, user, q=q, limit=limit, offset=offset)


@router.post("/projects", response_model=ProjectItem, status_code=status.HTTP_201_CREATED)
def create(req: ProjectCreateRequest, request: Request, db: DB, user: CurrentUser, settings: SettingsDep) -> ProjectItem:
    project = create_project(db, user, req, settings)
    log_audit(db, user.id, "project.create", "project", str(project.id), request.client.host if request.client else None, {"name": project.name})
    return project_to_item(db, project)


@router.get("/projects/{project_id}", response_model=ProjectItem)
def retrieve(project_id: uuid.UUID, db: DB, user: CurrentUser) -> ProjectItem:
    return project_to_item(db, get_project(db, user, project_id))


@router.patch("/projects/{project_id}", response_model=ProjectItem)
def update(project_id: uuid.UUID, req: ProjectUpdateRequest, request: Request, db: DB, user: CurrentUser) -> ProjectItem:
    project = update_project(db, user, project_id, req)
    log_audit(db, user.id, "project.update", "project", str(project_id), request.client.host if request.client else None, {"fields": sorted(req.model_dump(exclude_none=True).keys())})
    return project_to_item(db, project)


@router.post("/projects/{project_id}/index", response_model=ProjectIndexResponse)
def index(project_id: uuid.UUID, request: Request, db: DB, user: CurrentUser, settings: SettingsDep) -> ProjectIndexResponse:
    out = index_project(db, user, project_id, settings)
    log_audit(db, user.id, "project.index", "project", str(project_id), request.client.host if request.client else None, {"indexed_files": out.indexed_files, "skipped": out.skipped_files})
    return out


@router.get("/projects/{project_id}/tree", response_model=list[ProjectTreeItem])
def tree(project_id: uuid.UUID, db: DB, user: CurrentUser, limit: int = Query(default=500, ge=1, le=2000)) -> list[ProjectTreeItem]:
    return [ProjectTreeItem(**item) for item in list_project_tree(db, user, project_id, limit=limit)]


@router.get("/projects/{project_id}/files", response_model=list[ProjectFileItem])
def files(project_id: uuid.UUID, db: DB, user: CurrentUser, q: str | None = None, limit: int = Query(default=100, ge=1, le=500)) -> list[ProjectFileItem]:
    rows = list_project_files(db, user, project_id, q=q, limit=limit)
    return [
        ProjectFileItem(
            path=row.path,
            size_bytes=row.size_bytes,
            language=row.language,
            indexed=row.indexed,
            is_binary=row.is_binary,
            excerpt=(row.excerpt or "")[:1000],
        )
        for row in rows
    ]


@router.get("/projects/{project_id}/context", response_model=ProjectContextResponse)
def context(project_id: uuid.UUID, db: DB, user: CurrentUser, q: str = "") -> ProjectContextResponse:
    text, chosen, project = build_project_context(db, user, project_id, query=q)
    return ProjectContextResponse(
        project_id=str(project.id),
        project_name=project.name,
        indexing_status=project.indexing_status,
        repository_inspected=bool(chosen),
        files=[
            ProjectFileItem(
                path=row.path,
                size_bytes=row.size_bytes,
                language=row.language,
                indexed=row.indexed,
                is_binary=row.is_binary,
                excerpt=(row.excerpt or "")[:1000],
            )
            for row in chosen
        ],
        context=text,
    )


@router.get("/projects/{project_id}/workflow", response_model=ProjectWorkflow)
def workflow(project_id: uuid.UUID, db: DB, user: CurrentUser) -> ProjectWorkflow:
    project = get_project(db, user, project_id)
    pending = db.execute(
        select(func.count()).select_from(ToolOperation).where(
            ToolOperation.project_id == project.id,
            ToolOperation.status.in_(["pending_approval", "running"]),
        )
    ).scalar() or 0
    indexed = project.indexing_status == "indexed"
    stages = [
        WorkflowStage(name="Register repository", status="done" if project.workspace_path or project.repo_url else "pending"),
        WorkflowStage(name="Index authorized source files", status="done" if indexed else "active"),
        WorkflowStage(name="Inspect project context", status="done" if indexed else "pending"),
        WorkflowStage(name="Propose changes", status="active" if indexed else "pending"),
        WorkflowStage(name="Run approved checks", status="pending"),
        WorkflowStage(name="Review diff / approval", status="pending"),
        WorkflowStage(name="Deploy", status="pending"),
        WorkflowStage(name="Monitor", status="pending"),
    ]
    return ProjectWorkflow(
        project_id=str(project.id),
        stages=stages,
        current_step="Index authorized source files" if not indexed else "Propose changes",
        approvals_required=int(pending),
    )


# These provider-backed resources are not connected. Returning an empty list is
# honest; the UI labels this state instead of showing fabricated deployments.
@router.get("/projects/{project_id}/environments", response_model=list[EnvironmentItem])
def list_project_environments(project_id: uuid.UUID, db: DB, user: CurrentUser) -> list[EnvironmentItem]:
    get_project(db, user, project_id)
    return []


@router.get("/environments", response_model=list[EnvironmentItem])
def list_environments(db: DB, user: CurrentUser) -> list[EnvironmentItem]:
    return []


@router.get("/projects/{project_id}/deployments", response_model=list[DeploymentItem])
def list_project_deployments(project_id: uuid.UUID, db: DB, user: CurrentUser) -> list[DeploymentItem]:
    get_project(db, user, project_id)
    return []


@router.get("/deployments", response_model=list[DeploymentItem])
def list_deployments(db: DB, user: CurrentUser) -> list[DeploymentItem]:
    return []


@router.post("/projects/{project_id}/deployments/{deployment_id}/rollback", response_model=DeploymentItem)
def rollback_deployment(project_id: uuid.UUID, deployment_id: str, db: DB, user: CurrentUser) -> DeploymentItem:
    get_project(db, user, project_id)
    raise HTTPException(status_code=503, detail="Deployment provider is not connected; rollback was not executed.")


@router.get("/projects/{project_id}/incidents", response_model=list[IncidentItem])
def list_project_incidents(project_id: uuid.UUID, db: DB, user: CurrentUser) -> list[IncidentItem]:
    get_project(db, user, project_id)
    return []


@router.get("/incidents", response_model=list[IncidentItem])
def list_incidents(db: DB, user: CurrentUser) -> list[IncidentItem]:
    return []
