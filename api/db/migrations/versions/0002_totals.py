"""totais acumulados: requests_total, uplink_total, downlink_total

Revision ID: 0002_totals
Revises: 0001_initial
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_totals"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("metrics") as batch:
        batch.add_column(sa.Column("requests_total", sa.BigInteger(), nullable=True))
        batch.add_column(sa.Column("uplink_total", sa.BigInteger(), nullable=True))
        batch.add_column(sa.Column("downlink_total", sa.BigInteger(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("metrics") as batch:
        batch.drop_column("downlink_total")
        batch.drop_column("uplink_total")
        batch.drop_column("requests_total")
