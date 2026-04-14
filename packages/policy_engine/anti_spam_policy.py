"""
AntiSpamPolicy — behavioral constraints for the Cognitive Value Flow System.

Extends the PolicyEngine with value-flow-specific anti-spam and
anti-zombie constraints:

  1. Minimum balance enforcement — agents without sufficient balance
     cannot initiate collaborations or submit tasks.
  2. Interaction rate limiting — prevents flooding the network.
  3. Zombie strike escalation — escalating penalties for repeated
     philosophically-zombie-like outputs.
  4. Admission revocation — permanently block agents that exceed
     the maximum zombie strike count.
  5. Cooldown enforcement — temporary suspension after rapid-fire
     rejections.

These constraints are NOT censorship.
They are the cognitive-economic immune system of AHIN, ensuring that
participation is meaningful and that resources flow to genuine
cognitive contributors, not free-riders or spammers.
"""
from __future__ import annotations

import logging
import time
from collections import defaultdict
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Default thresholds
_MIN_BALANCE_FOR_INTERACTION = 0.0  # Set > 0 to require min balance
_INTERACTION_RATE_LIMIT_PER_MINUTE = 60
_ZOMBIE_WARN_THRESHOLD = 2
_ZOMBIE_BLOCK_THRESHOLD = 3
_ZOMBIE_REVOKE_THRESHOLD = 5
_COOLDOWN_SECONDS = 60.0
_MAX_REJECTIONS_BEFORE_COOLDOWN = 5


class BehavioralVerdict:
    """Outcome of an anti-spam policy evaluation."""

    __slots__ = ("allowed", "reason", "penalty_applied")

    def __init__(
        self, allowed: bool, reason: str, penalty_applied: Optional[str] = None
    ) -> None:
        self.allowed = allowed
        self.reason = reason
        self.penalty_applied = penalty_applied


