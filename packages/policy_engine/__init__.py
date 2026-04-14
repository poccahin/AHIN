"""
PolicyEngine — enforces behavioral constraints on cognitive task execution.

The PolicyEngine is the Life++ analog of an OS security policy:
  - Who can execute what (capability + trust threshold)
  - Anti-spam: rate limiting per node
  - Anti-zombie: reject tasks from agents with zombie output history
  - Kill-switch hooks for compromised agents
  - Admission gate: AHIN stake check

Sub-components:
  - PolicyEngine: task-level policy enforcement
  - AntiSpamPolicy: value-flow-level behavioral constraints
"""
from __future__ import annotations

import logging
import time
from collections import defaultdict
from typing import Any, Dict, Optional

from packages.policy_engine.anti_spam_policy import AntiSpamPolicy

logger = logging.getLogger(__name__)

_DEFAULT_RATE_LIMIT = 100  # tasks per minute per node
_ZOMBIE_BLOCK_THRESHOLD = 3  # zombie strikes before blocking


class PolicyEngine:
    """
    Evaluates policy constraints before a CognitiveTask is dispatched.

    All policy decisions are logged for audit.

    TODO: move policy rules to a persistent store (DB / config) for hot reload.
    """

    def __init__(
        self,
        rate_limit_per_minute: int = _DEFAULT_RATE_LIMIT,
    ) -> None:
        self._rate_limit = rate_limit_per_minute
        # {node_id: [timestamp, ...]}
        self._task_timestamps: Dict[str, list] = defaultdict(list)
        # {node_id: zombie_strike_count}
        self._zombie_strikes: Dict[str, int] = defaultdict(int)
        # Explicitly blocked nodes
        self._blocked_nodes: set = set()

    async def evaluate(
        self,
        task_id: str,
        agent: Any,
        payload: Dict[str, Any],
        constraints: Dict[str, Any],
    ) -> bool:
        """
        Evaluate whether a task should be allowed to execute.

        Returns True (allowed) or False (denied).
        """
        node_id = agent.node_id

        # Hard block
        if node_id in self._blocked_nodes:
            logger.warning(
                "Policy: node is blocked",
                extra={"node_id": node_id, "task_id": task_id},
            )
            return False

        # Zombie strike check
        if self._zombie_strikes[node_id] >= _ZOMBIE_BLOCK_THRESHOLD:
            logger.warning(
                "Policy: node blocked due to repeated zombie output",
                extra={"node_id": node_id, "strikes": self._zombie_strikes[node_id]},
            )
            self._blocked_nodes.add(node_id)
            return False

        # Rate limit check
        now = time.monotonic()
        window = [t for t in self._task_timestamps[node_id] if now - t < 60.0]
        self._task_timestamps[node_id] = window
        if len(window) >= self._rate_limit:
            logger.warning(
                "Policy: rate limit exceeded",
                extra={"node_id": node_id, "count": len(window)},
            )
            return False

        self._task_timestamps[node_id].append(now)

        # Custom constraints (extensible)
        required_capability = constraints.get("required_capability")
        if required_capability and required_capability not in agent.get_capabilities():
            logger.warning(
                "Policy: agent lacks required capability",
                extra={"node_id": node_id, "required": required_capability},
            )
            return False

        return True

    def record_zombie_strike(self, node_id: str) -> None:
        """Record a zombie output strike against a node."""
        self._zombie_strikes[node_id] += 1
        logger.warning(
            "Zombie output strike recorded",
            extra={
                "node_id": node_id,
                "total_strikes": self._zombie_strikes[node_id],
            },
        )

    def block_node(self, node_id: str, reason: str) -> None:
        """Manually block a node from executing tasks."""
        self._blocked_nodes.add(node_id)
        logger.warning(
            "Node manually blocked by policy",
            extra={"node_id": node_id, "reason": reason},
        )

    def unblock_node(self, node_id: str) -> None:
        """Unblock a previously blocked node."""
        self._blocked_nodes.discard(node_id)
        self._zombie_strikes[node_id] = 0
        logger.info("Node unblocked", extra={"node_id": node_id})
