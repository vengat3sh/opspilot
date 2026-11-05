import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .routers import chat

settings = get_settings()
logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = FastAPI(title="OpsPilot API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(chat.router)


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

