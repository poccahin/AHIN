"""
RedisEventBus — production event bus backed by Redis Streams.

Uses Redis XADD/XREAD for persistent, replay-capable event streaming.
TODO: implement full consumer group support for competing consumers.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Callable, Dict, List, Optional

from packages.shared.events import BaseEvent

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
STREAM_PREFIX = "lifepp:events:"


class RedisEventBus:
    """
    Redis Streams-backed event bus for production deployments.

    Each event type maps to a Redis Stream: lifepp:events:{event_name}
    A global stream lifepp:events:all receives every event.

    TODO: Complete Redis client integration (aioredis / redis-py async)
    """

    def __init__(self, redis_client: Optional[Any] = None) -> None:
        self._redis = redis_client
        if redis_client is None:
            logger.warning(
                "RedisEventBus: no Redis client provided — events will be dropped"
            )

    async def publish(self, event: BaseEvent) -> None:
        """Publish an event to Redis Streams."""
        if self._redis is None:
            logger.debug("RedisEventBus: no client — skipping publish")
            return

        data = event.model_dump_json()
        stream_key = f"{STREAM_PREFIX}{event.event_name}"
        global_key = f"{STREAM_PREFIX}all"

        try:
            await self._redis.xadd(stream_key, {"data": data})
            await self._redis.xadd(global_key, {"data": data})
        except Exception:
            logger.exception(
                "RedisEventBus publish failed",
                extra={"event_name": event.event_name, "event_id": event.event_id},
            )

    async def read_events(
        self,
        event_name: str,
        last_id: str = "0-0",
        count: int = 100,
    ) -> List[Dict[str, Any]]:
        """
        Read events from a Redis Stream (for replay / audit).

        TODO: implement consumer group pattern for production fan-out
        """
        if self._redis is None:
            return []

        stream_key = f"{STREAM_PREFIX}{event_name}"
        results = await self._redis.xread({stream_key: last_id}, count=count)
        events = []
        for _, messages in results:
            for msg_id, fields in messages:
                data = json.loads(fields.get(b"data", b"{}"))
                data["_stream_id"] = msg_id.decode()
                events.append(data)
        return events
