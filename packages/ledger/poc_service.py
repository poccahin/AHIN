"""
POCService — Proof of Cognitive Canxian validation service.

POC is NOT:
  - Proof of Work (brute-force computation)
  - Proof of Stake (capital commitment)

POC IS:
  - Proof that a CanxianArtifact was produced through meaningful cognitive work
  - The basis for VirtueWellbeing settlement
  - The mechanism for distinguishing genuine intelligence from
    philosophical-zombie-like output

Validation criteria:
  1. Operational grounding: artifact has non-empty grounding_context
  2. Causation evidence: producer can demonstrate causal chain
  3. Non-zombie check: output is not merely statistically plausible noise
  4. Peer validation (optional): trusted AHIN peers confirm quality
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from packages.shared.domain import CanxianArtifactStatus, new_id, now_utc
from packages.shared.models import CanxianArtifactORM, POCRecordORM

logger = logging.getLogger(__name__)

# Minimum cognitive score for a validated Canxian (configurable)
_MIN_COGNITIVE_SCORE = 0.3


class POCService:
    """
    Validates CanxianArtifacts and produces POCRecords.

    This is the core epistemic gate of Life++:
    artifacts that do not pass POC validation remain as RAW_OUTPUT or GROUNDED
    and are NOT eligible for VirtueWellbeing settlement.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def validate(
        self,
        artifact_id: str,
        producer_node_id: str,
        validation_method: str,
        causation_evidence: Dict[str, Any],
        validator_node_id: Optional[str] = None,
        cognitive_score_override: Optional[float] = None,
    ) -> Optional[POCRecordORM]:
        """
        Validate a CanxianArtifact and produce a POCRecord.

        Returns None if validation fails (artifact remains un-validated).

        Steps:
          1. Retrieve the artifact
          2. Check grounding context (Tactile Brain Hypothesis)
          3. Compute cognitive score from evidence
          4. Detect philosophical-zombie-like patterns
          5. Persist POCRecord and update artifact status
        """
        # Retrieve artifact
        result = await self._session.execute(
            select(CanxianArtifactORM).where(
                CanxianArtifactORM.artifact_id == artifact_id
            )
        )
        artifact = result.scalar_one_or_none()
        if artifact is None:
            logger.error("Artifact not found for POC validation", extra={"artifact_id": artifact_id})
            return None

        # 1. Grounding check (Tactile Brain Hypothesis)
        has_grounding = bool(artifact.grounding_context)

        # 2. Cognitive score
        cognitive_score = cognitive_score_override or self._compute_cognitive_score(
            causation_evidence, has_grounding
        )

        # 3. Zombie detection
        is_zombie = self._detect_zombie_output(
            causation_evidence=causation_evidence,
            cognitive_score=cognitive_score,
        )

        # 4. Determine if valid
        is_valid_poc = (
            has_grounding
            and cognitive_score >= _MIN_COGNITIVE_SCORE
            and not is_zombie
        )

        # Build POC record
        poc = POCRecordORM(
            poc_id=new_id(),
            producer_node_id=producer_node_id,
            validator_node_id=validator_node_id,
            validation_method=validation_method,
            cognitive_score=cognitive_score,
            is_zombie_output=is_zombie,
            evidence={
                "causation_evidence": causation_evidence,
                "has_grounding": has_grounding,
                "is_valid": is_valid_poc,
            },
            spontaneous_time_order={},
            created_at=now_utc(),
        )
        self._session.add(poc)

        # Update artifact status
        if is_valid_poc:
            artifact.status = CanxianArtifactStatus.VALIDATED_CANXIAN.value
            artifact.poc_record_id = poc.poc_id
            artifact.validated_at = now_utc()
            logger.info(
                "POC validated — artifact upgraded to VALIDATED_CANXIAN",
                extra={
                    "artifact_id": artifact_id,
                    "poc_id": poc.poc_id,
                    "cognitive_score": cognitive_score,
                },
            )
        else:
            logger.warning(
                "POC validation failed — artifact remains unvalidated",
                extra={
                    "artifact_id": artifact_id,
                    "is_zombie": is_zombie,
                    "cognitive_score": cognitive_score,
                    "has_grounding": has_grounding,
                },
            )

        await self._session.flush()
        return poc if is_valid_poc else None

    # ------------------------------------------------------------------
    # Internal heuristics
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
        score += min(context_refs * 0.05, 0.3)  # max 0.3 from grounding
        score += min(novelty * 0.3, 0.3)        # max 0.3 from novelty
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

        This heuristic is intentionally conservative.
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
