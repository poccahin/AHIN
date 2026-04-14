"""
CanxianValidationPipeline — orchestrates the full 4-stage artifact validation.

Stages:
  1. RAW_OUTPUT     → GroundingAssessor  → OPERATIONALLY_GROUNDED
  2. GROUNDED       → POCValidator       → VALIDATED_CANXIAN
  3. VALIDATED      → PayabilityGate     → PAYABLE

Each stage emits an ArtifactValidationEvent for audit trail.

This pipeline is the concrete implementation of the theory that intelligence
is NOT mere probabilistic inference.  A valid Canxian must demonstrate:
  - Operational grounding (Tactile Brain Hypothesis)
  - Causal chain evidence (Causation Re-engineering)
  - Non-zombie cognitive work (POC)
  - Settlement eligibility (Aligned Virtue and Well-being)
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from packages.canxian_pipeline.grounding_assessor import (
    GroundingAssessor,
    GroundingResult,
)
from packages.canxian_pipeline.payability_gate import PayabilityGate, PayabilityResult
from packages.canxian_pipeline.poc_validator import POCValidator, POCValidationResult
from packages.shared.domain import CanxianArtifactStatus

logger = logging.getLogger(__name__)


@dataclass
class PipelineResult:
    """Full pipeline result with all stage outcomes."""

    artifact_id: str
    final_status: CanxianArtifactStatus
    grounding: Optional[GroundingResult] = None
    poc_validation: Optional[POCValidationResult] = None
    payability: Optional[PayabilityResult] = None
    halted_at_stage: Optional[str] = None
    stage_events: List[Dict[str, Any]] = field(default_factory=list)


class CanxianValidationPipeline:
    """
    Orchestrates the complete Canxian validation lifecycle.

    Usage:
      pipeline = CanxianValidationPipeline()
      result = pipeline.run(
          artifact_id=...,
          grounding_context=...,
          output_payload=...,
          causation_evidence=...,
          content_hash=...,
          producer_node_id=...,
          is_producer_admitted=True,
      )

    The pipeline short-circuits at any stage that fails.
    """

    def __init__(
        self,
        grounding_assessor: Optional[GroundingAssessor] = None,
        poc_validator: Optional[POCValidator] = None,
        payability_gate: Optional[PayabilityGate] = None,
        event_bus: Optional[Any] = None,
    ) -> None:
        self._grounding = grounding_assessor or GroundingAssessor()
        self._poc = poc_validator or POCValidator()
        self._payability = payability_gate or PayabilityGate()
        self._event_bus = event_bus

    def run(
        self,
        artifact_id: str,
        grounding_context: Dict[str, Any],
        output_payload: Dict[str, Any],
        causation_evidence: Dict[str, Any],
        content_hash: str,
        producer_node_id: str,
        is_producer_admitted: bool,
        is_producer_blocked: bool = False,
        peer_confirmations: int = 0,
    ) -> PipelineResult:
        """
        Run the full 4-stage Canxian validation pipeline.

        Short-circuits at the first failing stage.
        """
        stage_events: List[Dict[str, Any]] = []

        # --- Stage 1: Grounding Assessment (Tactile Brain Hypothesis) ---
        grounding_result = self._grounding.assess(
            artifact_id=artifact_id,
            grounding_context=grounding_context,
            output_payload=output_payload,
        )
        stage_events.append({
            "stage": "grounding",
            "from_status": grounding_result.from_status,
            "to_status": grounding_result.to_status,
            "is_grounded": grounding_result.is_grounded,
            "score": grounding_result.grounding_score,
        })

        if not grounding_result.is_grounded:
            logger.info(
                "Pipeline halted at grounding stage",
                extra={"artifact_id": artifact_id},
            )
            return PipelineResult(
                artifact_id=artifact_id,
                final_status=CanxianArtifactStatus.RAW_OUTPUT,
                grounding=grounding_result,
                halted_at_stage="grounding",
                stage_events=stage_events,
            )

        # --- Stage 2: POC Validation (Proof of Cognitive Canxian) ---
        poc_result = self._poc.validate(
            artifact_id=artifact_id,
            causation_evidence=causation_evidence,
            grounding_score=grounding_result.grounding_score,
            peer_confirmations=peer_confirmations,
        )
        stage_events.append({
            "stage": "poc_validation",
            "from_status": poc_result.from_status,
            "to_status": poc_result.to_status,
            "is_valid": poc_result.is_valid,
            "cognitive_score": poc_result.cognitive_score,
            "is_zombie": poc_result.is_zombie,
        })

        if not poc_result.is_valid:
            logger.info(
                "Pipeline halted at POC validation stage",
                extra={
                    "artifact_id": artifact_id,
                    "is_zombie": poc_result.is_zombie,
                },
            )
            return PipelineResult(
                artifact_id=artifact_id,
                final_status=CanxianArtifactStatus.OPERATIONALLY_GROUNDED,
                grounding=grounding_result,
                poc_validation=poc_result,
                halted_at_stage="poc_validation",
                stage_events=stage_events,
            )

        # --- Stage 3: Payability Gate (VirtueWellbeing eligibility) ---
        payability_result = self._payability.evaluate(
            artifact_id=artifact_id,
            producer_node_id=producer_node_id,
            cognitive_score=poc_result.cognitive_score,
            content_hash=content_hash,
            is_producer_admitted=is_producer_admitted,
            is_producer_blocked=is_producer_blocked,
        )
        stage_events.append({
            "stage": "payability",
            "from_status": payability_result.from_status,
            "to_status": payability_result.to_status,
            "is_payable": payability_result.is_payable,
            "settlement_weight": payability_result.settlement_weight,
        })

        if not payability_result.is_payable:
            logger.info(
                "Pipeline halted at payability gate",
                extra={"artifact_id": artifact_id},
            )
            return PipelineResult(
                artifact_id=artifact_id,
                final_status=CanxianArtifactStatus.VALIDATED_CANXIAN,
                grounding=grounding_result,
                poc_validation=poc_result,
                payability=payability_result,
                halted_at_stage="payability",
                stage_events=stage_events,
            )

        # --- All stages passed ---
        logger.info(
            "Canxian pipeline complete — artifact is PAYABLE",
            extra={
                "artifact_id": artifact_id,
                "settlement_weight": payability_result.settlement_weight,
            },
        )
        return PipelineResult(
            artifact_id=artifact_id,
            final_status=CanxianArtifactStatus.PAYABLE,
            grounding=grounding_result,
            poc_validation=poc_result,
            payability=payability_result,
            stage_events=stage_events,
        )

    def reset_cycle(self) -> None:
        """Reset per-cycle state across all stages."""
        self._payability.reset_cycle()
