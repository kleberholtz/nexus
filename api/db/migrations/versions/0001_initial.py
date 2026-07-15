"""inicial: metrics, audit_log, app_settings

Revision ID: 0001_initial
Revises:
Create Date: 2026-07-04
"""
from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "metrics",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("ts", sa.BigInteger(), nullable=False),
        sa.Column("cpu_percent", sa.Float(), nullable=True),
        sa.Column("mem_percent", sa.Float(), nullable=True),
        sa.Column("mem_used", sa.BigInteger(), nullable=True),
        sa.Column("mem_total", sa.BigInteger(), nullable=True),
        sa.Column("disk_percent", sa.Float(), nullable=True),
        sa.Column("disk_used", sa.BigInteger(), nullable=True),
        sa.Column("disk_total", sa.BigInteger(), nullable=True),
        sa.Column("req_per_s", sa.Float(), nullable=True),
        sa.Column("connections", sa.Integer(), nullable=True),
        sa.Column("uplink_bps", sa.Float(), nullable=True),
        sa.Column("downlink_bps", sa.Float(), nullable=True),
        sa.Column("nginx_running", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_metrics_ts", "metrics", ["ts"])

    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("ts", sa.BigInteger(), nullable=False),
        sa.Column("user", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("action", sa.String(length=160), nullable=False),
        sa.Column("method", sa.String(length=10), nullable=False, server_default=""),
        sa.Column("path", sa.String(length=400), nullable=False, server_default=""),
        sa.Column("status", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_log_ts", "audit_log", ["ts"])
    op.create_index("ix_audit_log_user", "audit_log", ["user"])

    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("value", sa.String(length=400), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    op.drop_table("app_settings")
    op.drop_index("ix_audit_log_user", table_name="audit_log")
    op.drop_index("ix_audit_log_ts", table_name="audit_log")
    op.drop_table("audit_log")
    op.drop_index("ix_metrics_ts", table_name="metrics")
    op.drop_table("metrics")
