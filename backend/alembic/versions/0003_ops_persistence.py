"""persist knowledge documents, tickets and approval requests

Revision ID: 0003_ops_persistence
Revises: 0002_phase2_chat_projects
Create Date: 2026-11-12 16:30:00.000000

Additive migration: creates user-owned operational tables. It does not alter or
remove any table from earlier revisions.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0003_ops_persistence"
down_revision: Union[str, Sequence[str], None] = "0002_phase2_chat_projects"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "knowledge_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("filename", sa.String(length=512), nullable=False),
        sa.Column("file_type", sa.String(length=32), server_default="txt", nullable=False),
        sa.Column("size_bytes", sa.Integer(), server_default="0", nullable=False),
        sa.Column("chunks_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("indexed", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("category", sa.String(length=128), server_default="General", nullable=False),
        sa.Column("content", sa.Text(), server_default="", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_knowledge_documents_owner_user_id", "knowledge_documents", ["owner_user_id"], unique=False)
    op.create_index("ix_knowledge_documents_owner_created", "knowledge_documents", ["owner_user_id", "created_at"], unique=False)
    op.create_index("ix_knowledge_documents_owner_category", "knowledge_documents", ["owner_user_id", "category"], unique=False)

    op.create_table(
        "tickets",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("priority", sa.String(length=16), server_default="medium", nullable=False),
        sa.Column("status", sa.String(length=32), server_default="open", nullable=False),
        sa.Column("category", sa.String(length=128), server_default="IT Support", nullable=False),
        sa.Column("assigned_agent", sa.String(length=128), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tickets_owner_user_id", "tickets", ["owner_user_id"], unique=False)
    op.create_index("ix_tickets_owner_created", "tickets", ["owner_user_id", "created_at"], unique=False)
    op.create_index("ix_tickets_owner_status", "tickets", ["owner_user_id", "status"], unique=False)

    op.create_table(
        "approval_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action_type", sa.String(length=128), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("details", sa.Text(), server_default="", nullable=False),
        sa.Column("requested_by", sa.String(length=128), server_default="OpsPilot", nullable=False),
        sa.Column("risk_level", sa.String(length=16), server_default="medium", nullable=False),
        sa.Column("status", sa.String(length=32), server_default="pending", nullable=False),
        sa.Column("decided_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["decided_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_approval_requests_owner_user_id", "approval_requests", ["owner_user_id"], unique=False)
    op.create_index("ix_approval_requests_owner_status", "approval_requests", ["owner_user_id", "status"], unique=False)
    op.create_index("ix_approval_requests_owner_created", "approval_requests", ["owner_user_id", "created_at"], unique=False)


def downgrade() -> None:
    # Additive-only rollback: remove only tables introduced in 0003.
    op.drop_table("approval_requests")
    op.drop_table("tickets")
    op.drop_table("knowledge_documents")
