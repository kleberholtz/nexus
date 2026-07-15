"""git providers: apps e bitbucket token

Revision ID: 0016_git_provider_apps
Revises: 0015_project_deployments
Create Date: 2026-07-08
"""
from alembic import op
import sqlalchemy as sa

revision = "0016_git_provider_apps"
down_revision = "0015_project_deployments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("git_providers", sa.Column("name", sa.String(length=80), nullable=False, server_default=""))
    op.add_column("git_providers", sa.Column("app_id", sa.String(length=255), nullable=False, server_default=""))
    op.add_column("git_providers", sa.Column("app_secret", sa.String(length=255), nullable=False, server_default=""))
    op.add_column("git_providers", sa.Column("webhook_secret", sa.String(length=64), nullable=False, server_default=""))
    op.create_index("ix_git_providers_name", "git_providers", ["name"])


def downgrade() -> None:
    op.drop_index("ix_git_providers_name", table_name="git_providers")
    op.drop_column("git_providers", "webhook_secret")
    op.drop_column("git_providers", "app_secret")
    op.drop_column("git_providers", "app_id")
    op.drop_column("git_providers", "name")
