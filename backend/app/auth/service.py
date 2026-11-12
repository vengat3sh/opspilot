import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db.models import AdminInvitation, AuditLog, EmailVerificationToken, PasswordResetToken, Role, User, UserRole, UserSession
from .security import generate_refresh_token, hash_password, hash_token, normalize_email, verify_password

DEFAULT_ROLES = [
    ("Super Admin", "Full platform administration"),
    ("Admin", "Scoped administration and user management"),
    ("Developer", "Project development and engineering workflows"),
    ("Reviewer", "Review and approve permitted changes"),
    ("Viewer", "Read-only access to permitted resources"),
]


def ensure_default_roles(db: Session) -> None:
    existing = {r.name for r in db.execute(select(Role)).scalars().all()}
    changed = False
    for name, desc in DEFAULT_ROLES:
        if name not in existing:
            db.add(Role(name=name, description=desc))
            changed = True
    if changed:
        db.commit()


def get_or_create_role(db: Session, name: str) -> Role:
    role = db.execute(select(Role).where(Role.name == name)).scalar_one_or_none()
    if not role:
        role = Role(name=name, description=name)
        db.add(role)
        db.commit()
        db.refresh(role)
    return role


def assign_role(db: Session, user: User, role_name: str, assigned_by: User | None = None) -> None:
    role = get_or_create_role(db, role_name)
    exists = db.execute(select(UserRole).where(UserRole.user_id == user.id, UserRole.role_id == role.id)).scalar_one_or_none()
    if not exists:
        db.add(UserRole(user_id=user.id, role_id=role.id, assigned_by=assigned_by.id if assigned_by else None))
        db.commit()


def get_user_roles(db: Session, user: User) -> list[str]:
    rows = db.execute(
        select(Role.name).join(UserRole, UserRole.role_id == Role.id).where(UserRole.user_id == user.id)
    ).scalars().all()
    return list(rows)


def log_audit(db: Session, actor_id, action: str, target_type: str | None = None, target_id: str | None = None, ip: str | None = None, metadata: dict | None = None) -> None:
    db.add(AuditLog(actor_user_id=actor_id, action=action, target_type=target_type, target_id=str(target_id) if target_id else None, ip_address=ip, metadata_json=metadata or {}))
    db.commit()


def create_user(db: Session, full_name: str, email: str, password: str, verified: bool = False) -> User:
    norm = normalize_email(email)
    existing = db.execute(select(User).where(User.normalized_email == norm)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists")
    user = User(full_name=full_name.strip(), email=email.strip(), normalized_email=norm, password_hash=hash_password(password), is_verified=verified, is_active=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate_user(db: Session, email: str, password: str) -> User:
    norm = normalize_email(email)
    user = db.execute(select(User).where(User.normalized_email == norm, User.deleted_at.is_(None))).scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is suspended or inactive")
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return user


def create_session(db: Session, user: User, user_agent: str | None = None, ip: str | None = None, days: int = 30) -> str:
    raw = generate_refresh_token()
    session = UserSession(
        user_id=user.id,
        refresh_token_hash=hash_token(raw),
        user_agent=user_agent,
        ip_address=ip,
        expires_at=datetime.now(timezone.utc) + timedelta(days=days),
    )
    db.add(session)
    db.commit()
    return raw


def revoke_session_by_refresh(db: Session, raw_refresh: str) -> None:
    token_hash = hash_token(raw_refresh)
    sess = db.execute(select(UserSession).where(UserSession.refresh_token_hash == token_hash, UserSession.revoked_at.is_(None))).scalar_one_or_none()
    if sess:
        sess.revoked_at = datetime.now(timezone.utc)
        db.commit()


def rotate_session(db: Session, raw_refresh: str, user_agent: str | None = None, ip: str | None = None) -> tuple[User, str]:
    token_hash = hash_token(raw_refresh)
    sess = db.execute(select(UserSession).where(UserSession.refresh_token_hash == token_hash)).scalar_one_or_none()
    if not sess or sess.revoked_at is not None or sess.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session")
    user = db.get(User, sess.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session user")
    sess.revoked_at = datetime.now(timezone.utc)
    sess.last_used_at = datetime.now(timezone.utc)
    db.commit()
    new_raw = create_session(db, user, user_agent=user_agent, ip=ip)
    return user, new_raw


def create_email_verification_token(db: Session, user: User) -> str:
    raw = secrets.token_urlsafe(32)
    db.add(EmailVerificationToken(user_id=user.id, token_hash=hash_token(raw), expires_at=datetime.now(timezone.utc) + timedelta(hours=24)))
    db.commit()
    return raw


def verify_email_token(db: Session, raw_token: str) -> User:
    tok = db.execute(select(EmailVerificationToken).where(EmailVerificationToken.token_hash == hash_token(raw_token))).scalar_one_or_none()
    if not tok or tok.used_at or tok.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired verification token")
    user = db.get(User, tok.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.is_verified = True
    tok.used_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return user


def create_password_reset_token(db: Session, email: str) -> str | None:
    norm = normalize_email(email)
    user = db.execute(select(User).where(User.normalized_email == norm)).scalar_one_or_none()
    if not user:
        return None
    raw = secrets.token_urlsafe(32)
    db.add(PasswordResetToken(user_id=user.id, token_hash=hash_token(raw), expires_at=datetime.now(timezone.utc) + timedelta(hours=1)))
    db.commit()
    return raw


def reset_password_with_token(db: Session, raw_token: str, new_password: str) -> User:
    tok = db.execute(select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(raw_token))).scalar_one_or_none()
    if not tok or tok.used_at or tok.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset token")
    user = db.get(User, tok.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.password_hash = hash_password(new_password)
    tok.used_at = datetime.now(timezone.utc)
    # Revoke all sessions for safety
    sessions = db.execute(select(UserSession).where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))).scalars().all()
    for s in sessions:
        s.revoked_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return user


def create_admin_invitation(db: Session, email: str, role_name: str, invited_by: User) -> tuple[AdminInvitation, str]:
    if role_name not in {"Super Admin", "Admin"}:
        raise HTTPException(status_code=400, detail="Invalid admin role")
    raw = secrets.token_urlsafe(32)
    inv = AdminInvitation(
        email=email.strip(),
        normalized_email=normalize_email(email),
        role_name=role_name,
        token_hash=hash_token(raw),
        invited_by_user_id=invited_by.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=2),
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return inv, raw


def accept_admin_invitation(db: Session, token: str, full_name: str, password: str) -> User:
    inv = db.execute(select(AdminInvitation).where(AdminInvitation.token_hash == hash_token(token))).scalar_one_or_none()
    if not inv or inv.accepted_at or inv.revoked_at or inv.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invalid or expired invitation")
    user = db.execute(select(User).where(User.normalized_email == inv.normalized_email)).scalar_one_or_none()
    if not user:
        user = create_user(db, full_name, inv.email, password, verified=True)
    else:
        user.full_name = full_name.strip()
        user.password_hash = hash_password(password)
        user.is_verified = True
        user.is_active = True
        db.commit()
        db.refresh(user)
    assign_role(db, user, inv.role_name)
    inv.accepted_at = datetime.now(timezone.utc)
    db.commit()
    return user


def has_any_admin(db: Session) -> bool:
    q = (
        select(func.count())
        .select_from(UserRole)
        .join(Role, Role.id == UserRole.role_id)
        .where(Role.name.in_(["Super Admin", "Admin"]))
    )
    return (db.execute(q).scalar() or 0) > 0
