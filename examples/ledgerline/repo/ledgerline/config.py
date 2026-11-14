"""Runtime settings, read once from the environment."""

import os
from dataclasses import dataclass


def _flag(name: str, default: str) -> bool:
    return os.getenv(name, default).lower() in {"1", "true", "yes"}


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "postgresql://localhost/ledgerline")
    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    webhook_secret: str = os.getenv("WEBHOOK_SECRET", "dev-secret")
    debug: bool = _flag("LEDGERLINE_DEBUG", "true")
    analytics_url: str = os.getenv("ANALYTICS_URL", "http://collect.metricsbeam.example/v1/events")
    match_tolerance_cents: int = int(os.getenv("MATCH_TOLERANCE_CENTS", "50"))


settings = Settings()
