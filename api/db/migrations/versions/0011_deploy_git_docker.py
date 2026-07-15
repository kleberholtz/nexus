"""deploy: git_providers + colunas git/docker em deploy_apps

Revision ID: 0011_deploy_git_docker
Revises: 0010_deploy
Create Date: 2026-07-06
"""
from alembic import op
import sqlalchemy as sa

revision = "0011_deploy_git_docker"
down_revision = "0010_deploy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "git_providers",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("base_url", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("token", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.add_column("deploy_apps", sa.Column("provider_id", sa.Integer(), nullable=True))
    op.add_column("deploy_apps", sa.Column("git_url", sa.String(length=500), nullable=False, server_default=""))
    op.add_column("deploy_apps", sa.Column("branch_filter", sa.String(length=255), nullable=False, server_default=""))
    op.add_column("deploy_apps", sa.Column("webhook_kind", sa.String(length=20), nullable=False, server_default=""))
    op.add_column("deploy_apps", sa.Column("webhook_secret", sa.String(length=64), nullable=False, server_default=""))
    op.add_column("deploy_apps", sa.Column("dockerfile_path", sa.String(length=255), nullable=False, server_default="Dockerfile"))
    op.add_column("deploy_apps", sa.Column("build_context", sa.String(length=255), nullable=False, server_default="."))
    op.add_column("deploy_apps", sa.Column("build_args", sa.Text(), nullable=False, server_default="{}"))
    op.create_index("ix_deploy_apps_provider_id", "deploy_apps", ["provider_id"])


def downgrade() -> None:
    op.drop_index("ix_deploy_apps_provider_id", table_name="deploy_apps")
    for col in ("build_args", "build_context", "dockerfile_path", "webhook_secret",
                "webhook_kind", "branch_filter", "git_url", "provider_id"):
        op.drop_column("deploy_apps", col)
    op.drop_table("git_providers")
