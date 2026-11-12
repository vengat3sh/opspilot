import logging
import traceback
import uuid
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .routers import chat, conversations, diagnostics, operations, projects, tools
from .auth.router import admin_router, router as auth_router

settings = get_settings()
logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("opspilot")

app = FastAPI(title="OpsPilot API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_context_and_errors(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    request.state.request_id = request_id
    try:
        response = await call_next(request)
    except Exception:
        # Log safely on server; never expose internal details/tokens/passwords to client
        logger.exception(
            "unhandled_exception request_id=%s method=%s path=%s error=%s",
            request_id,
            request.method,
            request.url.path,
            traceback.format_exc(limit=5).splitlines()[-1] if traceback.format_exc() else "unknown",
        )
        logger.error(
            "unhandled_exception_trace request_id=%s method=%s path=%s\n%s",
            request_id,
            request.method,
            request.url.path,
            traceback.format_exc(),
        )
        response = JSONResponse(status_code=500, content={"detail": "Internal server error"})
    response.headers["X-Request-ID"] = request_id
    content_type = response.headers.get("content-type", "")
    if "text/html" in content_type or request.url.path == "/":
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


app.include_router(chat.router)
app.include_router(conversations.router)
app.include_router(tools.router)
app.include_router(diagnostics.router)
app.include_router(operations.router)
app.include_router(projects.router)
app.include_router(auth_router)
app.include_router(admin_router)


@app.get("/health")
async def health():
    """Liveness/readiness-style health check with safe diagnostics (no credentials)."""
    db_ok = False
    db_error = None
    migration_version = None
    try:
        from sqlalchemy import text
        from .db.session import engine

        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            db_ok = True
            try:
                row = conn.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).fetchone()
                migration_version = row[0] if row else None
            except Exception:
                migration_version = None
    except Exception as exc:
        db_error = type(exc).__name__

    overall_ok = db_ok
    return {
        "status": "ok" if overall_ok else "degraded",
        "service": "opspilot-api",
        "version": app.version,
        "checks": {
            "database": {"ok": db_ok, "error": db_error},
            "migrations": {"ok": migration_version is not None, "version": migration_version},
        },
    }


@app.get("/api/v1/diagnostics/auth")
async def auth_diagnostics(request: Request):
    """Protected, non-sensitive auth subsystem diagnostics. Requires X-Diagnostics-Token matching OPS/DIAGNOSTICS_TOKEN env."""
    token = (get_settings().diagnostics_token.get_secret_value() or "").strip()
    provided = (request.headers.get("x-diagnostics-token") or "").strip()
    if not token or provided != token:
        # Do not reveal whether diagnostics are enabled
        return JSONResponse(status_code=404, content={"detail": "Not Found"})

    checks = {}
    try:
        from sqlalchemy.orm import configure_mappers
        from sqlalchemy import text, select
        from .db.session import engine, SessionLocal
        from .db import models  # noqa: F401
        from .auth import security, service

        try:
            configure_mappers()
            checks["mappers"] = {"ok": True}
        except Exception as exc:
            checks["mappers"] = {"ok": False, "error": type(exc).__name__}

        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            checks["db_connect"] = {"ok": True}
        except Exception as exc:
            checks["db_connect"] = {"ok": False, "error": type(exc).__name__}

        try:
            with engine.connect() as conn:
                row = conn.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).fetchone()
                checks["alembic_version"] = {"ok": row is not None, "version": row[0] if row else None}
        except Exception as exc:
            checks["alembic_version"] = {"ok": False, "error": type(exc).__name__}

        db = SessionLocal()
        try:
            try:
                db.execute(select(models.Role).limit(1)).all()
                roles = db.execute(select(models.Role.name)).scalars().all()
                checks["role_query"] = {"ok": True, "roles": sorted(set(roles))}
            except Exception as exc:
                checks["role_query"] = {"ok": False, "error": type(exc).__name__}

            try:
                db.execute(select(models.User).limit(1)).all()
                checks["user_query"] = {"ok": True}
            except Exception as exc:
                checks["user_query"] = {"ok": False, "error": type(exc).__name__}

            try:
                # Transaction test with rollback (no persistent writes)
                db.execute(text("SELECT 1"))
                db.rollback()
                checks["db_transaction"] = {"ok": True}
            except Exception as exc:
                db.rollback()
                checks["db_transaction"] = {"ok": False, "error": type(exc).__name__}
        finally:
            db.close()

        try:
            hashed = security.hash_password("DiagPass123!")
            checks["password_hash_verify"] = {"ok": security.verify_password("DiagPass123!", hashed)}
        except Exception as exc:
            checks["password_hash_verify"] = {"ok": False, "error": type(exc).__name__}

        try:
            tok = security.create_access_token("00000000-0000-0000-0000-000000000000", {"roles": []})
            decoded = security.decode_token(tok) or {}
            checks["jwt_roundtrip"] = {"ok": decoded.get("type") == "access" and decoded.get("sub") is not None}
        except Exception as exc:
            checks["jwt_roundtrip"] = {"ok": False, "error": type(exc).__name__}

    except Exception as exc:
        logger.exception("diagnostics_internal_error")
        return JSONResponse(status_code=500, content={"detail": "Diagnostics error", "error": type(exc).__name__})

    ok = all(v.get("ok") for v in checks.values() if isinstance(v, dict))
    return {"status": "ok" if ok else "degraded", "checks": checks}


# Production deployment: Mount frontend dist (works in Docker container & local dev)
possible_dists = [
    Path(__file__).resolve().parent.parent / "frontend" / "dist",
    Path(__file__).resolve().parent.parent.parent / "frontend" / "dist",
    Path("/srv/frontend/dist"),
]
for dist in possible_dists:
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=str(dist), html=True), name="frontend")
        break

