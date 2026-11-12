import logging
import traceback
import uuid
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .routers import chat, operations, projects
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
app.include_router(operations.router)
app.include_router(projects.router)
app.include_router(auth_router)
app.include_router(admin_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "opspilot-api", "version": app.version}


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

