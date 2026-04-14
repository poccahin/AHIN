"""
CanxianValidationPipeline — the 4-stage cognitive objectification pipeline.

This is the structural answer to the core question:
  "How does the system distinguish mere model output from validated,
   payable cognitive contribution?"

The pipeline manages four stages:

  Stage 1: RAW_OUTPUT → assess grounding (GroundingAssessor)
  Stage 2: GROUNDED  → verify causation / anti-zombie (POC-lite check)
  Stage 3: VALIDATED_CANXIAN → check payability (PayabilityGate)
  Stage 4: PAYABLE   → eligible for VirtueWellbeing settlement

Design principles:
  - Each stage produces an event (ArtifactValidationEvent) for audit
  - The pipeline is deterministic and replayable
  - No stage can be skipped
  - Zombie-flagged artifacts are permanently excluded from settlement
  - The pipeline does NOT require a database; it operates on dicts so
    that it can run in-process (unit tests, edge terminals) or via the
    full ORM (control plane)
"""
from __future__ import annotations

import hashlib
import logging
from typing import Any, Dict, List, Optional

from packages.canxian_pipeline.grounding_assessor import GroundingAssessor, GroundingResult
from packages.canxian_pipeline.payability_gate import PayabilityGate, PayabilityResult
from packages.shared.domain import (
    CanxianArtifactStatus,
    SpontaneousTimeOrder,
    new_id,
    now_utc,
)
from packages.shared.events import ArtifactValidationEvent

logger = logging.getLogger(__name__)

# Minimum cognitive score for POC validation (mirrors POCService)
_MIN_COGNITIVE_SCORE = 0.3


