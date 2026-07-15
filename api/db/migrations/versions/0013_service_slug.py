"""project_services: coluna slug (nome estável p/ container/volume)

Revision ID: 0013_service_slug
Revises: 0012_projects
Create Date: 2026-07-07
"""
import re
import unicodedata

from alembic import op
import sqlalchemy as sa

revision = "0013_service_slug"
down_revision = "0012_projects"
branch_labels = None
depends_on = None


def _slugify(name: str) -> str:
    text = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return text[:63] or "svc"


def upgrade() -> None:
    op.add_column("project_services",
                  sa.Column("slug", sa.String(length=80), nullable=False, server_default=""))
    op.create_index("ix_project_services_slug", "project_services", ["slug"])
    # Backfill: slug derivado do nome dos serviços já existentes.
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, name FROM project_services")).fetchall()
    for row in rows:
        conn.execute(sa.text("UPDATE project_services SET slug = :slug WHERE id = :id"),
                     {"slug": _slugify(row[1]), "id": row[0]})


def downgrade() -> None:
    op.drop_index("ix_project_services_slug", table_name="project_services")
    op.drop_column("project_services", "slug")
