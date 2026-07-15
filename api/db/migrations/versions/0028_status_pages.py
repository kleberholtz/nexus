"""status_pages: páginas públicas de status

Revision ID: 0028_status_pages
Revises: 0027_incident_timeline
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0028_status_pages"
down_revision = "0027_incident_timeline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "status_pages",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("logo_url", sa.Text(), nullable=False, server_default=""),
        sa.Column("banner", sa.Text(), nullable=False, server_default=""),
        sa.Column("accent_color", sa.String(length=20), nullable=False, server_default=""),
        sa.Column("custom_css", sa.Text(), nullable=False, server_default=""),
        sa.Column("custom_js", sa.Text(), nullable=False, server_default=""),
        sa.Column("monitor_ids", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("show_incidents", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("show_maintenance", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("published", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("domain", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("cert_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("server_file", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_status_pages_slug", "status_pages", ["slug"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_status_pages_slug", table_name="status_pages")
    op.drop_table("status_pages")