class CanxianValidationPipeline:
    """
    Orchestrates the full 4-stage cognitive output validation pipeline.

    Usage::

        pipeline = CanxianValidationPipeline()
        result = pipeline.run(
            output=agent_output,
            grounding_context=device_context,
            causation_evidence=evidence,
            producer_node_id="node-abc",
            is_producer_admitted=True,
            time_order=time_order,
        )
        # result.final_status is one of the 4 CanxianArtifactStatus values
        # result.events contains all ArtifactValidationEvents emitted
    """

    def __init__(
        self,
        grounding_assessor: Optional[GroundingAssessor] = None,
        payability_gate: Optional[PayabilityGate] = None,
        min_cognitive_score: float = _MIN_COGNITIVE_SCORE,
    ) -> None:
        self._grounding = grounding_assessor or GroundingAssessor()
        self._payability = payability_gate or PayabilityGate()
        self._min_cognitive_score = min_cognitive_score

    def run(
        self,
        output: Dict[str, Any],
        grounding_context: Dict[str, Any],
        causation_evidence: Dict[str, Any],
        producer_node_id: str,
        is_producer_admitted: bool,
        time_order: SpontaneousTimeOrder,
        artifact_id: Optional[str] = None,
        validator_node_id: Optional[str] = None,
    ) -> "PipelineResult":
        """
        Run the full 4-stage validation pipeline.

        Parameters
        ----------
        output:
            Raw artifact content produced by the agent.
        grounding_context:
            Operational context from the environment.
        causation_evidence:
            Evidence of causal reasoning (causal_chain, context_references, etc.).
        producer_node_id:
            AHIN node ID of the artifact producer.
        is_producer_admitted:
            Whether the producer is admitted to AHIN.
        time_order:
            SpontaneousTimeOrder for event timestamping.
        artifact_id:
            Optional pre-assigned artifact ID. Generated if not supplied.
        validator_node_id:
            Optional node ID of the external validator.

        Returns
        -------
        PipelineResult with final_status, events, and stage outcomes.
        """
        artifact_id = artifact_id or new_id()
        events: List[ArtifactValidationEvent] = []
        current_status = CanxianArtifactStatus.RAW_OUTPUT

        # ----------------------------------------------------------
        # Stage 1: Grounding assessment (RAW_OUTPUT → GROUNDED)
        # ----------------------------------------------------------
        grounding_result = self._grounding.assess(output, grounding_context)

        if grounding_result.is_grounded:
            new_status = CanxianArtifactStatus.OPERATIONALLY_GROUNDED
            events.append(
                self._make_event(
                    artifact_id=artifact_id,
                    producer_node_id=producer_node_id,
                    from_status=current_status,
                    to_status=new_status,
                    time_order=time_order,
                    evidence=grounding_result.to_dict(),
                )
            )
            current_status = new_status
        else:
            # Stays RAW_OUTPUT — pipeline stops here
            logger.info(
                "Pipeline halted at Stage 1 — output not grounded",
                extra={"artifact_id": artifact_id},
            )
            return PipelineResult(
                artifact_id=artifact_id,
                final_status=current_status,
                grounding_result=grounding_result,
                cognitive_score=0.0,
                is_zombie=False,
                payability_result=None,
                events=events,
            )

        # ----------------------------------------------------------
        # Stage 2: POC-lite validation (GROUNDED → VALIDATED_CANXIAN)
        # ----------------------------------------------------------
        cognitive_score = self._compute_cognitive_score(
            causation_evidence, grounding_result.has_context
        )
        is_zombie = self._detect_zombie_output(causation_evidence, cognitive_score)

        is_valid_poc = (
            cognitive_score >= self._min_cognitive_score and not is_zombie
        )

        if is_valid_poc:
            new_status = CanxianArtifactStatus.VALIDATED_CANXIAN
            events.append(
                self._make_event(
                    artifact_id=artifact_id,
                    producer_node_id=producer_node_id,
                    from_status=current_status,
                    to_status=new_status,
                    time_order=time_order,
                    validator_node_id=validator_node_id,
                    poc_id=new_id(),
                    is_zombie_flagged=is_zombie,
                    evidence={
                        "cognitive_score": cognitive_score,
                        "is_zombie": is_zombie,
                        "causation_evidence": causation_evidence,
                    },
                )
            )
            current_status = new_status
        else:
            # Stays GROUNDED — pipeline stops here
            events.append(
                self._make_event(
                    artifact_id=artifact_id,
                    producer_node_id=producer_node_id,
                    from_status=current_status,
                    to_status=current_status,  # no promotion
                    time_order=time_order,
                    is_zombie_flagged=is_zombie,
                    evidence={
                        "cognitive_score": cognitive_score,
                        "is_zombie": is_zombie,
                        "validation_failed": True,
                    },
                )
            )
            logger.info(
                "Pipeline halted at Stage 2 — POC validation failed",
                extra={
                    "artifact_id": artifact_id,
                    "cognitive_score": cognitive_score,
                    "is_zombie": is_zombie,
                },
            )
            return PipelineResult(
                artifact_id=artifact_id,
                final_status=current_status,
                grounding_result=grounding_result,
                cognitive_score=cognitive_score,
                is_zombie=is_zombie,
                payability_result=None,
                events=events,
            )

        # ----------------------------------------------------------
        # Stage 3: Payability gate (VALIDATED_CANXIAN → PAYABLE)
        # ----------------------------------------------------------
        poc_record_id = events[-1].poc_id  # from Stage 2 event
        payability_result = self._payability.evaluate(
            artifact_status=current_status,
            producer_node_id=producer_node_id,
            is_producer_admitted=is_producer_admitted,
            cognitive_score=cognitive_score,
            is_zombie_flagged=is_zombie,
            poc_record_id=poc_record_id,
        )

        if payability_result.is_payable:
            new_status = CanxianArtifactStatus.PAYABLE
            events.append(
                self._make_event(
                    artifact_id=artifact_id,
                    producer_node_id=producer_node_id,
                    from_status=current_status,
                    to_status=new_status,
                    time_order=time_order,
                    evidence=payability_result.to_dict(),
                )
            )
            current_status = new_status
        else:
            logger.info(
                "Pipeline halted at Stage 3 — payability check failed",
                extra={
                    "artifact_id": artifact_id,
                    "reasons": payability_result.reasons,
                },
            )

        return PipelineResult(
            artifact_id=artifact_id,
            final_status=current_status,
            grounding_result=grounding_result,
            cognitive_score=cognitive_score,
            is_zombie=is_zombie,
            payability_result=payability_result,
            events=events,
        )

    # ------------------------------------------------------------------
    # Internal scoring (mirrors POCService for in-process use)
    # ------------------------------------------------------------------

    def _compute_cognitive_score(
        self, evidence: Dict[str, Any], has_grounding: bool
    ) -> float:
        """
        Compute a dimensionless cognitive contribution score (0–1).

        Factors:
          - causal_steps: number of explicit causal steps in evidence
          - context_refs: number of context references (grounding)
          - novelty: whether the output is flagged as novel
        """
        score = 0.0
        causal_steps = len(evidence.get("causal_chain", []))
        context_refs = len(evidence.get("context_references", []))
        novelty = float(evidence.get("novelty_score", 0.0))

        score += min(causal_steps * 0.1, 0.4)   # max 0.4 from causation
        score += min(context_refs * 0.05, 0.3)   # max 0.3 from grounding
        score += min(novelty * 0.3, 0.3)         # max 0.3 from novelty
        if has_grounding:
            score = min(score + 0.1, 1.0)

        return round(min(score, 1.0), 4)

    def _detect_zombie_output(
        self, causation_evidence: Dict[str, Any], cognitive_score: float
    ) -> bool:
        """
        Detect philosophically-zombie-like output.

        A zombie output is statistically plausible but causally ungrounded:
          - No explicit causal chain
          - No context references
          - Suspiciously high confidence with low evidence
        """
        causal_chain = causation_evidence.get("causal_chain", [])
        context_refs = causation_evidence.get("context_references", [])
        confidence = float(causation_evidence.get("confidence", 0.0))

        # High confidence with no supporting evidence is a zombie indicator
        if confidence > 0.8 and len(causal_chain) == 0 and len(context_refs) == 0:
            return True

        # Very low cognitive score with no grounding
        if cognitive_score < 0.1 and len(causal_chain) == 0:
            return True

        return False

    # ------------------------------------------------------------------
    # Event factory
    # ------------------------------------------------------------------

    @staticmethod
    def _make_event(
        artifact_id: str,
        producer_node_id: str,
        from_status: CanxianArtifactStatus,
        to_status: CanxianArtifactStatus,
        time_order: SpontaneousTimeOrder,
        validator_node_id: Optional[str] = None,
        poc_id: Optional[str] = None,
        is_zombie_flagged: bool = False,
        evidence: Optional[Dict[str, Any]] = None,
    ) -> ArtifactValidationEvent:
        return ArtifactValidationEvent(
            artifact_id=artifact_id,
            producer_node_id=producer_node_id,
            from_status=from_status,
            to_status=to_status,
            validator_node_id=validator_node_id,
            poc_id=poc_id,
            is_zombie_flagged=is_zombie_flagged,
            validation_evidence=evidence or {},
            time_order=time_order,
        )


