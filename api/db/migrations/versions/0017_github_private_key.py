"""git providers: private key dedicada para GitHub App

Revision ID: 0017_github_private_key
Revises: 0016_git_provider_apps
Create Date: 2026-07-09
"""
from alembic import op
import sqlalchemy as sa

revision = "0017_github_private_key"
down_revision = "0016_git_provider_apps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("git_providers", sa.Column("github_app_slug", sa.String(length=120), nullable=False, server_default=""))
    op.add_column("git_providers", sa.Column("github_client_id", sa.String(length=255), nullable=False, server_default=""))
    op.add_column("git_providers", sa.Column("github_private_key", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("git_providers", "github_private_key")
    op.drop_column("git_providers", "github_client_id")
    op.drop_column("git_providers", "github_app_slug")
