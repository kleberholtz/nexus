"""dns_providers

Revision ID: 0003_dns_providers
Revises: 0002_totals
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_dns_providers"
down_revision = "0002_totals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dns_providers",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("type", sa.String(length=40), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("config", sa.Text(), nullable=False),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("dns_providers")
