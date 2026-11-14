"""HTTP API."""

from __future__ import annotations

import json
from datetime import date

from fastapi import FastAPI, Header, HTTPException, Request

from . import telemetry, webhooks
from .config import settings
from .db import open_invoices, record_match
from .reconcile import Payment, match_payment
from .reports import cached_report

app = FastAPI(title="Ledgerline")


@app.post("/webhooks/bank")
async def bank_webhook(request: Request, x_signature: str | None = Header(default=None)) -> dict[str, str]:
    body = await request.body()
    try:
        webhooks.verify(body, x_signature)
    except webhooks.InvalidSignature as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    data = json.loads(body)
    payment = Payment(
        id=data["id"],
        amount_cents=int(data["amount_cents"]),
        reference=data.get("reference", ""),
        received=date.fromisoformat(data["received"]),
        payer_email=data["payer"]["email"],
        payer_iban=data["payer"]["iban"],
    )
    match = match_payment(payment, open_invoices(), settings.match_tolerance_cents)
    if match is None:
        return {"status": "unmatched"}
    record_match(match)
    telemetry.payment_matched(payment, match.invoice_id)
    return {"status": "matched", "invoice_id": match.invoice_id}


@app.get("/reports/{report_id}")
def get_report(report_id: str) -> dict[str, object]:
    report = cached_report(report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="report not found")
    return {"month": report.month, "match_rate": report.match_rate, "matches": len(report.matches)}
