"""projects: tabelas projects + project_services (grupo CI/CD)

Revision ID: 0012_projects
Revises: 0011_deploy_git_docker
Create Date: 2026-07-07
"""
from alembic import op
import sqlalchemy as sa

revision = "0012_projects"
down_revision = "0011_deploy_git_docker"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("tags", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "project_services",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="created"),
        sa.Column("config", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("container_id", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_project_services_project_id", "project_services", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_project_services_project_id", table_name="project_services")
    op.drop_table("project_services")
    op.drop_table("projects")
