"""roles (papéis editáveis com permissões controladas no painel)

Revision ID: 0007_roles
Revises: 0006_users
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0007_roles"
down_revision = "0006_users"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "roles",
        sa.Column("name", sa.String(length=40), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("permissions", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("builtin", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("name"),
    )
    # Os papéis-semente (admin/operator/viewer) são inseridos em runtime por
    # api/roles.py::ensure_defaults (fonte única em api/rbac.py::DEFAULT_ROLES).


def downgrade() -> None:
    op.drop_table("roles")
