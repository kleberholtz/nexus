"""monitors: catálogo de tags e vínculo com monitores

Revision ID: 0033_monitor_tags
Revises: 0032_monitor_domain_status
Create Date: 2026-07-13
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "0033_monitor_tags"
down_revision = "0032_monitor_domain_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "monitor_tags",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("value", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("color", sa.String(length=7), nullable=False, server_default="#64748b"),
        sa.Column("created_ts", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_ts", sa.BigInteger(), nullable=False, server_default="0"),
    )
    op.create_index("ix_monitor_tags_name", "monitor_tags", ["name"], unique=True)
    op.create_table(
        "monitor_tag_links",
        sa.Column("monitor_id", sa.Integer(), nullable=False),
        sa.Column("tag_id", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("monitor_id", "tag_id"),
    )
    op.create_index("ix_monitor_tag_links_tag_id", "monitor_tag_links", ["tag_id"])

    # As tags livres antigas não fazem parte do novo catálogo.
    conn = op.get_bind()
    for row in conn.execute(sa.text("SELECT id, config FROM monitors")).fetchall():
        try:
            config = json.loads(row.config)
        except (TypeError, ValueError):
            continue
        if "tags" not in config:
            continue
        config.pop("tags", None)
        conn.execute(
            sa.text("UPDATE monitors SET config = :config WHERE id = :id"),
            {"config": json.dumps(config, ensure_ascii=False), "id": row.id},
        )


def downgrade() -> None:
    op.drop_index("ix_monitor_tag_links_tag_id", table_name="monitor_tag_links")
    op.drop_table("monitor_tag_links")
    op.drop_index("ix_monitor_tags_name", table_name="monitor_tags")
    op.drop_table("monitor_tags")
