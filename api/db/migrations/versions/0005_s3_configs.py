"""s3_configs (destinos S3 para upload de logs)

Revision ID: 0005_s3_configs
Revises: 0004_cert_meta
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0005_s3_configs"
down_revision = "0004_cert_meta"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "s3_configs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("config", sa.Text(), nullable=False),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("s3_configs")
