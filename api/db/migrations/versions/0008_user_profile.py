"""users: colunas name/email (perfil obrigatório)

Revision ID: 0008_user_profile
Revises: 0007_roles
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0008_user_profile"
down_revision = "0007_roles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("name", sa.String(length=120), nullable=False, server_default=""))
    op.add_column("users", sa.Column("email", sa.String(length=254), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("users", "email")
    op.drop_column("users", "name")
