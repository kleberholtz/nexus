"""monitor_heartbeats.timings: detalhamento do tempo de resposta

Revision ID: 0036_heartbeat_timings
Revises: 0035_maintenances
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0036_heartbeat_timings"
down_revision = "0035_maintenances"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotente: só adiciona se ainda não existir (o DB pode ter sido criado
    # via metadata.create_all, que já traz a coluna).
    insp = sa.inspect(op.get_bind())
    cols = [c["name"] for c in insp.get_columns("monitor_heartbeats")]
    if "timings" in cols:
        return
    op.add_column("monitor_heartbeats",
                  sa.Column("timings", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("monitor_heartbeats", "timings")
