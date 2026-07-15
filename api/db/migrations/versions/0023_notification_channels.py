"""notification_channels: canais de notificação dos monitores

Revision ID: 0023_notification_channels
Revises: 0022_monitor_timeout_float
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0023_notification_channels"
down_revision = "0022_monitor_timeout_float"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notification_channels",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False),  # webhook|telegram|discord|email|slack|teams
        sa.Column("config", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("notification_channels")
