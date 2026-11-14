from ledgerline import webhooks


def test_valid_signature_is_accepted() -> None:
    body = b'{"id": "p1"}'
    webhooks.verify(body, webhooks.expected_signature(body))
