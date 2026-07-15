"""monitor_heartbeats.meta: metadados da resposta/conexão HTTP

Revision ID: 0039_heartbeat_meta
Revises: 0038_partial_proxy_availability
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0039_heartbeat_meta"
down_revision = "0038_partial_proxy_availability"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    cols = [c["name"] for c in insp.get_columns("monitor_heartbeats")]
    if "meta" in cols:
        return
    op.add_column("monitor_heartbeats",
                  sa.Column("meta", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("monitor_heartbeats", "meta")
