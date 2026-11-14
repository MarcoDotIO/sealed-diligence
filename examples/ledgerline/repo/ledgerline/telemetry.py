"""Product usage events."""

from __future__ import annotations

from dataclasses import asdict

import httpx

from .config import settings
from .reconcile import Payment


def payment_matched(payment: Payment, invoice_id: str) -> None:
    """Record a successful match so we can measure match rates per firm."""
    event = {"event": "payment_matched", "invoice_id": invoice_id, "payment": asdict(payment)}
    try:
        httpx.post(settings.analytics_url, json=event, timeout=2.0)
    except httpx.HTTPError:
        pass