class PipelineResult:
    """Outcome of the full 4-stage Canxian validation pipeline."""

    __slots__ = (
        "artifact_id",
        "final_status",
        "grounding_result",
        "cognitive_score",
        "is_zombie",
        "payability_result",
        "events",
    )

    def __init__(
        self,
        *,
        artifact_id: str,
        final_status: CanxianArtifactStatus,
        grounding_result: GroundingResult,
        cognitive_score: float,
        is_zombie: bool,
        payability_result: Optional[PayabilityResult],
        events: List[ArtifactValidationEvent],
    ) -> None:
        self.artifact_id = artifact_id
        self.final_status = final_status
        self.grounding_result = grounding_result
        self.cognitive_score = cognitive_score
        self.is_zombie = is_zombie
        self.payability_result = payability_result
        self.events = events

    def to_dict(self) -> Dict[str, Any]:
        return {
            "artifact_id": self.artifact_id,
            "final_status": (
                self.final_status.value
                if isinstance(self.final_status, CanxianArtifactStatus)
                else str(self.final_status)
            ),
            "cognitive_score": self.cognitive_score,
            "is_zombie": self.is_zombie,
            "grounding": self.grounding_result.to_dict(),
            "payability": (
                self.payability_result.to_dict()
                if self.payability_result
                else None
            ),
            "event_count": len(self.events),
        }
