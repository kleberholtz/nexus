"""maintenances: janelas de manutenção agendada

Revision ID: 0035_maintenances
Revises: 0034_monitor_tag_identity
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0035_maintenances"
down_revision = "0034_monitor_tag_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotente: em DBs de dev a tabela pode já ter sido criada pelo fallback
    # `Base.metadata.create_all` (quando um upgrade anterior abortou). Pular a
    # criação evita quebrar a cadeia (o que impediria 0036 de rodar).
    insp = sa.inspect(op.get_bind())
    if "maintenances" in insp.get_table_names():
        return
    op.create_table(
        "maintenances",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("monitor_ids", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("strategy", sa.String(length=30), nullable=False, server_default="single"),
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default="UTC"),
        sa.Column("config", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("maintenances")
