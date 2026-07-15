"""monitor_proxies: (protocolo, servidor, porta) único

Revision ID: 0029_proxy_endpoint_unique
Revises: 0028_status_pages
Create Date: 2026-07-13
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "0029_proxy_endpoint_unique"
down_revision = "0028_status_pages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, protocol, server, port FROM monitor_proxies ORDER BY id")
    ).fetchall()

    keep: dict[tuple, int] = {}
    remap: dict[int, int] = {}   # id duplicado -> id mantido
    for row in rows:
        key = (row.protocol, row.server, row.port)
        if key in keep:
            remap[row.id] = keep[key]
        else:
            keep[key] = row.id

    if remap:
        # remapeia as referências dos monitores para o id mantido
        monitors = conn.execute(sa.text("SELECT id, config FROM monitors")).fetchall()
        for m in monitors:
            try:
                cfg = json.loads(m.config)
            except (TypeError, ValueError):
                continue
            ids = cfg.get("proxy_ids")
            if not ids:
                continue
            new_ids: list[int] = []
            for pid in ids:
                mapped = remap.get(pid, pid)
                if mapped not in new_ids:
                    new_ids.append(mapped)
            if new_ids != ids:
                cfg["proxy_ids"] = new_ids
                conn.execute(
                    sa.text("UPDATE monitors SET config = :c WHERE id = :i"),
                    {"c": json.dumps(cfg, ensure_ascii=False), "i": m.id},
                )
        for dup_id in remap:
            conn.execute(sa.text("DELETE FROM monitor_proxies WHERE id = :i"), {"i": dup_id})

    op.create_index(
        "ix_monitor_proxies_endpoint", "monitor_proxies",
        ["protocol", "server", "port"], unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_monitor_proxies_endpoint", table_name="monitor_proxies")
