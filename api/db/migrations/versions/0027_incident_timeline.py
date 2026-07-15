"""incidentes: severidade + linha do tempo (updates)

Revision ID: 0027_incident_timeline
Revises: 0026_global_monitor_proxies
Create Date: 2026-07-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0027_incident_timeline"
down_revision = "0026_global_monitor_proxies"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "monitor_incidents",
        sa.Column("severity", sa.String(length=20), nullable=False, server_default="degraded"),
    )
    op.create_table(
        "monitor_incident_updates",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("incident_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="investigating"),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_monitor_incident_updates_incident_id", "monitor_incident_updates", ["incident_id"])

    # semeia uma atualização inicial para os incidentes já existentes,
    # para que a linha do tempo não fique vazia.
    inc = sa.table(
        "monitor_incidents",
        sa.column("id", sa.Integer),
        sa.column("status", sa.String),
        sa.column("description", sa.Text),
        sa.column("created_ts", sa.BigInteger),
    )
    upd = sa.table(
        "monitor_incident_updates",
        sa.column("incident_id", sa.Integer),
        sa.column("status", sa.String),
        sa.column("message", sa.Text),
        sa.column("created_ts", sa.BigInteger),
    )
    conn = op.get_bind()
    for row in conn.execute(sa.select(inc.c.id, inc.c.status, inc.c.description, inc.c.created_ts)):
        conn.execute(upd.insert().values(
            incident_id=row.id, status=row.status or "investigating",
            message=row.description or "", created_ts=row.created_ts or 0))


def downgrade() -> None:
    op.drop_index("ix_monitor_incident_updates_incident_id", table_name="monitor_incident_updates")
    op.drop_table("monitor_incident_updates")
    op.drop_column("monitor_incidents", "severity")
