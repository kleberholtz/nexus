"""cert_meta: coluna ca_name (certificados assinados por CA própria)

Revision ID: 0009_cert_ca
Revises: 0008_user_profile
Create Date: 2026-07-06
"""
from alembic import op
import sqlalchemy as sa

revision = "0009_cert_ca"
down_revision = "0008_user_profile"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cert_meta", sa.Column("ca_name", sa.String(length=180), nullable=True))


def downgrade() -> None:
    op.drop_column("cert_meta", "ca_name")
