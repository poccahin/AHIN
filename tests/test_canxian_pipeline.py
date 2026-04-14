"""
Tests for the Canxian Validation Pipeline — the 4-stage cognitive
objectification pipeline that is the structural answer to the core
question of the Life++ Agent OS.

Tests cover:
  - GroundingAssessor (Stage 1: RAW_OUTPUT → GROUNDED)
  - PayabilityGate    (Stage 3: VALIDATED_CANXIAN → PAYABLE)
  - CanxianValidationPipeline (full 4-stage pipeline)
  - Zombie detection (Causation Re-engineering check)
  - Edge cases (empty evidence, blocked nodes, unadmitted producers)
"""
from __future__ import annotations

import pytest

from packages.shared.domain import CanxianArtifactStatus, SpontaneousTimeOrder


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _time_order(node_id: str = "test-node", seq: int = 1) -> SpontaneousTimeOrder:
    return SpontaneousTimeOrder(local_sequence=seq, node_id=node_id)


def _grounded_output() -> dict:
    """Output that passes grounding: has causal chain and context refs."""
    return {
        "answer": "grounded response",
        "causal_chain": ["step1", "step2", "step3"],
        "context_references": ["ref1", "ref2"],
        "novelty_score": 0.5,
    }


def _grounded_context() -> dict:
    """Non-empty grounding context (edge terminal / device context)."""
    return {"device_id": "terminal-001", "location": "lab-3"}


def _zombie_output() -> dict:
    """Output with high confidence but no causal chain or refs — zombie."""
    return {
        "answer": "fluent but hollow response",
        "confidence": 0.95,
    }


def _low_quality_output() -> dict:
    """Output with a single causal step but no context refs — not enough."""
    return {
        "answer": "partial",
        "causal_chain": ["step1"],
    }


# ---------------------------------------------------------------------------
# GroundingAssessor
# ---------------------------------------------------------------------------

class TestGroundingAssessor:
    def test_grounded_output_passes(self):
        from packages.canxian_pipeline.grounding_assessor import GroundingAssessor
        assessor = GroundingAssessor()
        result = assessor.assess(_grounded_output(), _grounded_context())
        assert result.is_grounded is True
        assert result.has_context is True
        assert result.has_sufficient_refs is True
        assert result.has_causation is True

    def test_empty_context_fails(self):
        from packages.canxian_pipeline.grounding_assessor import GroundingAssessor
        assessor = GroundingAssessor()
        result = assessor.assess(_grounded_output(), {})
        assert result.is_grounded is False
        assert "grounding_context is empty" in result.reasons

    def test_no_context_refs_fails(self):
        from packages.canxian_pipeline.grounding_assessor import GroundingAssessor
        assessor = GroundingAssessor()
        output = {"answer": "no refs", "causal_chain": ["step1"]}
        result = assessor.assess(output, _grounded_context())
        assert result.is_grounded is False
        assert any("context_references" in r for r in result.reasons)

    def test_no_causal_chain_fails(self):
        from packages.canxian_pipeline.grounding_assessor import GroundingAssessor
        assessor = GroundingAssessor()
        output = {"answer": "no causation", "context_references": ["ref1"]}
        result = assessor.assess(output, _grounded_context())
        assert result.is_grounded is False
        assert any("causal_chain" in r for r in result.reasons)

    def test_custom_thresholds(self):
        from packages.canxian_pipeline.grounding_assessor import GroundingAssessor
        assessor = GroundingAssessor(min_context_refs=3, min_causal_steps=5)
        # Default grounded output has 2 refs and 3 steps — not enough
        result = assessor.assess(_grounded_output(), _grounded_context())
        assert result.is_grounded is False

    def test_result_to_dict(self):
        from packages.canxian_pipeline.grounding_assessor import GroundingAssessor
        assessor = GroundingAssessor()
        result = assessor.assess(_grounded_output(), _grounded_context())
        d = result.to_dict()
        assert "is_grounded" in d
        assert "context_ref_count" in d
        assert "causal_step_count" in d


# ---------------------------------------------------------------------------
# PayabilityGate
# ---------------------------------------------------------------------------

