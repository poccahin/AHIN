"""
GroundingAssessor — Stage 1 of the Canxian Validation Pipeline.

Implements the Tactile Brain Hypothesis check:
  An artifact is *operationally grounded* if and only if it carries
  evidence of physical or operational interaction that anchors the
  output to real-world resistance.

Without grounding, an artifact is indistinguishable from
statistical hallucination.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from packages.shared.domain import CanxianArtifactStatus

logger = logging.getLogger(__name__)

# Minimum number of context references to consider grounded
_MIN_CONTEXT_REFS = 1
# Minimum grounding score threshold
_MIN_GROUNDING_SCORE = 0.2


@dataclass
class GroundingResult:
    """Result of a grounding assessment."""

    artifact_id: str
    is_grounded: bool
    grounding_score: float
    from_status: CanxianArtifactStatus
    to_status: CanxianArtifactStatus
    evidence: Dict[str, Any] = field(default_factory=dict)
    rejection_reasons: List[str] = field(default_factory=list)


class GroundingAssessor:
    """
    Assesses whether a cognitive output is operationally grounded
    per the Tactile Brain Hypothesis.

    Grounding criteria:
      1. Non-empty grounding_context (physical/operational anchor)
      2. Context references present (sources of resistance)
      3. Interaction evidence (tool use, sensor data, real-world feedback)
      4. Self-boundary confirmation (agent acknowledges its own limits)

    An ungrounded artifact stays at RAW_OUTPUT.
    A grounded artifact advances to OPERATIONALLY_GROUNDED.
    """

    def __init__(
        self,
        min_context_refs: int = _MIN_CONTEXT_REFS,
        min_grounding_score: float = _MIN_GROUNDING_SCORE,
    ) -> None:
        self._min_context_refs = min_context_refs
        self._min_grounding_score = min_grounding_score

    def assess(
        self,
        artifact_id: str,
        grounding_context: Dict[str, Any],
        output_payload: Dict[str, Any],
    ) -> GroundingResult:
        """
        Assess whether the artifact is operationally grounded.

        Parameters
        ----------
        artifact_id : str
            The CanxianArtifact identifier.
        grounding_context : dict
            The grounding context attached to the artifact.
            Empty dict means raw model output only.
        output_payload : dict
            The cognitive output payload for secondary checks.
        """
        rejection_reasons: List[str] = []
        score = 0.0

        # 1. Non-empty grounding context
        has_context = bool(grounding_context)
        if not has_context:
            rejection_reasons.append("empty_grounding_context")

        # 2. Context references (sources of real-world resistance)
        context_refs = grounding_context.get("context_references", [])
        ref_count = len(context_refs)
        if ref_count < self._min_context_refs:
            rejection_reasons.append(
                f"insufficient_context_refs:{ref_count}<{self._min_context_refs}"
            )
        score += min(ref_count * 0.1, 0.3)

        # 3. Interaction evidence (tool use, sensor data)
        interaction_evidence = grounding_context.get("interaction_evidence", [])
        if interaction_evidence:
            score += min(len(interaction_evidence) * 0.15, 0.3)
        else:
            # Not a hard reject, but penalised
            pass

        # 4. Self-boundary markers (agent acknowledges limits)
        self_boundary = grounding_context.get("self_boundary_markers", [])
        if self_boundary:
            score += min(len(self_boundary) * 0.1, 0.2)

        # 5. Operational resistance evidence
        if grounding_context.get("operational_resistance"):
            score += 0.2

        score = round(min(score, 1.0), 4)
        is_grounded = (
            has_context
            and score >= self._min_grounding_score
            and len(rejection_reasons) == 0
        )

        from_status = CanxianArtifactStatus.RAW_OUTPUT
        to_status = (
            CanxianArtifactStatus.OPERATIONALLY_GROUNDED
            if is_grounded
            else CanxianArtifactStatus.RAW_OUTPUT
        )

        result = GroundingResult(
            artifact_id=artifact_id,
            is_grounded=is_grounded,
            grounding_score=score,
            from_status=from_status,
            to_status=to_status,
            evidence={
                "has_context": has_context,
                "context_ref_count": ref_count,
                "interaction_evidence_count": len(interaction_evidence),
                "self_boundary_count": len(self_boundary),
                "has_operational_resistance": bool(
                    grounding_context.get("operational_resistance")
                ),
            },
            rejection_reasons=rejection_reasons,
        )

        if is_grounded:
            logger.info(
                "Artifact grounded — advancing to OPERATIONALLY_GROUNDED",
                extra={"artifact_id": artifact_id, "score": score},
            )
        else:
            logger.info(
                "Artifact not grounded — remains RAW_OUTPUT",
                extra={
                    "artifact_id": artifact_id,
                    "score": score,
                    "reasons": rejection_reasons,
                },
            )

        return result