class AntiSpamPolicy:
    """
    Value-flow-aware behavioral constraint engine.

    Tracks per-node interaction history and enforces escalating
    penalties for abusive or low-quality participation patterns.
    """

    def __init__(
        self,
        rate_limit_per_minute: int = _INTERACTION_RATE_LIMIT_PER_MINUTE,
        zombie_block_threshold: int = _ZOMBIE_BLOCK_THRESHOLD,
        zombie_revoke_threshold: int = _ZOMBIE_REVOKE_THRESHOLD,
        cooldown_seconds: float = _COOLDOWN_SECONDS,
        max_rejections_before_cooldown: int = _MAX_REJECTIONS_BEFORE_COOLDOWN,
    ) -> None:
        self._rate_limit = rate_limit_per_minute
        self._zombie_block_threshold = zombie_block_threshold
        self._zombie_revoke_threshold = zombie_revoke_threshold
        self._cooldown_seconds = cooldown_seconds
        self._max_rejections = max_rejections_before_cooldown

        # Per-node state
        self._interaction_timestamps: Dict[str, List[float]] = defaultdict(list)
        self._zombie_strikes: Dict[str, int] = defaultdict(int)
        self._rejection_counts: Dict[str, int] = defaultdict(int)
        self._cooldown_until: Dict[str, float] = {}
        self._blocked_nodes: set = set()
        self._revoked_nodes: set = set()

    # ------------------------------------------------------------------
    # Evaluation
    # ------------------------------------------------------------------

    def evaluate_interaction(
        self,
        node_id: str,
        balance: float = 0.0,
        min_balance: float = _MIN_BALANCE_FOR_INTERACTION,
    ) -> BehavioralVerdict:
        """
        Evaluate whether a node may initiate a collaboration interaction.

        Checks (in order):
          1. Revoked — permanently blocked
          2. Blocked — temporarily blocked (zombie strikes)
          3. Cooldown — too many recent rejections
          4. Rate limit — too many interactions per minute
          5. Minimum balance — anti-free-rider
        """
        now = time.monotonic()

        # 1. Permanent revocation
        if node_id in self._revoked_nodes:
            return BehavioralVerdict(
                allowed=False,
                reason="Node admission permanently revoked due to repeated violations",
                penalty_applied="revocation",
            )

        # 2. Blocked
        if node_id in self._blocked_nodes:
            return BehavioralVerdict(
                allowed=False,
                reason="Node blocked due to zombie output history",
                penalty_applied="block",
            )

        # 3. Cooldown
        if node_id in self._cooldown_until:
            if now < self._cooldown_until[node_id]:
                remaining = self._cooldown_until[node_id] - now
                return BehavioralVerdict(
                    allowed=False,
                    reason=f"Node in cooldown for {remaining:.0f}s after repeated rejections",
                    penalty_applied="cooldown",
                )
            else:
                # Cooldown expired — reset
                del self._cooldown_until[node_id]
                self._rejection_counts[node_id] = 0

        # 4. Rate limit
        window = [
            t for t in self._interaction_timestamps[node_id] if now - t < 60.0
        ]
        self._interaction_timestamps[node_id] = window
        if len(window) >= self._rate_limit:
            self._record_rejection(node_id, now)
            return BehavioralVerdict(
                allowed=False,
                reason=f"Rate limit exceeded: {len(window)} interactions in last 60s",
                penalty_applied="rate_limit",
            )

        # 5. Minimum balance
        if balance < min_balance:
            self._record_rejection(node_id, now)
            return BehavioralVerdict(
                allowed=False,
                reason=f"Insufficient balance: {balance:.8f} < {min_balance:.8f}",
                penalty_applied="min_balance",
            )

        # Allowed — record the interaction
        self._interaction_timestamps[node_id].append(now)
        return BehavioralVerdict(allowed=True, reason="Interaction permitted")

    # ------------------------------------------------------------------
    # Zombie strike management
    # ------------------------------------------------------------------

    def record_zombie_strike(self, node_id: str) -> BehavioralVerdict:
        """
        Record a zombie output strike and apply escalating penalties.

        Escalation:
          - < block_threshold: warning only
          - >= block_threshold: node blocked from interactions
          - >= revoke_threshold: node admission permanently revoked
        """
        self._zombie_strikes[node_id] += 1
        strikes = self._zombie_strikes[node_id]

        logger.warning(
            "Zombie strike recorded",
            extra={"node_id": node_id, "total_strikes": strikes},
        )

        if strikes >= self._zombie_revoke_threshold:
            self._revoked_nodes.add(node_id)
            self._blocked_nodes.discard(node_id)
            logger.warning(
                "Node admission REVOKED due to excessive zombie output",
                extra={"node_id": node_id, "strikes": strikes},
            )
            return BehavioralVerdict(
                allowed=False,
                reason=f"Admission revoked after {strikes} zombie strikes",
                penalty_applied="revocation",
            )

        if strikes >= self._zombie_block_threshold:
            self._blocked_nodes.add(node_id)
            logger.warning(
                "Node BLOCKED due to zombie output pattern",
                extra={"node_id": node_id, "strikes": strikes},
            )
            return BehavioralVerdict(
                allowed=False,
                reason=f"Blocked after {strikes} zombie strikes",
                penalty_applied="block",
            )

        return BehavioralVerdict(
            allowed=True,
            reason=f"Warning: {strikes} zombie strike(s) recorded",
            penalty_applied="warning",
        )

    def get_zombie_strikes(self, node_id: str) -> int:
        """Return the number of zombie strikes for a node."""
        return self._zombie_strikes.get(node_id, 0)

    # ------------------------------------------------------------------
    # Admin controls
    # ------------------------------------------------------------------

    def unblock_node(self, node_id: str) -> None:
        """Unblock a node (admin action). Does NOT clear revocation."""
        self._blocked_nodes.discard(node_id)
        self._zombie_strikes[node_id] = 0
        self._rejection_counts[node_id] = 0
        if node_id in self._cooldown_until:
            del self._cooldown_until[node_id]
        logger.info("Node unblocked by admin", extra={"node_id": node_id})

    def reinstate_node(self, node_id: str) -> None:
        """Reinstate a revoked node (admin action). Clears ALL penalties."""
        self._revoked_nodes.discard(node_id)
        self.unblock_node(node_id)
        logger.info("Node reinstated by admin", extra={"node_id": node_id})

    def is_blocked(self, node_id: str) -> bool:
        """Check if a node is blocked."""
        return node_id in self._blocked_nodes

    def is_revoked(self, node_id: str) -> bool:
        """Check if a node is permanently revoked."""
        return node_id in self._revoked_nodes

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _record_rejection(self, node_id: str, now: float) -> None:
        """Track rejections and apply cooldown if threshold exceeded."""
        self._rejection_counts[node_id] += 1
        if self._rejection_counts[node_id] >= self._max_rejections:
            self._cooldown_until[node_id] = now + self._cooldown_seconds
            logger.warning(
                "Cooldown applied after repeated rejections",
                extra={
                    "node_id": node_id,
                    "rejections": self._rejection_counts[node_id],
                    "cooldown_seconds": self._cooldown_seconds,
                },
            )
