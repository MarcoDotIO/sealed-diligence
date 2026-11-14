"""Postgres access."""

from __future__ import annotations

import psycopg

from .config import settings
from .reconcile import Invoice, Match


def _connect() -> psycopg.Connection:
    return psycopg.connect(settings.database_url)


def open_invoices() -> list[Invoice]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, customer, amount_cents, reference, due FROM invoices WHERE status = %s ORDER BY due",
            ("open",),
        ).fetchall()
    return [Invoice(*row) for row in rows]


def record_match(match: Match) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE invoices SET status = %s, payment_id = %s, difference_cents = %s WHERE id = %s",
            ("paid", match.payment_id, match.difference_cents, match.invoice_id),
        )
