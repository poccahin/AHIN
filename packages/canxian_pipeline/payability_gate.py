"""
PayabilityGate — final settlement-eligibility check.

Determines whether a VALIDATED_CANXIAN artifact is eligible to be promoted
to PAYABLE status (and thus eligible for VirtueWellbeing settlement).

This gate enforces:
  1. The artifact must already be at VALIDATED_CANXIAN status
  2. A valid POC record must exist with cognitive_score above threshold
  3. The artifact must NOT be zombie-flagged
  4. The producer node must be admitted to AHIN
  5. The producer node must not be blocked by PolicyEngine

Only PAYABLE artifacts are included in settlement batches.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from packages.shared.domain import CanxianArtifactStatus

logger = logging.getLogger(__name__)

# Minimum cognitive score to reach PAYABLE
_MIN_PAYABLE_SCORE = 0.3

# Maximum zombie strikes before permanent block (mirrors PolicyEngine)
_MAX_ZOMBIE_STRIKES = 3


class PayabilityGate:
    """
    Final gate before an artifact becomes eligible for settlement.

    This is the structural enforcement of:
      "Only meaningful cognitive contribution — not brute-force compute
       or pure capital stake — earns VirtueWellbeing settlement."
    """

    def __init__(
        self,
        min_cognitive_score: float = _MIN_PAYABLE_SCORE,
        blocked_node_ids: Optional[set] = None,
    ) -> None:
        self._min_cognitive_score = min_cognitive_score
        self._blocked_node_ids: set = blocked_node_ids or set()

    def evaluate(
        self,
        artifact_status: CanxianArtifactStatus,
        producer_node_id: str,
        is_producer_admitted: bool,
        cognitive_score: float,
        is_zombie_flagged: bool,
        poc_record_id: Optional[str] = None,
    ) -> "PayabilityResult":
        """
        Determine whether an artifact is eligible for PAYABLE promotion.

        Parameters
        ----------
        artifact_status:
            Current status of the CanxianArtifact.
        producer_node_id:
            AHIN node ID of the artifact producer.
        is_producer_admitted:
            Whether the producer is admitted to AHIN.
        cognitive_score:
            POC-assigned cognitive contribution score.
        is_zombie_flagged:
            Whether the POC flagged the artifact as zombie-like.
        poc_record_id:
            ID of the POC record (must exist for PAYABLE).

        Returns
        -------
        PayabilityResult with ``is_payable`` and failure reasons.
        """
        reasons: List[str] = []

        # 1. Status must be VALIDATED_CANXIAN
        is_validated = (
            artifact_status == CanxianArtifactStatus.VALIDATED_CANXIAN
            or artifact_status == CanxianArtifactStatus.VALIDATED_CANXIAN.value
        )
        if not is_validated:
            reasons.append(
                f"artifact status is {artifact_status}, "
                f"expected {CanxianArtifactStatus.VALIDATED_CANXIAN.value}"
            )

        # 2. POC record must exist
        if not poc_record_id:
            reasons.append("no POC record linked to artifact")

        # 3. Cognitive score must meet threshold
        if cognitive_score < self._min_cognitive_score:
            reasons.append(
                f"cognitive_score {cognitive_score:.4f} "
                f"below threshold {self._min_cognitive_score}"
            )

        # 4. Not zombie-flagged
        if is_zombie_flagged:
            reasons.append("artifact is zombie-flagged")

        # 5. Producer must be admitted to AHIN
        if not is_producer_admitted:
            reasons.append("producer not admitted to AHIN")

        # 6. Producer must not be blocked
        if producer_node_id in self._blocked_node_ids:
            reasons.append("producer node is blocked by PolicyEngine")

        is_payable = len(reasons) == 0

        result = PayabilityResult(
            is_payable=is_payable,
            artifact_status=str(artifact_status),
            cognitive_score=cognitive_score,
            reasons=reasons,
        )

        if is_payable:
            logger.info(
                "PayabilityGate PASSED — artifact eligible for settlement",
                extra={
                    "producer_node_id": producer_node_id,
                    "cognitive_score": cognitive_score,
                },
            )
        else:
            logger.info(
                "PayabilityGate FAILED — artifact not eligible",
                extra={
                    "producer_node_id": producer_node_id,
                    "reasons": reasons,
                },
            )

        return result

    def block_node(self, node_id: str) -> None:
        """Block a node from having artifacts promoted to PAYABLE."""
        self._blocked_node_ids.add(node_id)

    def unblock_node(self, node_id: str) -> None:
        """Restore a node's eligibility."""
        self._blocked_node_ids.discard(node_id)


class PayabilityResult:
    """Outcome of a payability gate evaluation."""

    __slots__ = ("is_payable", "artifact_status", "cognitive_score", "reasons")

    def __init__(
        self,
        *,
        is_payable: bool,
        artifact_status: str,
        cognitive_score: float,
        reasons: List[str],
    ) -> None:
        self.is_payable = is_payable
        self.artifact_status = artifact_status
        self.cognitive_score = cognitive_score
        self.reasons = reasons

    def to_dict(self) -> Dict[str, Any]:
        return {
            "is_payable": self.is_payable,
            "artifact_status": self.artifact_status,
            "cognitive_score": self.cognitive_score,
            "reasons": self.reasons,
        }
