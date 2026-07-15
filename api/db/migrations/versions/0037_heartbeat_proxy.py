"""monitor_heartbeats.proxy: proxy usado na checagem

Revision ID: 0037_heartbeat_proxy
Revises: 0036_heartbeat_timings
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0037_heartbeat_proxy"
down_revision = "0036_heartbeat_timings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    cols = [c["name"] for c in insp.get_columns("monitor_heartbeats")]
    if "proxy" in cols:
        return
    op.add_column("monitor_heartbeats",
                  sa.Column("proxy", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("monitor_heartbeats", "proxy")
