"""cert_meta (auto-renovação de certificados)

Revision ID: 0004_cert_meta
Revises: 0003_dns_providers
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_cert_meta"
down_revision = "0003_dns_providers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cert_meta",
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("domains", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("ips", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("days", sa.Integer(), nullable=False, server_default="825"),
        sa.Column("rsa", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("provider_id", sa.Integer(), nullable=True),
        sa.Column("staging", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("auto_renew", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("name"),
    )


def downgrade() -> None:
    op.drop_table("cert_meta")