class TestPayabilityGate:
    def test_valid_artifact_passes(self):
        from packages.canxian_pipeline.payability_gate import PayabilityGate
        gate = PayabilityGate()
        result = gate.evaluate(
            artifact_status=CanxianArtifactStatus.VALIDATED_CANXIAN,
            producer_node_id="node-a",
            is_producer_admitted=True,
            cognitive_score=0.7,
            is_zombie_flagged=False,
            poc_record_id="poc-001",
        )
        assert result.is_payable is True
        assert result.reasons == []

    def test_raw_output_fails(self):
        from packages.canxian_pipeline.payability_gate import PayabilityGate
        gate = PayabilityGate()
        result = gate.evaluate(
            artifact_status=CanxianArtifactStatus.RAW_OUTPUT,
            producer_node_id="node-a",
            is_producer_admitted=True,
            cognitive_score=0.7,
            is_zombie_flagged=False,
            poc_record_id="poc-001",
        )
        assert result.is_payable is False

    def test_no_poc_record_fails(self):
        from packages.canxian_pipeline.payability_gate import PayabilityGate
        gate = PayabilityGate()
        result = gate.evaluate(
            artifact_status=CanxianArtifactStatus.VALIDATED_CANXIAN,
            producer_node_id="node-a",
            is_producer_admitted=True,
            cognitive_score=0.7,
            is_zombie_flagged=False,
            poc_record_id=None,
        )
        assert result.is_payable is False
        assert any("POC record" in r for r in result.reasons)

    def test_low_score_fails(self):
        from packages.canxian_pipeline.payability_gate import PayabilityGate
        gate = PayabilityGate()
        result = gate.evaluate(
            artifact_status=CanxianArtifactStatus.VALIDATED_CANXIAN,
            producer_node_id="node-a",
            is_producer_admitted=True,
            cognitive_score=0.1,
            is_zombie_flagged=False,
            poc_record_id="poc-001",
        )
        assert result.is_payable is False
        assert any("cognitive_score" in r for r in result.reasons)

    def test_zombie_flagged_fails(self):
        from packages.canxian_pipeline.payability_gate import PayabilityGate
        gate = PayabilityGate()
        result = gate.evaluate(
            artifact_status=CanxianArtifactStatus.VALIDATED_CANXIAN,
            producer_node_id="node-a",
            is_producer_admitted=True,
            cognitive_score=0.7,
            is_zombie_flagged=True,
            poc_record_id="poc-001",
        )
        assert result.is_payable is False
        assert any("zombie" in r for r in result.reasons)

    def test_unadmitted_producer_fails(self):
        from packages.canxian_pipeline.payability_gate import PayabilityGate
        gate = PayabilityGate()
        result = gate.evaluate(
            artifact_status=CanxianArtifactStatus.VALIDATED_CANXIAN,
            producer_node_id="node-a",
            is_producer_admitted=False,
            cognitive_score=0.7,
            is_zombie_flagged=False,
            poc_record_id="poc-001",
        )
        assert result.is_payable is False
        assert any("admitted" in r for r in result.reasons)

    def test_blocked_node_fails(self):
        from packages.canxian_pipeline.payability_gate import PayabilityGate
        gate = PayabilityGate(blocked_node_ids={"node-a"})
        result = gate.evaluate(
            artifact_status=CanxianArtifactStatus.VALIDATED_CANXIAN,
            producer_node_id="node-a",
            is_producer_admitted=True,
            cognitive_score=0.7,
            is_zombie_flagged=False,
            poc_record_id="poc-001",
        )
        assert result.is_payable is False
        assert any("blocked" in r for r in result.reasons)

    def test_block_and_unblock_node(self):
        from packages.canxian_pipeline.payability_gate import PayabilityGate
        gate = PayabilityGate()
        gate.block_node("node-x")
        result = gate.evaluate(
            artifact_status=CanxianArtifactStatus.VALIDATED_CANXIAN,
            producer_node_id="node-x",
            is_producer_admitted=True,
            cognitive_score=0.7,
            is_zombie_flagged=False,
            poc_record_id="poc-001",
        )
        assert result.is_payable is False
        gate.unblock_node("node-x")
        result2 = gate.evaluate(
            artifact_status=CanxianArtifactStatus.VALIDATED_CANXIAN,
            producer_node_id="node-x",
            is_producer_admitted=True,
            cognitive_score=0.7,
            is_zombie_flagged=False,
            poc_record_id="poc-001",
        )
        assert result2.is_payable is True

    def test_result_to_dict(self):
        from packages.canxian_pipeline.payability_gate import PayabilityGate
        gate = PayabilityGate()
        result = gate.evaluate(
            artifact_status=CanxianArtifactStatus.VALIDATED_CANXIAN,
            producer_node_id="node-a",
            is_producer_admitted=True,
            cognitive_score=0.7,
            is_zombie_flagged=False,
            poc_record_id="poc-001",
        )
        d = result.to_dict()
        assert "is_payable" in d
        assert "cognitive_score" in d


