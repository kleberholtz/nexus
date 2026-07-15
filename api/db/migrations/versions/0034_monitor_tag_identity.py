"""monitor_tags: unicidade pelo conjunto nome e valor

Revision ID: 0034_monitor_tag_identity
Revises: 0033_monitor_tags
Create Date: 2026-07-13
"""
from alembic import op

revision = "0034_monitor_tag_identity"
down_revision = "0033_monitor_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_monitor_tags_name", table_name="monitor_tags")
    op.create_index(
        "ix_monitor_tags_name_value",
        "monitor_tags",
        ["name", "value"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_monitor_tags_name_value", table_name="monitor_tags")
    op.create_index("ix_monitor_tags_name", "monitor_tags", ["name"], unique=True)
