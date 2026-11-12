"""Verify Alembic migrations on a disposable PostgreSQL database.

This never touches the configured application database. It creates a temporary
database, upgrades to head, downgrades one revision, upgrades again, then drops
the temporary database.

Usage (from backend/, with the project venv):
    python scripts/verify_migrations.py
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.config import get_settings  # noqa: E402

TEMP_DB = "opspilot_migration_test"
OPS_TABLES = {"knowledge_documents", "tickets", "approval_requests"}
PHASE2_TABLES = {"projects", "project_files", "conversations", "messages", "tool_operations"}
AUTH_TABLES = {"users", "roles", "permissions", "user_roles", "role_permissions", "audit_logs"}


def _admin_engine(base_url):
    admin_url = make_url(base_url).set(database="postgres")
    return create_engine(admin_url, isolation_level="AUTOCOMMIT")


def _run_alembic(*args: str, database_url: str) -> None:
    env = dict(os.environ)
    env["DATABASE_URL"] = database_url
    env["PYTHONPATH"] = str(BACKEND_DIR)
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=str(BACKEND_DIR),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    print(f"$ alembic {' '.join(args)} -> exit {result.returncode}")
    if result.stdout.strip():
        print(result.stdout.strip()[-2000:])
    if result.returncode != 0:
        print(result.stderr.strip()[-4000:])
        raise SystemExit(f"Alembic command failed: {' '.join(args)}")


def _inspect(database_url: str) -> tuple[str, set[str]]:
    engine = create_engine(database_url)
    with engine.connect() as conn:
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
        tables = {
            row[0]
            for row in conn.execute(
                text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
            )
        }
    engine.dispose()
    return str(version), tables


def main() -> int:
    base_url = get_settings().database_url
    test_url = make_url(base_url).set(database=TEMP_DB).render_as_string(hide_password=False)
    admin = _admin_engine(base_url)
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{TEMP_DB}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{TEMP_DB}"'))
    admin.dispose()
    print(f"Created disposable database {TEMP_DB}")

    try:
        _run_alembic("upgrade", "head", database_url=test_url)
        version, tables = _inspect(test_url)
        assert version == "0003_ops_persistence", version
        assert OPS_TABLES <= tables, OPS_TABLES - tables
        assert PHASE2_TABLES <= tables, PHASE2_TABLES - tables
        assert AUTH_TABLES <= tables, AUTH_TABLES - tables
        print("upgrade head: ops, phase-2 and auth tables present")

        _run_alembic("downgrade", "0002_phase2_chat_projects", database_url=test_url)
        version, tables = _inspect(test_url)
        assert version == "0002_phase2_chat_projects", version
        assert not (OPS_TABLES & tables), OPS_TABLES & tables
        assert PHASE2_TABLES <= tables, PHASE2_TABLES - tables
        assert AUTH_TABLES <= tables, AUTH_TABLES - tables
        print("downgrade to 0002: ops tables removed, phase-2/auth tables intact")

        _run_alembic("downgrade", "0001_auth_rbac_core", database_url=test_url)
        version, tables = _inspect(test_url)
        assert version == "0001_auth_rbac_core", version
        assert not (OPS_TABLES & tables), OPS_TABLES & tables
        assert not (PHASE2_TABLES & tables), PHASE2_TABLES & tables
        assert AUTH_TABLES <= tables, AUTH_TABLES - tables
        print("downgrade to 0001: phase-2/ops tables removed, auth tables intact")

        _run_alembic("upgrade", "head", database_url=test_url)
        version, tables = _inspect(test_url)
        assert version == "0003_ops_persistence", version
        assert OPS_TABLES <= tables
        assert PHASE2_TABLES <= tables
        print("re-upgrade head: schema restored")
    finally:
        admin = _admin_engine(base_url)
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{TEMP_DB}" WITH (FORCE)'))
        admin.dispose()
        print(f"Dropped disposable database {TEMP_DB}")

    print("MIGRATION VERIFICATION PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
