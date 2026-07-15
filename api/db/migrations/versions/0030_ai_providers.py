"""ai_providers: provedores de inteligência artificial

Revision ID: 0030_ai_providers
Revises: 0029_proxy_endpoint_unique
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0030_ai_providers"
down_revision = "0029_proxy_endpoint_unique"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_providers",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("api_url", sa.String(length=1000), nullable=False, server_default=""),
        sa.Column("api_key", sa.Text(), nullable=False, server_default=""),
        sa.Column("model", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_providers_type", "ai_providers", ["type"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_ai_providers_type", table_name="ai_providers")
    op.drop_table("ai_providers")
