"""
POCValidator — Stage 2 of the Canxian Validation Pipeline.

Implements the Proof of Cognitive Canxian check:
  1. Validates causal chain evidence
  2. Detects philosophical-zombie-like output
  3. Computes cognitive contribution score
  4. Optionally incorporates peer validation from trusted AHIN neighbours

POC is NOT Proof of Work or Proof of Stake.
It proves that a CanxianArtifact was produced through meaningful cognitive
effort — grounded causation, not brute-force compute or capital.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from packages.shared.domain import CanxianArtifactStatus

logger = logging.getLogger(__name__)

# Minimum cognitive score for a validated Canxian
_MIN_COGNITIVE_SCORE = 0.3


@dataclass
class POCValidationResult:
    """Result of a POC validation check."""

    artifact_id: str
    is_valid: bool
    cognitive_score: float
    is_zombie: bool
    from_status: CanxianArtifactStatus
    to_status: CanxianArtifactStatus
    evidence: Dict[str, Any] = field(default_factory=dict)
    rejection_reasons: List[str] = field(default_factory=list)
    peer_confirmations: int = 0


class POCValidator:
    """
    Validates that a grounded artifact represents genuine cognitive work.

    Distinguishes meaningful cognitive contribution from:
      - Statistical hallucination (high confidence, no causation)
      - Template-based parroting (low novelty, no grounding)
      - Brute-force approximation (no causal chain)

    A validated artifact advances to VALIDATED_CANXIAN.
    """

    def __init__(
        self,
        min_cognitive_score: float = _MIN_COGNITIVE_SCORE,
    ) -> None:
        self._min_score = min_cognitive_score

    def validate(
        self,
        artifact_id: str,
        causation_evidence: Dict[str, Any],
        grounding_score: float,
        peer_confirmations: int = 0,
    ) -> POCValidationResult:
        """
        Validate whether a grounded artifact passes the POC check.

        Parameters
        ----------
        artifact_id : str
            The CanxianArtifact identifier.
        causation_evidence : dict
            Evidence of causal chain, context references, novelty.
        grounding_score : float
            Score from the GroundingAssessor stage.
        peer_confirmations : int
            Number of trusted AHIN peers who confirmed quality.
        """
        rejection_reasons: List[str] = []

        # Compute cognitive score
        cognitive_score = self._compute_cognitive_score(
            causation_evidence, grounding_score
        )

        # Zombie detection
        is_zombie = self._detect_zombie(causation_evidence, cognitive_score)
        if is_zombie:
            rejection_reasons.append("zombie_output_detected")

        # Score check
        if cognitive_score < self._min_score:
            rejection_reasons.append(
                f"cognitive_score_too_low:{cognitive_score:.4f}<{self._min_score}"
            )

        # Causal chain presence
        causal_chain = causation_evidence.get("causal_chain", [])
        if len(causal_chain) == 0:
            rejection_reasons.append("no_causal_chain")

        # Peer validation bonus
        if peer_confirmations > 0:
            cognitive_score = min(
                cognitive_score + peer_confirmations * 0.05, 1.0
            )

        is_valid = len(rejection_reasons) == 0

        from_status = CanxianArtifactStatus.OPERATIONALLY_GROUNDED
        to_status = (
            CanxianArtifactStatus.VALIDATED_CANXIAN
            if is_valid
            else CanxianArtifactStatus.OPERATIONALLY_GROUNDED
        )

        result = POCValidationResult(
            artifact_id=artifact_id,
            is_valid=is_valid,
            cognitive_score=round(cognitive_score, 4),
            is_zombie=is_zombie,
            from_status=from_status,
            to_status=to_status,
            evidence={
                "causal_chain_length": len(causal_chain),
                "context_ref_count": len(
                    causation_evidence.get("context_references", [])
                ),
                "novelty_score": causation_evidence.get("novelty_score", 0.0),
                "confidence": causation_evidence.get("confidence", 0.0),
                "grounding_score": grounding_score,
            },
            rejection_reasons=rejection_reasons,
            peer_confirmations=peer_confirmations,
        )

        if is_valid:
            logger.info(
                "POC validated — advancing to VALIDATED_CANXIAN",
                extra={
                    "artifact_id": artifact_id,
                    "cognitive_score": cognitive_score,
                },
            )
        else:
            logger.info(
                "POC validation failed — remains GROUNDED",
                extra={
                    "artifact_id": artifact_id,
                    "reasons": rejection_reasons,
                    "is_zombie": is_zombie,
                },
            )

        return result

    # ------------------------------------------------------------------
    # Internal scoring logic
    # ------------------------------------------------------------------

    def _compute_cognitive_score(
        self, evidence: Dict[str, Any], grounding_score: float
    ) -> float:
        """
        Compute dimensionless cognitive contribution score (0–1).

        Factors:
          - causal_steps: explicit causal steps (max 0.4)
          - context_refs: grounding context refs (max 0.3)
          - novelty: flagged novelty (max 0.3)
          - grounding_bonus: if grounding_score > 0.5 (bonus 0.1)
        """
        score = 0.0
        causal_steps = len(evidence.get("causal_chain", []))
        context_refs = len(evidence.get("context_references", []))
        novelty = float(evidence.get("novelty_score", 0.0))

        score += min(causal_steps * 0.1, 0.4)
        score += min(context_refs * 0.05, 0.3)
        score += min(novelty * 0.3, 0.3)
        if grounding_score > 0.5:
            score = min(score + 0.1, 1.0)

        return round(min(score, 1.0), 4)

    def _detect_zombie(
        self, evidence: Dict[str, Any], cognitive_score: float
    ) -> bool:
        """
        Detect philosophical-zombie-like output.

        A zombie output is statistically plausible but causally ungrounded:
          - High confidence with no supporting evidence
          - Very low cognitive score with no causal chain
        """
        causal_chain = evidence.get("causal_chain", [])
        context_refs = evidence.get("context_references", [])
        confidence = float(evidence.get("confidence", 0.0))

        if confidence > 0.8 and len(causal_chain) == 0 and len(context_refs) == 0:
            return True

        if cognitive_score < 0.1 and len(causal_chain) == 0:
            return True

        return False
