"""
packages/event_bus — Life++ event publishing and subscription.

All system state transitions are represented as events.
The event bus provides:
  - Publish / subscribe interface
  - Replay capability (for audit and recovery)
  - Idempotent delivery
"""
from packages.event_bus.event_bus import EventBus
from packages.event_bus.redis_event_bus import RedisEventBus

__all__ = ["EventBus", "RedisEventBus"]
