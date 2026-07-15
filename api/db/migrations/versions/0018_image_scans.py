"""image_scans: fila + histórico de scans de vulnerabilidade

Revision ID: 0018_image_scans
Revises: 0017_github_private_key
Create Date: 2026-07-10
"""
from alembic import op
import sqlalchemy as sa

revision = "0018_image_scans"
down_revision = "0017_github_private_key"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "image_scans",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("image_id", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("image_ref", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="queued"),
        sa.Column("phase", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("severities", sa.Text(), nullable=False, server_default=""),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("user", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("started_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("finished_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_image_scans_image_id", "image_scans", ["image_id"])
    op.create_index("ix_image_scans_status", "image_scans", ["status"])
    op.create_index("ix_image_scans_created_ts", "image_scans", ["created_ts"])


def downgrade() -> None:
    op.drop_index("ix_image_scans_created_ts", table_name="image_scans")
    op.drop_index("ix_image_scans_status", table_name="image_scans")
    op.drop_index("ix_image_scans_image_id", table_name="image_scans")
    op.drop_table("image_scans")
