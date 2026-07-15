"""cicd: tabelas ssh_keys + docker_registries (Configurações do CI/CD)

Revision ID: 0014_ssh_registry
Revises: 0013_service_slug
Create Date: 2026-07-07
"""
from alembic import op
import sqlalchemy as sa

revision = "0014_ssh_registry"
down_revision = "0013_service_slug"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ssh_keys",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("private_key", sa.Text(), nullable=False, server_default=""),
        sa.Column("public_key", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "docker_registries",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("url", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("username", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("password", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("docker_registries")
    op.drop_table("ssh_keys")
