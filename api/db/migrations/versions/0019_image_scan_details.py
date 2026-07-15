"""image_scans: guarda os detalhes das vulnerabilidades (CVEs)

Revision ID: 0019_image_scan_details
Revises: 0018_image_scans
Create Date: 2026-07-10
"""
from alembic import op
import sqlalchemy as sa

revision = "0019_image_scan_details"
down_revision = "0018_image_scans"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("image_scans", sa.Column(
        "details", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("image_scans", "details")