# ---------------------------------------------------------------------------
# Full Canxian Validation Pipeline
# ---------------------------------------------------------------------------

class TestCanxianValidationPipeline:
    def test_fully_grounded_admitted_reaches_payable(self):
        from packages.canxian_pipeline import CanxianValidationPipeline
        pipeline = CanxianValidationPipeline()
        result = pipeline.run(
            output=_grounded_output(),
            grounding_context=_grounded_context(),
            causation_evidence=_grounded_output(),  # reuse as evidence
            producer_node_id="node-a",
            is_producer_admitted=True,
            time_order=_time_order(),
        )
        assert result.final_status == CanxianArtifactStatus.PAYABLE
        # 3 events: RAW→GROUNDED, GROUNDED→VALIDATED, VALIDATED→PAYABLE
        assert len(result.events) == 3
        assert result.cognitive_score >= 0.3
        assert result.is_zombie is False

    def test_ungrounded_output_stays_raw(self):
        from packages.canxian_pipeline import CanxianValidationPipeline
        pipeline = CanxianValidationPipeline()
        result = pipeline.run(
            output={"answer": "no grounding at all"},
            grounding_context={},
            causation_evidence={},
            producer_node_id="node-a",
            is_producer_admitted=True,
            time_order=_time_order(),
        )
        assert result.final_status == CanxianArtifactStatus.RAW_OUTPUT
        assert len(result.events) == 0  # no promotion events

    def test_zombie_output_stays_grounded(self):
        """
        Zombie output has grounding context but high confidence with
        no causal chain — should halt at GROUNDED (POC fails).
        """
        from packages.canxian_pipeline import CanxianValidationPipeline
        pipeline = CanxianValidationPipeline()
        # Give it context_references and causal_chain to pass grounding,
        # but zombie evidence for POC
        zombie_with_grounding = {
            "answer": "hollow",
            "context_references": ["ref1"],
            "causal_chain": ["step1"],
            "confidence": 0.95,
        }
        result = pipeline.run(
            output=zombie_with_grounding,
            grounding_context=_grounded_context(),
            # Zombie causation evidence: high confidence, no chain
            causation_evidence={"confidence": 0.95},
            producer_node_id="node-a",
            is_producer_admitted=True,
            time_order=_time_order(),
        )
        # Grounding passes (stage 1) but POC fails (stage 2)
        assert result.final_status == CanxianArtifactStatus.OPERATIONALLY_GROUNDED
        assert result.is_zombie is True

    def test_unadmitted_producer_stops_at_validated(self):
        from packages.canxian_pipeline import CanxianValidationPipeline
        pipeline = CanxianValidationPipeline()
        result = pipeline.run(
            output=_grounded_output(),
            grounding_context=_grounded_context(),
            causation_evidence=_grounded_output(),
            producer_node_id="node-unadmitted",
            is_producer_admitted=False,
            time_order=_time_order(),
        )
        # Passes grounding (stage 1) and POC (stage 2),
        # but payability fails (stage 3) because producer is not admitted
        assert result.final_status == CanxianArtifactStatus.VALIDATED_CANXIAN
        assert result.payability_result is not None
        assert result.payability_result.is_payable is False

    def test_blocked_producer_stops_at_validated(self):
        from packages.canxian_pipeline import CanxianValidationPipeline
        from packages.canxian_pipeline.payability_gate import PayabilityGate
        gate = PayabilityGate(blocked_node_ids={"node-blocked"})
        pipeline = CanxianValidationPipeline(payability_gate=gate)
        result = pipeline.run(
            output=_grounded_output(),
            grounding_context=_grounded_context(),
            causation_evidence=_grounded_output(),
            producer_node_id="node-blocked",
            is_producer_admitted=True,
            time_order=_time_order(),
        )
        assert result.final_status == CanxianArtifactStatus.VALIDATED_CANXIAN
        assert result.payability_result is not None
        assert any("blocked" in r for r in result.payability_result.reasons)

    def test_low_quality_output_halts_at_grounded(self):
        """Low cognitive score → POC fails → stays GROUNDED."""
        from packages.canxian_pipeline import CanxianValidationPipeline
        pipeline = CanxianValidationPipeline()
        output_with_grounding = {
            "answer": "minimal",
            "context_references": ["ref1"],
            "causal_chain": ["step1"],
        }
        result = pipeline.run(
            output=output_with_grounding,
            grounding_context=_grounded_context(),
            # Very weak evidence
            causation_evidence={"causal_chain": ["step1"]},
            producer_node_id="node-a",
            is_producer_admitted=True,
            time_order=_time_order(),
        )
        # cognitive_score for 1 causal step = 0.1 + 0.1 (grounding) = 0.2 < 0.3
        assert result.final_status == CanxianArtifactStatus.OPERATIONALLY_GROUNDED
        assert result.cognitive_score < 0.3

    def test_artifact_id_is_preserved_when_supplied(self):
        from packages.canxian_pipeline import CanxianValidationPipeline
        pipeline = CanxianValidationPipeline()
        result = pipeline.run(
            output=_grounded_output(),
            grounding_context=_grounded_context(),
            causation_evidence=_grounded_output(),
            producer_node_id="node-a",
            is_producer_admitted=True,
            time_order=_time_order(),
            artifact_id="custom-artifact-id",
        )
        assert result.artifact_id == "custom-artifact-id"

    def test_pipeline_result_to_dict(self):
        from packages.canxian_pipeline import CanxianValidationPipeline
        pipeline = CanxianValidationPipeline()
        result = pipeline.run(
            output=_grounded_output(),
            grounding_context=_grounded_context(),
            causation_evidence=_grounded_output(),
            producer_node_id="node-a",
            is_producer_admitted=True,
            time_order=_time_order(),
        )
        d = result.to_dict()
        assert d["final_status"] == "payable"
        assert d["event_count"] == 3
        assert d["is_zombie"] is False

    def test_events_have_correct_status_transitions(self):
        from packages.canxian_pipeline import CanxianValidationPipeline
        pipeline = CanxianValidationPipeline()
        result = pipeline.run(
            output=_grounded_output(),
            grounding_context=_grounded_context(),
            causation_evidence=_grounded_output(),
            producer_node_id="node-a",
            is_producer_admitted=True,
            time_order=_time_order(),
        )
        assert len(result.events) == 3
        # Event 1: RAW_OUTPUT → GROUNDED
        assert result.events[0].from_status == CanxianArtifactStatus.RAW_OUTPUT.value
        assert result.events[0].to_status == CanxianArtifactStatus.OPERATIONALLY_GROUNDED.value
        # Event 2: GROUNDED → VALIDATED_CANXIAN
        assert result.events[1].from_status == CanxianArtifactStatus.OPERATIONALLY_GROUNDED.value
        assert result.events[1].to_status == CanxianArtifactStatus.VALIDATED_CANXIAN.value
        # Event 3: VALIDATED_CANXIAN → PAYABLE
        assert result.events[2].from_status == CanxianArtifactStatus.VALIDATED_CANXIAN.value
        assert result.events[2].to_status == CanxianArtifactStatus.PAYABLE.value


# ---------------------------------------------------------------------------
# Zombie detection (Causation Re-engineering)
# ---------------------------------------------------------------------------

class TestZombieDetection:
    def test_high_confidence_no_evidence_is_zombie(self):
        from packages.canxian_pipeline.canxian_validation_pipeline import (
            CanxianValidationPipeline,
        )
        pipeline = CanxianValidationPipeline()
        assert pipeline._detect_zombie_output(
            {"confidence": 0.95}, cognitive_score=0.0
        ) is True

    def test_low_score_no_causation_is_zombie(self):
        from packages.canxian_pipeline.canxian_validation_pipeline import (
            CanxianValidationPipeline,
        )
        pipeline = CanxianValidationPipeline()
        assert pipeline._detect_zombie_output(
            {}, cognitive_score=0.05
        ) is True

    def test_genuine_output_is_not_zombie(self):
        from packages.canxian_pipeline.canxian_validation_pipeline import (
            CanxianValidationPipeline,
        )
        pipeline = CanxianValidationPipeline()
        assert pipeline._detect_zombie_output(
            {
                "causal_chain": ["step1", "step2"],
                "context_references": ["ref1"],
                "confidence": 0.8,
            },
            cognitive_score=0.5,
        ) is False
