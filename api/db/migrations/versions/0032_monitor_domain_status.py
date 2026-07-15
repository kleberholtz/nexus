"""monitors: persiste o resultado da verificação diária de domínio

Revision ID: 0032_monitor_domain_status
Revises: 0031_monitor_ssl_status
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0032_monitor_domain_status"
down_revision = "0031_monitor_ssl_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("monitors") as batch:
        batch.add_column(sa.Column("domain_status", sa.String(length=20),
                                   nullable=False, server_default=""))
        batch.add_column(sa.Column("domain_checked_ts", sa.BigInteger(),
                                   nullable=False, server_default="0"))
        batch.add_column(sa.Column("domain_registered_ts", sa.BigInteger(),
                                   nullable=False, server_default="0"))
        batch.add_column(sa.Column("domain_expires_ts", sa.BigInteger(),
                                   nullable=False, server_default="0"))
        batch.add_column(sa.Column("domain_message", sa.Text(),
                                   nullable=False, server_default=""))


def downgrade() -> None:
    with op.batch_alter_table("monitors") as batch:
        batch.drop_column("domain_message")
        batch.drop_column("domain_expires_ts")
        batch.drop_column("domain_registered_ts")
        batch.drop_column("domain_checked_ts")
        batch.drop_column("domain_status")
