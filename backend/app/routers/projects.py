import time
from datetime import datetime

from fastapi import APIRouter, HTTPException

from ..schemas import (
    DeploymentItem,
    EnvironmentItem,
    IncidentItem,
    ProjectCreateRequest,
    ProjectItem,
    ProjectWorkflow,
    WorkflowStage,
)

router = APIRouter(prefix="/api/v1", tags=["projects"])

_PROJECTS: list[ProjectItem] = [
    ProjectItem(
        id="proj-1",
        name="opspilot-platform",
        repo_provider="github",
        repo_url="https://github.com/vengat3sh/opspilot",
        default_branch="main",
        status="connected",
        language="TypeScript/Python",
        framework="React + FastAPI",
        last_synced="2 min ago",
        health="healthy",
        environments=3,
        open_prs=2,
        pending_changes=1,
    ),
    ProjectItem(
        id="proj-2",
        name="payments-api",
        repo_provider="github",
        repo_url="https://github.com/example/payments-api",
        default_branch="main",
        status="connected",
        language="Python",
        framework="FastAPI",
        last_synced="18 min ago",
        health="degraded",
        environments=2,
        open_prs=1,
        pending_changes=3,
    ),
]

_ENVIRONMENTS: list[EnvironmentItem] = [
    EnvironmentItem(id="env-1", project_id="proj-1", name="development", provider="docker", status="running", url="http://localhost:5173", branch="dev", last_deploy="5 min ago"),
    EnvironmentItem(id="env-2", project_id="proj-1", name="staging", provider="render", status="healthy", url="https://staging.opspilot.example", branch="main", last_deploy="32 min ago"),
    EnvironmentItem(id="env-3", project_id="proj-1", name="production", provider="render", status="healthy", url="https://opspilot-q1xc.onrender.com", branch="main", last_deploy="2 hr ago"),
    EnvironmentItem(id="env-4", project_id="proj-2", name="staging", provider="railway", status="degraded", url="https://payments-staging.example", branch="main", last_deploy="1 hr ago"),
    EnvironmentItem(id="env-5", project_id="proj-2", name="production", provider="aws", status="healthy", url="https://api.payments.example", branch="main", last_deploy="Yesterday"),
]

_DEPLOYMENTS: list[DeploymentItem] = [
    DeploymentItem(id="dep-101", project_id="proj-1", environment="production", status="Successful", commit="185a036", branch="main", created_at="2026-11-11 10:12", summary="UI refinement and navbar controls", url="https://opspilot-q1xc.onrender.com"),
    DeploymentItem(id="dep-102", project_id="proj-1", environment="staging", status="Successful", commit="28c352b", branch="main", created_at="2026-11-11 09:44", summary="AI Engineer workspace redesign", url="https://staging.opspilot.example"),
    DeploymentItem(id="dep-103", project_id="proj-2", environment="staging", status="Failed", commit="a91cd20", branch="feature/auth-fix", created_at="2026-11-11 08:55", summary="Auth middleware refactor failed health checks"),
    DeploymentItem(id="dep-104", project_id="proj-1", environment="development", status="Queued", commit="local", branch="dev", created_at="2026-11-11 10:20", summary="Local sandbox build queued"),
]

_INCIDENTS: list[IncidentItem] = [
    IncidentItem(id="inc-1", project_id="proj-2", title="HTTP 500 spike on /auth/login", severity="critical", status="investigating", service="payments-api-staging", detected_at="12 min ago", summary="Error rate increased after latest deployment; health checks failing intermittently.", recommendation="Compare dep-103 diff, inspect auth middleware logs, rollback staging if needed after approval."),
    IncidentItem(id="inc-2", project_id="proj-1", title="Elevated latency on /api/chat/stream", severity="medium", status="mitigated", service="opspilot-production", detected_at="1 hr ago", summary="P95 latency increased during provider fallback.", recommendation="Monitor provider fallback rate and enable response caching for repeated prompts."),
]


@router.get("/projects", response_model=list[ProjectItem])
async def list_projects() -> list[ProjectItem]:
    return _PROJECTS


@router.post("/projects", response_model=ProjectItem)
async def create_project(req: ProjectCreateRequest) -> ProjectItem:
    item = ProjectItem(
        id=f"proj-{int(time.time())}",
        name=req.name,
        repo_provider=req.repo_provider,
        repo_url=req.repo_url,
        default_branch=req.default_branch,
        status="connected",
        language="Detecting...",
        framework="Detecting...",
        last_synced="just now",
        health="unknown",
        environments=0,
        open_prs=0,
        pending_changes=0,
    )
    _PROJECTS.insert(0, item)
    return item


@router.get("/projects/{project_id}", response_model=ProjectItem)
async def get_project(project_id: str) -> ProjectItem:
    for p in _PROJECTS:
        if p.id == project_id:
            return p
    raise HTTPException(status_code=404, detail="Project not found")


@router.get("/projects/{project_id}/workflow", response_model=ProjectWorkflow)
async def get_project_workflow(project_id: str) -> ProjectWorkflow:
    if not any(p.id == project_id for p in _PROJECTS):
        raise HTTPException(status_code=404, detail="Project not found")
    stages = [
        WorkflowStage(name="Connect repository", status="done"),
        WorkflowStage(name="Analyze & index codebase", status="done"),
        WorkflowStage(name="Plan engineering task", status="done"),
        WorkflowStage(name="Apply changes in sandbox", status="active"),
        WorkflowStage(name="Run tests & code review", status="pending"),
        WorkflowStage(name="Create PR / approval", status="pending"),
        WorkflowStage(name="Build & deploy", status="pending"),
        WorkflowStage(name="Monitor & diagnose", status="pending"),
    ]
    return ProjectWorkflow(project_id=project_id, stages=stages, current_step="Apply changes in sandbox", approvals_required=2)


@router.get("/projects/{project_id}/environments", response_model=list[EnvironmentItem])
async def list_project_environments(project_id: str) -> list[EnvironmentItem]:
    return [e for e in _ENVIRONMENTS if e.project_id == project_id]


@router.get("/environments", response_model=list[EnvironmentItem])
async def list_environments() -> list[EnvironmentItem]:
    return _ENVIRONMENTS


@router.get("/projects/{project_id}/deployments", response_model=list[DeploymentItem])
async def list_project_deployments(project_id: str) -> list[DeploymentItem]:
    return [d for d in _DEPLOYMENTS if d.project_id == project_id]


@router.get("/deployments", response_model=list[DeploymentItem])
async def list_deployments() -> list[DeploymentItem]:
    return _DEPLOYMENTS


@router.post("/projects/{project_id}/deployments/{deployment_id}/rollback", response_model=DeploymentItem)
async def rollback_deployment(project_id: str, deployment_id: str) -> DeploymentItem:
    for d in _DEPLOYMENTS:
        if d.id == deployment_id and d.project_id == project_id:
            d.status = "Rolled back"
            d.summary = f"Rollback requested at {datetime.now().strftime('%H:%M')} (approval required in production)"
            return d
    raise HTTPException(status_code=404, detail="Deployment not found")


@router.get("/projects/{project_id}/incidents", response_model=list[IncidentItem])
async def list_project_incidents(project_id: str) -> list[IncidentItem]:
    return [i for i in _INCIDENTS if i.project_id == project_id]


@router.get("/incidents", response_model=list[IncidentItem])
async def list_incidents() -> list[IncidentItem]:
    return _INCIDENTS
