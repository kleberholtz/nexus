"""monitors: timeout_seconds passa a Float (suporta 0.8 = 80% de 1s)

Revision ID: 0022_monitor_timeout_float
Revises: 0021_monitor_stats
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0022_monitor_timeout_float"
down_revision = "0021_monitor_stats"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("monitors") as batch:
        batch.alter_column("timeout_seconds",
                           type_=sa.Float(),
                           existing_type=sa.Integer(),
                           existing_nullable=False,
                           server_default="48")


def downgrade() -> None:
    with op.batch_alter_table("monitors") as batch:
        batch.alter_column("timeout_seconds",
                           type_=sa.Integer(),
                           existing_type=sa.Float(),
                           existing_nullable=False,
                           server_default="48")
