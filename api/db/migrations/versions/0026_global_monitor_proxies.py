"""torna monitor_proxies um catálogo global

Remove o vínculo legado monitor_id da primeira versão da 0025. A inspeção
torna a migração segura também para bancos novos, onde a 0025 já cria a tabela
no formato global.

Revision ID: 0026_global_monitor_proxies
Revises: 0025_monitor_proxies
"""
from alembic import op
import sqlalchemy as sa

revision = "0026_global_monitor_proxies"
down_revision = "0025_monitor_proxies"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("monitor_proxies")}
    if "monitor_id" not in columns:
        return

    indexes = {index["name"] for index in inspector.get_indexes("monitor_proxies")}
    if "ix_monitor_proxies_monitor_id" in indexes:
        op.drop_index("ix_monitor_proxies_monitor_id", table_name="monitor_proxies")
    with op.batch_alter_table("monitor_proxies") as batch_op:
        batch_op.drop_column("monitor_id")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("monitor_proxies")}
    if "monitor_id" in columns:
        return
    # Zero representa proxies globais; versões antigas da aplicação não devem
    # interpretar esses registros como vinculados a um monitor real.
    with op.batch_alter_table("monitor_proxies") as batch_op:
        batch_op.add_column(sa.Column("monitor_id", sa.Integer(), nullable=False, server_default="0"))
    op.create_index("ix_monitor_proxies_monitor_id", "monitor_proxies", ["monitor_id"])
