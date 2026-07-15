"""deployments: histórico de deploys de serviços

Revision ID: 0015_project_deployments
Revises: 0014_ssh_registry
Create Date: 2026-07-08
"""
from alembic import op
import sqlalchemy as sa

revision = "0015_project_deployments"
down_revision = "0014_ssh_registry"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_deployments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("service_id", sa.Integer(), nullable=False),
        sa.Column("service_kind", sa.String(length=20), nullable=False, server_default=""),
        sa.Column("job_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="queued"),
        sa.Column("type", sa.String(length=16), nullable=False, server_default="manual"),
        sa.Column("container_id", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("user", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("started_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("finished_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_project_deployments_project_id", "project_deployments", ["project_id"])
    op.create_index("ix_project_deployments_service_id", "project_deployments", ["service_id"])
    op.create_index("ix_project_deployments_service_kind", "project_deployments", ["service_kind"])
    op.create_index("ix_project_deployments_job_id", "project_deployments", ["job_id"])
    op.create_index("ix_project_deployments_status", "project_deployments", ["status"])
    op.create_index("ix_project_deployments_created_ts", "project_deployments", ["created_ts"])
    op.create_table(
        "project_application_deployments",
        sa.Column("deployment_id", sa.Integer(), nullable=False),
        sa.Column("preview_key", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("preview_url", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("server_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("source_branch", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("source_commit", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("source_commit_desc", sa.String(length=500), nullable=False, server_default=""),
        sa.PrimaryKeyConstraint("deployment_id"),
        sa.UniqueConstraint("preview_key"),
    )
    op.create_index("ix_project_application_deployments_preview_key", "project_application_deployments", ["preview_key"])
    op.create_table(
        "project_compose_deployments",
        sa.Column("deployment_id", sa.Integer(), nullable=False),
        sa.Column("preview_key", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("preview_url", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("server_name", sa.String(length=255), nullable=False, server_default=""),
        sa.PrimaryKeyConstraint("deployment_id"),
        sa.UniqueConstraint("preview_key"),
    )
    op.create_index("ix_project_compose_deployments_preview_key", "project_compose_deployments", ["preview_key"])
    op.create_table(
        "project_database_deployments",
        sa.Column("deployment_id", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("deployment_id"),
    )
    op.create_table(
        "project_deployment_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("deployment_id", sa.Integer(), nullable=False),
        sa.Column("ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("phase", sa.String(length=40), nullable=False, server_default="setup"),
        sa.Column("level", sa.String(length=16), nullable=False, server_default="info"),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_project_deployment_events_deployment_id", "project_deployment_events", ["deployment_id"])
    op.create_index("ix_project_deployment_events_ts", "project_deployment_events", ["ts"])


def downgrade() -> None:
    op.drop_index("ix_project_deployment_events_ts", table_name="project_deployment_events")
    op.drop_index("ix_project_deployment_events_deployment_id", table_name="project_deployment_events")
    op.drop_table("project_deployment_events")
    op.drop_table("project_database_deployments")
    op.drop_index("ix_project_compose_deployments_preview_key", table_name="project_compose_deployments")
    op.drop_table("project_compose_deployments")
    op.drop_index("ix_project_application_deployments_preview_key", table_name="project_application_deployments")
    op.drop_table("project_application_deployments")
    op.drop_index("ix_project_deployments_created_ts", table_name="project_deployments")
    op.drop_index("ix_project_deployments_status", table_name="project_deployments")
    op.drop_index("ix_project_deployments_job_id", table_name="project_deployments")
    op.drop_index("ix_project_deployments_service_kind", table_name="project_deployments")
    op.drop_index("ix_project_deployments_service_id", table_name="project_deployments")
    op.drop_index("ix_project_deployments_project_id", table_name="project_deployments")
    op.drop_table("project_deployments")
