"""monitors: persiste o resultado da verificação diária de SSL

Revision ID: 0031_monitor_ssl_status
Revises: 0030_ai_providers
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0031_monitor_ssl_status"
down_revision = "0030_ai_providers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("monitors") as batch:
        batch.add_column(sa.Column("ssl_status", sa.String(length=20),
                                   nullable=False, server_default=""))
        batch.add_column(sa.Column("ssl_checked_ts", sa.BigInteger(),
                                   nullable=False, server_default="0"))
        batch.add_column(sa.Column("ssl_issued_ts", sa.BigInteger(),
                                   nullable=False, server_default="0"))
        batch.add_column(sa.Column("ssl_expires_ts", sa.BigInteger(),
                                   nullable=False, server_default="0"))
        batch.add_column(sa.Column("ssl_message", sa.Text(),
                                   nullable=False, server_default=""))


def downgrade() -> None:
    with op.batch_alter_table("monitors") as batch:
        batch.drop_column("ssl_message")
        batch.drop_column("ssl_expires_ts")
        batch.drop_column("ssl_issued_ts")
        batch.drop_column("ssl_checked_ts")
        batch.drop_column("ssl_status")
