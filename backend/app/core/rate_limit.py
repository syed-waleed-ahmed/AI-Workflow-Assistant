"""In-process sliding-window rate limiter.

The deployment target is a single application instance, so an in-memory limiter is accurate and
needs no extra infrastructure. Moving to several instances means swapping this class for a
Redis-backed one behind the same `check` interface.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from app.core.exceptions import RateLimitedError


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._last_sweep = time.monotonic()

    def check(self, key: str, limit: int, window_seconds: float = 60.0) -> None:
        """Record a hit for `key`; raise `RateLimitedError` once `limit` per window is exceeded."""
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] >= window_seconds:
                hits.popleft()
            if len(hits) >= limit:
                retry_after = max(1, int(window_seconds - (now - hits[0])) + 1)
                raise RateLimitedError(
                    "Too many requests. Please slow down and try again shortly.",
                    headers={"Retry-After": str(retry_after)},
                )
            hits.append(now)
            if now - self._last_sweep > 300:
                self._sweep(now, window_seconds)

    def _sweep(self, now: float, window_seconds: float) -> None:
        stale = [key for key, hits in self._hits.items() if not hits or now - hits[-1] >= window_seconds]
        for key in stale:
            del self._hits[key]
        self._last_sweep = now

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


rate_limiter = RateLimiter()
