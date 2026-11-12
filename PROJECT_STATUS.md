# OpsPilot — Project Status

**Version:** v3.1.0 (Auth/RBAC foundation in progress)  
**Live Deployment:** https://opspilot-q1xc.onrender.com  
**Repository:** https://github.com/vengat3sh/opspilot

---

## 1. Objective (current upgrade)
Implement **separate Admin & User authentication** with **actual PostgreSQL persistence (pgAdmin 4 inspectable)**, RBAC roles, secure bootstrap/invitations, and separate auth/admin APIs/dashboards foundations — while preserving existing OpsPilot functionality.

## 2. Existing files inspected (this phase)
- `backend/app/config.py`, `backend/app/main.py`, `backend/app/schemas.py`
- `backend/app/routers/chat.py`, `backend/app/routers/operations.py`, `backend/app/routers/projects.py`
- `backend/app/llm.py`, `backend/app/rag.py`
- `backend/requirements.txt`, `backend/.env.example`
- `frontend/src/App.tsx`, `frontend/src/api.ts`, `frontend/src/index.css`
- `frontend/src/components/DeveloperCommandCenter.tsx`, `AIEngineerView.tsx`, `DashboardView.tsx`, `DocumentsView.tsx`, `AgentsView.tsx`, `ApprovalsView.tsx`, `TicketsView.tsx`
- `README.md`, `PROJECT_STATUS.md`, `docker-compose.yml`, `render.yaml`

## 3. Architecture decisions (implemented / planned)
- **Modular monolith** retained (FastAPI backend + React frontend). New `app/db` and `app/auth` modules added with clear boundaries.
- **PostgreSQL as primary auth store** via SQLAlchemy 2.x models + Alembic migrations (`opspilot_db`, schema `public`).
- **RBAC model**: roles/permissions/user_roles/role_permissions tables; initial roles seeded in migration (`Super Admin`, `Admin`, `Developer`, `Reviewer`, `Viewer`).
- **Security primitives**: Argon2id password hashing (`passlib[argon2]`), JWT access tokens, rotating refresh session tokens stored as hashes in DB, HttpOnly cookies for access/session tokens, backend-enforced role checks.
- **Admin bootstrap**: `/api/v1/auth/admin/bootstrap` creates initial Super Admin only when no admin exists (env/config-driven credentials supported); invitation-based admin onboarding endpoint added.
- **Preservation**: existing LLM/chat, operations, projects, and command center features kept intact; auth endpoints added alongside current APIs.
- **Not yet completed**: full separate frontend auth routes/pages/dashboards, Google/GitHub OAuth production flows, MFA, complete admin management UI, email delivery, CSRF hardening for all cookie flows, end-to-end PostgreSQL/pgAdmin verification in a live DB environment.

## 4. Files created or modified (this phase)
### Backend (created)
- `backend/app/db/__init__.py`, `backend/app/db/base.py`, `backend/app/db/session.py`, `backend/app/db/models.py`
- `backend/app/auth/__init__.py`, `backend/app/auth/security.py`, `backend/app/auth/schemas.py`, `backend/app/auth/service.py`, `backend/app/auth/deps.py`, `backend/app/auth/router.py`
- `backend/alembic.ini`, `backend/alembic/env.py`, `backend/alembic/script.py.mako`, `backend/alembic/versions/0001_auth_rbac_core.py`

### Backend (modified)
- `backend/app/config.py` (DB/auth/OAuth/bootstrap settings)
- `backend/app/main.py` (CORS credentials + auth/admin routers)
- `backend/requirements.txt` (SQLAlchemy, Alembic, psycopg, argon2, jose, multipart, etc.)
- `backend/.env.example` (PostgreSQL/auth/bootstrap/OAuth variables)

### Frontend (modified)
- `frontend/src/components/DeveloperCommandCenter.tsx` (removed hardcoded username; userName prop/default)
- `frontend/src/App.tsx` (passes dynamic/default user name)

## 5. Implementation summary
- Added PostgreSQL-backed schema/models for: `users`, `user_profiles`, `roles`, `permissions`, `user_roles`, `role_permissions`, `user_sessions`, `oauth_accounts`, `email_verification_tokens`, `password_reset_tokens`, `admin_invitations`, `organizations`, `organization_members`, `workspaces`, `workspace_members`, `audit_logs`
- Added Alembic migration `0001_auth_rbac_core` to create tables/indexes/constraints and seed default roles
- Implemented core auth/admin APIs:
  - `POST /api/v1/auth/user/register`, `POST /api/v1/auth/user/login`, `POST /api/v1/auth/user/logout`
  - `POST /api/v1/auth/admin/bootstrap`, `POST /api/v1/auth/admin/login`, `POST /api/v1/auth/admin/invitations`, `POST /api/v1/auth/admin/accept-invitation`
  - `POST /api/v1/auth/refresh`, `GET /api/v1/auth/me`, `POST /api/v1/auth/logout-all`
  - `POST /api/v1/auth/forgot-password`, `POST /api/v1/auth/reset-password`, `POST /api/v1/auth/verify-email`
  - Admin management: `GET/PATCH /api/v1/admin/users...`, `GET /api/v1/admin/audit-logs`, `GET /api/v1/admin/metrics`, `GET /api/v1/admin/database/health`
