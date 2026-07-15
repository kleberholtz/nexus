"""monitor_proxies: proxies de saída vinculados aos monitores

Revision ID: 0025_monitor_proxies
Revises: 0024_monitor_incidents
"""
from alembic import op
import sqlalchemy as sa

revision = "0025_monitor_proxies"
down_revision = "0024_monitor_incidents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "monitor_proxies",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("protocol", sa.String(length=20), nullable=False),
        sa.Column("server", sa.String(length=255), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("password", sa.Text(), nullable=False, server_default=""),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("monitor_proxies")
