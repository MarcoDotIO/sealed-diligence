from datetime import date

from ledgerline.reconcile import Invoice, Payment, match_payment, reconcile


def invoice(id: str, cents: int, ref: str, due_day: int) -> Invoice:
    return Invoice(id, "Northwind", cents, ref, date(2026, 3, due_day))


def payment(id: str, cents: int, ref: str = "", day: int = 1) -> Payment:
    return Payment(id, cents, ref, date(2026, 3, day), "ap@northwind.example", "GB33BUKB20201555555555")


def test_reference_match_wins_over_amount() -> None:
    invoices = [invoice("A", 10_000, "INV-1", 5), invoice("B", 12_500, "INV-2", 9)]
    match = match_payment(payment("p1", 10_000, "inv 2"), invoices, 50)
    assert match is not None and match.invoice_id == "B" and match.exact_reference


def test_amount_within_tolerance_prefers_earliest_due() -> None:
    invoices = [invoice("A", 10_020, "X", 20), invoice("B", 9_980, "Y", 3)]
    match = match_payment(payment("p1", 10_000), invoices, 50)
    assert match is not None and match.invoice_id == "B"


def test_no_match_outside_tolerance() -> None:
    assert match_payment(payment("p1", 10_000), [invoice("A", 11_000, "X", 1)], 50) is None


def test_an_invoice_is_matched_once() -> None:
    invoices = [invoice("A", 10_000, "X", 1)]
    matches = reconcile([payment("p1", 10_000, day=1), payment("p2", 10_000, day=2)], invoices, 50)
    assert [m.payment_id for m in matches] == ["p1"]
