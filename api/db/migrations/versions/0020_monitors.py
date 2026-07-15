"""monitors: tabelas monitor_groups + monitors + monitor_heartbeats

Monitores (healthcheck) agrupados por grupo. `config` guarda os campos por
`type` (JSON); heartbeats são o histórico de checagens do motor de execução.

Revision ID: 0020_monitors
Revises: 0019_image_scan_details
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0020_monitors"
down_revision = "0019_image_scan_details"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "monitor_groups",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("color", sa.String(length=20), nullable=False, server_default=""),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "monitors",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=True),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("config", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("interval_seconds", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("max_retries", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False, server_default="48"),
        sa.Column("resend_every", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="pending"),
        sa.Column("last_check_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_monitors_group_id", "monitors", ["group_id"])
    op.create_table(
        "monitor_heartbeats",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("monitor_id", sa.Integer(), nullable=False),
        sa.Column("ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="down"),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("code", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_monitor_heartbeats_monitor_id", "monitor_heartbeats", ["monitor_id"])
    op.create_index("ix_monitor_heartbeats_ts", "monitor_heartbeats", ["ts"])


def downgrade() -> None:
    op.drop_index("ix_monitor_heartbeats_ts", table_name="monitor_heartbeats")
    op.drop_index("ix_monitor_heartbeats_monitor_id", table_name="monitor_heartbeats")
    op.drop_table("monitor_heartbeats")
    op.drop_index("ix_monitors_group_id", table_name="monitors")
    op.drop_table("monitors")
    op.drop_table("monitor_groups")