- Implemented session creation/rotation/revocation, audit logging hooks, and backend RBAC dependencies (`require_admin`, `require_super_admin`)
- Removed hardcoded UI username so authenticated user identity can be displayed dynamically (foundation for auth-aware UI)

## 6. Exact Windows PowerShell commands (setup/start/verify)

```powershell
# 1) PostgreSQL + pgAdmin 4 prerequisites
# - Install/start PostgreSQL locally
# - Create database: opspilot_db
#   (pgAdmin 4: Servers -> PostgreSQL -> Databases -> Create -> Database... -> opspilot_db)

# 2) Backend environment
cd D:\opspilot\backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# Edit .env: set DATABASE_URL, JWT_SECRET_KEY, BOOTSTRAP_SUPER_ADMIN_* (one-time), OAuth vars if needed

# 3) Run migrations (creates real tables in opspilot_db/public)
alembic upgrade head

# 4) Start backend
uvicorn app.main:app --reload --port 8000

# 5) (Optional) Bootstrap Super Admin (only if no admin exists)
# PowerShell example:
# Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/v1/auth/admin/bootstrap -ContentType "application/json" -Body (@{
#   email="admin@example.com"; password="StrongPassword123!"; full_name="Super Admin"
# } | ConvertTo-Json)

# 6) Frontend
cd D:\opspilot\frontend
npm install
npm run dev

# 7) pgAdmin 4 verification
# Open pgAdmin 4 -> Servers -> Databases -> opspilot_db -> Schemas -> public -> Tables
# Inspect: users, roles, user_roles, user_sessions, oauth_accounts, admin_invitations, audit_logs, etc.
# Query Tool examples:
# SELECT id, full_name, email, is_active, is_verified, created_at FROM public.users ORDER BY created_at DESC;
# SELECT u.email, u.full_name, r.name AS role_name FROM public.users u JOIN public.user_roles ur ON ur.user_id=u.id JOIN public.roles r ON r.id=ur.role_id;
```

## 7. Security implications
- **Implemented:** Argon2id password hashing, hashed refresh/session tokens, hashed invitation/verification/reset tokens, HttpOnly auth cookies (configurable secure/samesite), backend RBAC guards for admin endpoints, audit log writes for key auth/admin actions, bootstrap restricted when any admin already exists, no secrets hardcoded in source.
- **Partial / pending:** full CSRF protection strategy for cookie-authenticated state-changing requests, rate limiting/login attempt lockout, MFA, Google/GitHub OAuth OIDC/state/nonce hardening and account linking flows, secure email delivery for verification/reset/invites, reauthentication for sensitive admin ops, strict frontend route guards and session restoration UX, production secret management and token exposure controls (dev flows may return invitation tokens for setup/testing and must be tightened).

## 8. Tests executed
- `python -m compileall backend/app backend/alembic` (static compile of backend/auth/db/migration modules)
- `cd frontend; npm run build` (TypeScript + Vite production build)

## 9. Actual test results
- **Backend compileall:** passed (modules compiled successfully)
- **Frontend build:** passed (`vite build` succeeded; existing large chunk-size warning remains)
- **PostgreSQL/Alembic runtime migration:** **not executed in this environment** (PostgreSQL server/credentials and DB deps/runtime not provisioned here)
- **Auth acceptance workflows (register/login/bootstrap/admin/user/pgAdmin record verification):** **not verified end-to-end in this environment**

## 10. Remaining limitations
- Full **separate frontend auth routes/pages** (`/user/login`, `/user/signup`, `/admin/login`, `/admin/signup` invitation flow, forgot/reset/verify pages) and **separate admin dashboard UI** are not yet implemented.
- **Google/GitHub OAuth** backend+frontend flows (state/nonce, token exchange, identity linking, verified email handling) not completed.
- **MFA, CSRF, rate limiting/login protection, secure email delivery, reauthentication** and comprehensive session/account recovery UX need completion.
- **Real PostgreSQL connectivity, migrations, and pgAdmin 4 verification** must be performed in a configured environment; cannot be claimed complete from this session.
- Some admin metrics return placeholders until project/workspace/deployment tables and real aggregation queries are integrated.
- Invitation token handling should be moved to secure email-only delivery for production (currently returned in API response for setup/testing convenience).

## 11. PROJECT_STATUS.md update
- Updated this file to reflect **v3.1.0 auth/RBAC PostgreSQL foundation in progress**, implemented modules, commands, security status, test results, and limitations.

## 12. Next task
1. Provision/configure PostgreSQL (`opspilot_db`) locally and run `alembic upgrade head`; verify tables in pgAdmin 4.
2. Install backend deps in venv and execute runtime smoke tests for `admin/bootstrap`, `user/register`, `user/login`, `admin/login`, `/auth/me`, role assignment, and audit/session persistence.
3. Implement frontend auth routing and pages (user/admin login/signup/verify/reset) + session-aware guards and dynamic current-user integration.
4. Complete invitation acceptance UI flow, admin dashboard/user management UI, and secure token delivery/email integration.
5. Implement OAuth (Google/GitHub), CSRF/rate limiting/MFA hardening, then run full acceptance tests and pgAdmin verification evidence.
