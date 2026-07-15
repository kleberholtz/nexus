"""monitor_stats + monitor_events: agregação horária p/ uptime + log de eventos

Os heartbeats crus são podados (500/monitor), então uptime de 24h/30d/1a vem de
buckets **horários** (`monitor_stats`). Eventos (healthy/unhealthy/activated/
deactivated/maintenance) ficam em `monitor_events`.

Revision ID: 0021_monitor_stats
Revises: 0020_monitors
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0021_monitor_stats"
down_revision = "0020_monitors"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "monitor_stats",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("monitor_id", sa.Integer(), nullable=False),
        sa.Column("bucket_ts", sa.BigInteger(), nullable=False),   # início da hora (ms)
        sa.Column("up", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("down", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ping_sum", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("ping_count", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_monitor_stats_monitor_id", "monitor_stats", ["monitor_id"])
    op.create_index("ix_monitor_stats_mon_bucket", "monitor_stats",
                    ["monitor_id", "bucket_ts"], unique=True)
    op.create_table(
        "monitor_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("monitor_id", sa.Integer(), nullable=False),
        sa.Column("ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("type", sa.String(length=20), nullable=False),  # healthy|unhealthy|activated|deactivated|maintenance
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_monitor_events_monitor_id", "monitor_events", ["monitor_id"])
    op.create_index("ix_monitor_events_ts", "monitor_events", ["ts"])


def downgrade() -> None:
    op.drop_index("ix_monitor_events_ts", table_name="monitor_events")
    op.drop_index("ix_monitor_events_monitor_id", table_name="monitor_events")
    op.drop_table("monitor_events")
    op.drop_index("ix_monitor_stats_mon_bucket", table_name="monitor_stats")
    op.drop_index("ix_monitor_stats_monitor_id", table_name="monitor_stats")
    op.drop_table("monitor_stats")
