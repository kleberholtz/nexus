"""deploy: tabelas deploy_apps e deploys (feature de deployment)

Revision ID: 0010_deploy
Revises: 0009_cert_ca
Create Date: 2026-07-06
"""
from alembic import op
import sqlalchemy as sa

revision = "0010_deploy"
down_revision = "0009_cert_ca"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "deploy_apps",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False, server_default="static"),
        sa.Column("root", sa.String(length=400), nullable=False),
        sa.Column("keep_releases", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("server_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_deploy_apps_slug", "deploy_apps", ["slug"], unique=True)

    op.create_table(
        "deploys",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("app_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="upload"),
        sa.Column("ref", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("image", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("release_dir", sa.String(length=400), nullable=False, server_default=""),
        sa.Column("logs_path", sa.String(length=400), nullable=False, server_default=""),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("user", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("started_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("finished_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_deploys_app_id", "deploys", ["app_id"])
    op.create_index("ix_deploys_status", "deploys", ["status"])
    op.create_index("ix_deploys_created_ts", "deploys", ["created_ts"])


def downgrade() -> None:
    op.drop_index("ix_deploys_created_ts", table_name="deploys")
    op.drop_index("ix_deploys_status", table_name="deploys")
    op.drop_index("ix_deploys_app_id", table_name="deploys")
    op.drop_table("deploys")
    op.drop_index("ix_deploy_apps_slug", table_name="deploy_apps")
    op.drop_table("deploy_apps")
