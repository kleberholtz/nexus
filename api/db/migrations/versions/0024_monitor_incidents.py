"""monitor_incidents: incidentes manuais de um monitor

Revision ID: 0024_monitor_incidents
Revises: 0023_notification_channels
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0024_monitor_incidents"
down_revision = "0023_notification_channels"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "monitor_incidents",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("monitor_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="investigating"),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("resolved_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_monitor_incidents_monitor_id", "monitor_incidents", ["monitor_id"])


def downgrade() -> None:
    op.drop_index("ix_monitor_incidents_monitor_id", table_name="monitor_incidents")
    op.drop_table("monitor_incidents")
