"""disponibilidade parcial (modo proxy all): heartbeat.up_ratio + stats float

Revision ID: 0038_partial_proxy_availability
Revises: 0037_heartbeat_proxy
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0038_partial_proxy_availability"
down_revision = "0037_heartbeat_proxy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())

    cols = [c["name"] for c in insp.get_columns("monitor_heartbeats")]
    if "up_ratio" not in cols:
        op.add_column("monitor_heartbeats",
                      sa.Column("up_ratio", sa.Float(), nullable=False, server_default="1"))

    # up/down passam a Float p/ acumular disponibilidade fracionária.
    with op.batch_alter_table("monitor_stats") as batch:
        batch.alter_column("up", type_=sa.Float(), existing_type=sa.Integer(),
                           existing_nullable=False, existing_server_default="0")
        batch.alter_column("down", type_=sa.Float(), existing_type=sa.Integer(),
                           existing_nullable=False, existing_server_default="0")


def downgrade() -> None:
    with op.batch_alter_table("monitor_stats") as batch:
        batch.alter_column("up", type_=sa.Integer(), existing_type=sa.Float(),
                           existing_nullable=False, existing_server_default="0")
        batch.alter_column("down", type_=sa.Integer(), existing_type=sa.Float(),
                           existing_nullable=False, existing_server_default="0")
    op.drop_column("monitor_heartbeats", "up_ratio")
