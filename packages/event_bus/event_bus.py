"""
EventBus — in-process event bus (production should use Redis/Kafka).

This in-process bus is suitable for single-process development and testing.
Replace with RedisEventBus in production for multi-process deployments.
"""
from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import Any, Callable, Dict, List, Optional

from packages.shared.events import BaseEvent

logger = logging.getLogger(__name__)


class EventBus:
    """
    In-process publish/subscribe event bus.

    Supports:
      - Async subscriber callbacks
      - Wildcard subscriptions ("*" matches all event names)
      - Event replay from in-memory log (for testing / audit)
    """

    def __init__(self, max_replay_buffer: int = 10_000) -> None:
        self._subscribers: Dict[str, List[Callable]] = defaultdict(list)
        self._replay_log: List[BaseEvent] = []
        self._max_replay = max_replay_buffer

    def subscribe(self, event_name: str, handler: Callable) -> None:
        """Register a handler for a specific event type."""
        self._subscribers[event_name].append(handler)

    def subscribe_all(self, handler: Callable) -> None:
        """Register a handler for ALL event types."""
        self._subscribers["*"].append(handler)

    async def publish(self, event: BaseEvent) -> None:
        """Publish an event to all matching subscribers."""
        # Replay log
        if len(self._replay_log) < self._max_replay:
            self._replay_log.append(event)

        handlers = (
            self._subscribers.get(event.event_name, [])
            + self._subscribers.get("*", [])
        )

        for handler in handlers:
            try:
                if asyncio.iscoroutinefunction(handler):
                    await handler(event)
                else:
                    handler(event)
            except Exception:
                logger.exception(
                    "Event handler failed",
                    extra={"event_name": event.event_name, "event_id": event.event_id},
                )

    async def replay(
        self,
        event_name: Optional[str] = None,
        handler: Optional[Callable] = None,
    ) -> List[BaseEvent]:
        """
        Replay stored events — for audit and recovery.

        Returns matching events.  If handler is provided, calls it for each.
        """
        matching = [
            e for e in self._replay_log
            if event_name is None or e.event_name == event_name
        ]
        if handler:
            for event in matching:
                if asyncio.iscoroutinefunction(handler):
                    await handler(event)
                else:
                    handler(event)
        return matching

    @property
    def replay_log_size(self) -> int:
        return len(self._replay_log)
