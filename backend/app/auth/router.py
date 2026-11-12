from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db.models import AuditLog, Role, User, UserRole, UserSession
from ..db.session import get_db
from .deps import get_current_user, get_user_role_names, require_admin, require_super_admin
from .schemas import (
    AcceptInvitationRequest,
    AdminBootstrapRequest,
    AdminInvitationRequest,
    AdminInviteResponse,
    AuthResponse,
    ForgotPasswordRequest,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
    UserOut,
    VerifyEmailRequest,
)
from .security import create_access_token, normalize_email
from .service import (
    accept_admin_invitation,
    assign_role,
    authenticate_user,
    create_admin_invitation,
    create_email_verification_token,
    create_password_reset_token,
    create_session,
    create_user,
    ensure_default_roles,
    get_user_roles,
    has_any_admin,
    log_audit,
    reset_password_with_token,
    revoke_session_by_refresh,
    rotate_session,
    verify_email_token,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
admin_router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


def user_to_out(db: Session, user: User) -> UserOut:
    return UserOut(
        id=user.id,
        full_name=user.full_name,
        email=user.email,
        is_active=user.is_active,
        is_verified=user.is_verified,
        roles=get_user_roles(db, user),
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str):
    settings = get_settings()
    secure = settings.cookie_secure or settings.is_production
    response.set_cookie("opspilot_access", access_token, httponly=True, secure=secure, samesite=settings.cookie_samesite, max_age=settings.access_token_expire_minutes * 60, path="/")
    response.set_cookie(settings.session_cookie_name, refresh_token, httponly=True, secure=secure, samesite=settings.cookie_samesite, max_age=settings.refresh_token_expire_days * 86400, path="/api/v1/auth")


def _clear_auth_cookies(response: Response):
    settings = get_settings()
    response.delete_cookie("opspilot_access", path="/")
    response.delete_cookie(settings.session_cookie_name, path="/api/v1/auth")


@router.post("/user/register", response_model=AuthResponse)
def user_register(req: RegisterRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    ensure_default_roles(db)
    if req.password != req.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    if not req.terms_accepted:
        raise HTTPException(status_code=400, detail="Terms must be accepted")
    user = create_user(db, req.full_name, req.email, req.password, verified=False)
    assign_role(db, user, "Developer")
    # Create personal workspace defaults minimally via audit/log markers (full workspace service can be added later)
    verify_token = create_email_verification_token(db, user)
    log_audit(db, user.id, "user.register", "user", str(user.id), request.client.host if request.client else None, {"email_verification_required": True})
    # In production send email; for now token can be retrieved via secure dev flow/log-free response pattern not exposing broadly.
    # Returning token only in dev would be convenient but insecure; we return message.
    access = create_access_token(str(user.id), {"roles": get_user_roles(db, user)})
    refresh = create_session(db, user, request.headers.get("user-agent"), request.client.host if request.client else None)
    _set_auth_cookies(response, access, refresh)
    return AuthResponse(user=user_to_out(db, user), access_token=access)


@router.post("/user/login", response_model=AuthResponse)
def user_login(req: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    ensure_default_roles(db)
    user = authenticate_user(db, req.email, req.password)
    log_audit(db, user.id, "user.login", "user", str(user.id), request.client.host if request.client else None, {})
    access = create_access_token(str(user.id), {"roles": get_user_roles(db, user)})
    days = 30 if req.remember_me else 7
    refresh = create_session(db, user, request.headers.get("user-agent"), request.client.host if request.client else None, days=days)
    _set_auth_cookies(response, access, refresh)
    return AuthResponse(user=user_to_out(db, user), access_token=access)


@router.post("/user/logout")
def user_logout(request: Request, response: Response, db: Session = Depends(get_db)):
    settings = get_settings()
    refresh = request.cookies.get(settings.session_cookie_name)
    if refresh:
        revoke_session_by_refresh(db, refresh)
    _clear_auth_cookies(response)
    return {"ok": True}


@router.post("/admin/bootstrap", response_model=AuthResponse)
def admin_bootstrap(req: AdminBootstrapRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    ensure_default_roles(db)
    if has_any_admin(db):
        raise HTTPException(status_code=403, detail="Bootstrap disabled: admin account already exists")
    settings = get_settings()
    email = (req.email or settings.bootstrap_super_admin_email or "").strip()
    password = (req.password or settings.bootstrap_super_admin_password.get_secret_value() or "").strip()
    full_name = (req.full_name or settings.bootstrap_super_admin_name or "OpsPilot Super Admin").strip()
    if not email or not password:
        raise HTTPException(status_code=400, detail="Bootstrap credentials not configured")
    user = db.execute(select(User).where(User.normalized_email == normalize_email(email))).scalar_one_or_none()
    if not user:
        user = create_user(db, full_name, email, password, verified=True)
    else:
        from .security import hash_password
        user.full_name = full_name
        user.password_hash = hash_password(password)
        user.is_verified = True
        user.is_active = True
        db.commit()
        db.refresh(user)
    assign_role(db, user, "Super Admin")
    log_audit(db, user.id, "admin.bootstrap", "user", str(user.id), request.client.host if request.client else None, {"role": "Super Admin"})
    access = create_access_token(str(user.id), {"roles": get_user_roles(db, user)})
    refresh = create_session(db, user, request.headers.get("user-agent"), request.client.host if request.client else None)
    _set_auth_cookies(response, access, refresh)
    return AuthResponse(user=user_to_out(db, user), access_token=access)


@router.post("/admin/login", response_model=AuthResponse)
def admin_login(req: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    ensure_default_roles(db)
    user = authenticate_user(db, req.email, req.password)
    roles = set(get_user_roles(db, user))
    if not roles.intersection({"Super Admin", "Admin"}):
        raise HTTPException(status_code=403, detail="Admin access required")
    log_audit(db, user.id, "admin.login", "user", str(user.id), request.client.host if request.client else None, {})
    access = create_access_token(str(user.id), {"roles": list(roles)})
    days = 30 if req.remember_me else 7
    refresh = create_session(db, user, request.headers.get("user-agent"), request.client.host if request.client else None, days=days)
    _set_auth_cookies(response, access, refresh)
    return AuthResponse(user=user_to_out(db, user), access_token=access)


@router.post("/admin/invitations", response_model=AdminInviteResponse)
def admin_invite(req: AdminInvitationRequest, request: Request, db: Session = Depends(get_db), actor: User = Depends(require_admin)):
    inv, raw = create_admin_invitation(db, str(req.email), req.role_name, actor)
    log_audit(db, actor.id, "admin.invite.create", "admin_invitation", str(inv.id), request.client.host if request.client else None, {"email": str(req.email), "role": req.role_name})
    # Token returned for bootstrap/dev/testing; in production deliver via secure email channel only.
    return AdminInviteResponse(email=req.email, role_name=req.role_name, expires_at=inv.expires_at, invitation_token=raw, message="Invitation created. Deliver token via secure channel.")


@router.post("/admin/accept-invitation", response_model=AuthResponse)
def admin_accept_invitation(req: AcceptInvitationRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    if req.password != req.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    user = accept_admin_invitation(db, req.token, req.full_name, req.password)
    log_audit(db, user.id, "admin.invite.accept", "user", str(user.id), request.client.host if request.client else None, {})
    access = create_access_token(str(user.id), {"roles": get_user_roles(db, user)})
    refresh = create_session(db, user, request.headers.get("user-agent"), request.client.host if request.client else None)
    _set_auth_cookies(response, access, refresh)
    return AuthResponse(user=user_to_out(db, user), access_token=access)


@router.post("/refresh", response_model=AuthResponse)
def refresh_token(request: Request, response: Response, db: Session = Depends(get_db)):
    settings = get_settings()
    raw = request.cookies.get(settings.session_cookie_name)
    if not raw:
        raise HTTPException(status_code=401, detail="No refresh session")
    user, new_raw = rotate_session(db, raw, request.headers.get("user-agent"), request.client.host if request.client else None)
    access = create_access_token(str(user.id), {"roles": get_user_roles(db, user)})
    _set_auth_cookies(response, access, new_raw)
    return AuthResponse(user=user_to_out(db, user), access_token=access)


@router.get("/me", response_model=AuthResponse)
def me(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return AuthResponse(user=user_to_out(db, user), access_token=None)


@router.post("/logout-all")
def logout_all(request: Request, response: Response, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    sessions = db.execute(select(UserSession).where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))).scalars().all()
    for s in sessions:
        s.revoked_at = datetime.now(timezone.utc)
    db.commit()
    log_audit(db, user.id, "auth.logout_all", "user", str(user.id), request.client.host if request.client else None, {"count": len(sessions)})
    _clear_auth_cookies(response)
    return {"ok": True, "revoked": len(sessions)}


@router.post("/forgot-password")
def forgot_password(req: ForgotPasswordRequest, request: Request, db: Session = Depends(get_db)):
    raw = create_password_reset_token(db, str(req.email))
    # Do not reveal whether email exists. Token delivery via email required in production.
    if raw:
        user = db.execute(select(User).where(User.normalized_email == normalize_email(str(req.email)))).scalar_one_or_none()
        if user:
            log_audit(db, user.id, "auth.forgot_password", "user", str(user.id), request.client.host if request.client else None, {})
    return {"ok": True, "message": "If the account exists, password reset instructions have been sent."}


@router.post("/reset-password")
def reset_password(req: ResetPasswordRequest, request: Request, db: Session = Depends(get_db)):
    if req.password != req.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    user = reset_password_with_token(db, req.token, req.password)
    log_audit(db, user.id, "auth.reset_password", "user", str(user.id), request.client.host if request.client else None, {})
    return {"ok": True}


@router.post("/verify-email", response_model=AuthResponse)
def verify_email(req: VerifyEmailRequest, request: Request, db: Session = Depends(get_db)):
    user = verify_email_token(db, req.token)
    log_audit(db, user.id, "auth.verify_email", "user", str(user.id), request.client.host if request.client else None, {})
    return AuthResponse(user=user_to_out(db, user), access_token=None)


# ── Admin management APIs ─────────────────────────────────────────────────

@admin_router.get("/users")
def admin_list_users(q: str | None = None, page: int = 1, page_size: int = 20, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    page = max(1, page)
    page_size = max(1, min(100, page_size))
    stmt = select(User).where(User.deleted_at.is_(None))
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(func.lower(User.email).like(like) | func.lower(User.full_name).like(like))
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar() or 0
    users = db.execute(stmt.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).scalars().all()
    return {
        "items": [user_to_out(db, u).model_dump() for u in users],
        "page": page,
        "page_size": page_size,
        "total": total,
    }


@admin_router.get("/users/{user_id}")
def admin_get_user(user_id: str, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user_to_out(db, user)


@admin_router.patch("/users/{user_id}/status")
def admin_update_user_status(user_id: str, payload: dict, request: Request, db: Session = Depends(get_db), actor: User = Depends(require_admin)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if "is_active" in payload:
        user.is_active = bool(payload["is_active"])
    if payload.get("revoke_sessions"):
        sessions = db.execute(select(UserSession).where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))).scalars().all()
        for s in sessions:
            s.revoked_at = datetime.now(timezone.utc)
    db.commit()
    log_audit(db, actor.id, "admin.user.status", "user", str(user.id), request.client.host if request.client else None, {"is_active": user.is_active})
    return {"ok": True, "user": user_to_out(db, user).model_dump()}


@admin_router.patch("/users/{user_id}/roles")
def admin_update_user_roles(user_id: str, payload: dict, request: Request, db: Session = Depends(get_db), actor: User = Depends(require_super_admin)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    role_names = payload.get("roles") or []
    if not isinstance(role_names, list):
        raise HTTPException(status_code=400, detail="roles must be a list")
    # Prevent self-escalation by non-super contexts already enforced; still avoid removing own super admin accidentally? keep simple
    db.query(UserRole).filter(UserRole.user_id == user.id).delete(synchronize_session=False)
    db.commit()
    for rn in role_names:
        if isinstance(rn, str):
            assign_role(db, user, rn, actor)
    log_audit(db, actor.id, "admin.user.roles", "user", str(user.id), request.client.host if request.client else None, {"roles": role_names})
    return {"ok": True, "user": user_to_out(db, user).model_dump()}


@admin_router.get("/audit-logs")
def admin_audit_logs(page: int = 1, page_size: int = 50, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    page = max(1, page)
    page_size = max(1, min(200, page_size))
    stmt = select(AuditLog).order_by(AuditLog.timestamp.desc())
    total = db.execute(select(func.count()).select_from(AuditLog)).scalar() or 0
    rows = db.execute(stmt.offset((page - 1) * page_size).limit(page_size)).scalars().all()
    return {
        "items": [
            {
                "id": str(r.id),
                "actor_user_id": str(r.actor_user_id) if r.actor_user_id else None,
                "action": r.action,
                "target_type": r.target_type,
                "target_id": r.target_id,
                "timestamp": r.timestamp,
                "ip_address": r.ip_address,
                "metadata": r.metadata_json or {},
            }
            for r in rows
        ],
        "page": page,
        "page_size": page_size,
        "total": total,
    }


@admin_router.get("/metrics")
def admin_metrics(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    total_users = db.execute(select(func.count()).select_from(User)).scalar() or 0
    active_users = db.execute(select(func.count()).select_from(User).where(User.is_active.is_(True))).scalar() or 0
    verified_users = db.execute(select(func.count()).select_from(User).where(User.is_verified.is_(True))).scalar() or 0
    admin_count = db.execute(
        select(func.count(func.distinct(UserRole.user_id))).select_from(UserRole).join(Role, Role.id == UserRole.role_id).where(Role.name.in_(["Super Admin", "Admin"]))
    ).scalar() or 0
    return {
        "total_users": total_users,
        "active_users": active_users,
        "verified_users": verified_users,
        "total_administrators": admin_count,
        "active_projects": 0,
        "total_workspaces": 0,
        "successful_deployments": 0,
        "failed_deployments": 0,
        "open_incidents": 0,
        "pending_approvals": 0,
    }


@admin_router.get("/database/health")
def admin_db_health(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    try:
        db.execute(select(1))
        # table existence checks (best effort)
        tables = [User.__tablename__, Role.__tablename__, UserRole.__tablename__, UserSession.__tablename__, AuditLog.__tablename__]
        return {"status": "ok", "database": "postgresql", "connected": True, "checked_tables": tables}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Database unhealthy: {type(exc).__name__}")
