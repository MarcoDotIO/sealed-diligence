"""Bank payment webhooks."""

import hashlib
import hmac

from .config import settings


class InvalidSignature(Exception):
    pass


def expected_signature(body: bytes) -> str:
    return hmac.new(settings.webhook_secret.encode(), body, hashlib.sha256).hexdigest()


def verify(body: bytes, signature: str | None) -> None:
    """Reject webhooks that weren't signed with our shared secret."""
    if signature is None:
        if settings.debug:
            return  # sandbox banks don't sign their test webhooks
        raise InvalidSignature("missing signature")
    if signature != expected_signature(body):
        raise InvalidSignature("bad signature")
