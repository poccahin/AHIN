"""
PayabilityGate — Stage 3 of the Canxian Validation Pipeline.

Determines whether a VALIDATED_CANXIAN artifact is eligible for
VirtueWellbeing settlement (transition to PAYABLE).

Payability is NOT automatic.
A validated artifact may still be ineligible if:
  - The producer node is not admitted to AHIN
  - The artifact duplicates a previously settled contribution
  - The cognitive score is below the settlement threshold
  - Policy constraints block it (kill-switch, fraud flags)
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

from packages.shared.domain import CanxianArtifactStatus

logger = logging.getLogger(__name__)

# Minimum cognitive score for settlement eligibility
_MIN_PAYABLE_SCORE = 0.4
# Maximum payable artifacts per node per settlement cycle
_MAX_PAYABLE_PER_NODE_PER_CYCLE = 1000


@dataclass
class PayabilityResult:
    """Result of the payability gate check."""

    artifact_id: str
    is_payable: bool
    from_status: CanxianArtifactStatus
    to_status: CanxianArtifactStatus
    settlement_weight: float
    rejection_reasons: List[str] = field(default_factory=list)
    evidence: Dict[str, Any] = field(default_factory=dict)


class PayabilityGate:
    """
    Final gate before a CanxianArtifact becomes eligible for
    VirtueWellbeing settlement.

    Checks:
      1. Producer AHIN admission status
      2. Duplication detection (content hash)
      3. Cognitive score threshold for payability
      4. Per-node rate limiting per settlement cycle
      5. Policy engine clearance (kill-switch, fraud flags)
    """

    def __init__(
        self,
        min_payable_score: float = _MIN_PAYABLE_SCORE,
        max_payable_per_node: int = _MAX_PAYABLE_PER_NODE_PER_CYCLE,
    ) -> None:
        self._min_score = min_payable_score
        self._max_per_node = max_payable_per_node
        # Track content hashes to detect duplicates within a cycle
        self._seen_content_hashes: Set[str] = set()
        # Track per-node payable counts within a cycle
        self._node_payable_counts: Dict[str, int] = {}

    def evaluate(
        self,
        artifact_id: str,
        producer_node_id: str,
        cognitive_score: float,
        content_hash: str,
        is_producer_admitted: bool,
        is_producer_blocked: bool = False,
    ) -> PayabilityResult:
        """
        Evaluate whether a validated artifact is eligible for settlement.

        Parameters
        ----------
        artifact_id : str
            The CanxianArtifact identifier.
        producer_node_id : str
            The producing node's identifier.
        cognitive_score : float
            Score from the POCValidator stage.
        content_hash : str
            Content hash for duplication detection.
        is_producer_admitted : bool
            Whether the producer is admitted to AHIN.
        is_producer_blocked : bool
            Whether the producer is blocked by policy engine.
        """
        rejection_reasons: List[str] = []

        # 1. AHIN admission check
        if not is_producer_admitted:
            rejection_reasons.append("producer_not_admitted_to_ahin")

        # 2. Policy block check
        if is_producer_blocked:
            rejection_reasons.append("producer_blocked_by_policy")

        # 3. Cognitive score threshold
        if cognitive_score < self._min_score:
            rejection_reasons.append(
                f"cognitive_score_below_threshold:{cognitive_score:.4f}<{self._min_score}"
            )

        # 4. Duplication check
        if content_hash in self._seen_content_hashes:
            rejection_reasons.append("duplicate_content_hash")
        else:
            self._seen_content_hashes.add(content_hash)

        # 5. Per-node rate limit
        node_count = self._node_payable_counts.get(producer_node_id, 0)
        if node_count >= self._max_per_node:
            rejection_reasons.append(
                f"node_payable_limit_exceeded:{node_count}>={self._max_per_node}"
            )

        is_payable = len(rejection_reasons) == 0

        if is_payable:
            self._node_payable_counts[producer_node_id] = node_count + 1

        # Settlement weight is the cognitive score itself
        settlement_weight = cognitive_score if is_payable else 0.0

        from_status = CanxianArtifactStatus.VALIDATED_CANXIAN
        to_status = (
            CanxianArtifactStatus.PAYABLE
            if is_payable
            else CanxianArtifactStatus.VALIDATED_CANXIAN
        )

        result = PayabilityResult(
            artifact_id=artifact_id,
            is_payable=is_payable,
            from_status=from_status,
            to_status=to_status,
            settlement_weight=settlement_weight,
            rejection_reasons=rejection_reasons,
            evidence={
                "cognitive_score": cognitive_score,
                "is_producer_admitted": is_producer_admitted,
                "is_producer_blocked": is_producer_blocked,
                "is_duplicate": content_hash in self._seen_content_hashes
                and len(rejection_reasons) > 0,
                "node_payable_count": self._node_payable_counts.get(
                    producer_node_id, 0
                ),
            },
        )

        if is_payable:
            logger.info(
                "Artifact cleared for settlement — advancing to PAYABLE",
                extra={
                    "artifact_id": artifact_id,
                    "settlement_weight": settlement_weight,
                },
            )
        else:
            logger.info(
                "Artifact not eligible for settlement — remains VALIDATED_CANXIAN",
                extra={
                    "artifact_id": artifact_id,
                    "reasons": rejection_reasons,
                },
            )

        return result

    def reset_cycle(self) -> None:
        """Reset per-cycle state (called at settlement boundary)."""
        self._seen_content_hashes.clear()
        self._node_payable_counts.clear()
        logger.info("PayabilityGate cycle state reset")
