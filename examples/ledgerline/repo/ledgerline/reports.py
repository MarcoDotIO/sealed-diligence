"""Month-end reconciliation reports, cached in Redis."""

from __future__ import annotations

import pickle
from dataclasses import dataclass

import redis

from .config import settings
from .reconcile import Match

_cache = redis.Redis.from_url(settings.redis_url)
CACHE_SECONDS = 6 * 60 * 60


@dataclass
class Report:
    month: str
    matches: list[Match]
    unmatched_payment_ids: list[str]

    @property
    def match_rate(self) -> float:
        total = len(self.matches) + len(self.unmatched_payment_ids)
        return len(self.matches) / total if total else 1.0


def cached_report(report_id: str) -> Report | None:
    raw = _cache.get(f"report:{report_id}")
    return pickle.loads(raw) if raw else None


def store_report(report_id: str, report: Report) -> None:
    _cache.setex(f"report:{report_id}", CACHE_SECONDS, pickle.dumps(report))
