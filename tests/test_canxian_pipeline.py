"""
Tests for the Canxian Validation Pipeline.

Covers:
  - GroundingAssessor (Tactile Brain Hypothesis check)
  - POCValidator (Proof of Cognitive Canxian / zombie detection)
  - PayabilityGate (VirtueWellbeing settlement eligibility)
  - CanxianValidationPipeline (full 4-stage orchestration)
"""
import pytest

from packages.canxian_pipeline.grounding_assessor import GroundingAssessor
from packages.canxian_pipeline.poc_validator import POCValidator
from packages.canxian_pipeline.payability_gate import PayabilityGate
from packages.canxian_pipeline.canxian_validation_pipeline import (
    CanxianValidationPipeline,
)
from packages.shared.domain import CanxianArtifactStatus


# ---------------------------------------------------------------------------
# GroundingAssessor tests
# ---------------------------------------------------------------------------

class TestGroundingAssessor:

    def test_empty_context_not_grounded(self):
        assessor = GroundingAssessor()
        result = assessor.assess("art-1", {}, {})
        assert not result.is_grounded
        assert result.to_status == CanxianArtifactStatus.RAW_OUTPUT
        assert "empty_grounding_context" in result.rejection_reasons

    def test_context_with_refs_is_grounded(self):
        assessor = GroundingAssessor()
        context = {
            "context_references": ["sensor_data_001", "tool_output_002"],
            "interaction_evidence": ["touch_event"],
            "operational_resistance": True,
        }
        result = assessor.assess("art-2", context, {})
        assert result.is_grounded
        assert result.to_status == CanxianArtifactStatus.OPERATIONALLY_GROUNDED
        assert result.grounding_score > 0

    def test_context_without_refs_not_grounded(self):
        assessor = GroundingAssessor()
        context = {"some_key": "some_value"}  # No context_references
        result = assessor.assess("art-3", context, {})
        assert not result.is_grounded
        assert "insufficient_context_refs:0<1" in result.rejection_reasons

    def test_self_boundary_markers_boost_score(self):
        assessor = GroundingAssessor()
        context_without = {
            "context_references": ["ref1", "ref2"],
            "interaction_evidence": ["ev1"],
        }
        context_with = {
            **context_without,
            "self_boundary_markers": ["limitation_ack", "uncertainty_flag"],
        }
        result_without = assessor.assess("art-4a", context_without, {})
        result_with = assessor.assess("art-4b", context_with, {})
        assert result_with.grounding_score > result_without.grounding_score

    def test_operational_resistance_boosts_score(self):
        assessor = GroundingAssessor()
        context = {
            "context_references": ["ref1"],
            "operational_resistance": True,
        }
        result = assessor.assess("art-5", context, {})
        assert result.is_grounded
        assert result.grounding_score >= 0.3  # ref + resistance

    def test_custom_thresholds(self):
        strict = GroundingAssessor(min_context_refs=3, min_grounding_score=0.8)
        context = {"context_references": ["ref1"]}
        result = strict.assess("art-6", context, {})
        assert not result.is_grounded


# ---------------------------------------------------------------------------
# POCValidator tests
# ---------------------------------------------------------------------------

class TestPOCValidator:

    def test_valid_causation_passes(self):
        validator = POCValidator()
        evidence = {
            "causal_chain": ["step1", "step2", "step3", "step4"],
            "context_references": ["ctx1", "ctx2", "ctx3"],
            "novelty_score": 0.7,
            "confidence": 0.6,
        }
        result = validator.validate("art-10", evidence, grounding_score=0.6)
        assert result.is_valid
        assert result.to_status == CanxianArtifactStatus.VALIDATED_CANXIAN
        assert not result.is_zombie
        assert result.cognitive_score >= 0.3

    def test_no_causal_chain_fails(self):
        validator = POCValidator()
        evidence = {
            "causal_chain": [],
            "context_references": ["ctx1"],
            "novelty_score": 0.5,
        }
        result = validator.validate("art-11", evidence, grounding_score=0.5)
        assert not result.is_valid
        assert "no_causal_chain" in result.rejection_reasons

    def test_zombie_detection_high_confidence_no_evidence(self):
        validator = POCValidator()
        evidence = {
            "causal_chain": [],
            "context_references": [],
            "confidence": 0.95,
        }
        result = validator.validate("art-12", evidence, grounding_score=0.3)
        assert result.is_zombie
        assert not result.is_valid

    def test_zombie_detection_low_score_no_chain(self):
        validator = POCValidator()
        evidence = {
            "causal_chain": [],
            "context_references": ["ctx1"],
            "confidence": 0.3,
        }
        result = validator.validate("art-13", evidence, grounding_score=0.2)
        assert result.is_zombie
        assert not result.is_valid

    def test_peer_confirmations_boost_score(self):
        validator = POCValidator()
        evidence = {
            "causal_chain": ["step1", "step2", "step3"],
            "context_references": ["ctx1", "ctx2"],
            "novelty_score": 0.5,
        }
        result_without = validator.validate("art-14a", evidence, grounding_score=0.5)
        result_with = validator.validate(
            "art-14b", evidence, grounding_score=0.5, peer_confirmations=3
        )
        assert result_with.cognitive_score >= result_without.cognitive_score

    def test_grounding_score_bonus(self):
        validator = POCValidator()
        evidence = {
            "causal_chain": ["step1", "step2", "step3"],
            "context_references": ["ctx1"],
            "novelty_score": 0.4,
        }
        result_low = validator.validate("art-15a", evidence, grounding_score=0.3)
        result_high = validator.validate("art-15b", evidence, grounding_score=0.6)
        assert result_high.cognitive_score > result_low.cognitive_score

    def test_custom_min_score_threshold(self):
        strict = POCValidator(min_cognitive_score=0.8)
        evidence = {
            "causal_chain": ["step1", "step2"],
            "context_references": ["ctx1"],
            "novelty_score": 0.3,
        }
        result = strict.validate("art-16", evidence, grounding_score=0.4)
        assert not result.is_valid


# ---------------------------------------------------------------------------
# PayabilityGate tests
# ---------------------------------------------------------------------------

class TestPayabilityGate:

    def test_eligible_artifact_is_payable(self):
        gate = PayabilityGate()
        result = gate.evaluate(
            artifact_id="art-20",
            producer_node_id="node-1",
            cognitive_score=0.7,
            content_hash="hash-unique-1",
            is_producer_admitted=True,
        )
        assert result.is_payable
        assert result.to_status == CanxianArtifactStatus.PAYABLE
        assert result.settlement_weight == 0.7

    def test_unadmitted_producer_not_payable(self):
        gate = PayabilityGate()
        result = gate.evaluate(
            artifact_id="art-21",
            producer_node_id="node-2",
            cognitive_score=0.7,
            content_hash="hash-unique-2",
            is_producer_admitted=False,
        )
        assert not result.is_payable
        assert "producer_not_admitted_to_ahin" in result.rejection_reasons

    def test_blocked_producer_not_payable(self):
        gate = PayabilityGate()
        result = gate.evaluate(
            artifact_id="art-22",
            producer_node_id="node-3",
            cognitive_score=0.7,
            content_hash="hash-unique-3",
            is_producer_admitted=True,
            is_producer_blocked=True,
        )
        assert not result.is_payable
        assert "producer_blocked_by_policy" in result.rejection_reasons

    def test_low_score_not_payable(self):
        gate = PayabilityGate()
        result = gate.evaluate(
            artifact_id="art-23",
            producer_node_id="node-4",
            cognitive_score=0.1,
            content_hash="hash-unique-4",
            is_producer_admitted=True,
        )
        assert not result.is_payable

    def test_duplicate_content_not_payable(self):
        gate = PayabilityGate()
        # First submission is fine
        result1 = gate.evaluate(
            artifact_id="art-24a",
            producer_node_id="node-5",
            cognitive_score=0.7,
            content_hash="hash-dup-1",
            is_producer_admitted=True,
        )
        assert result1.is_payable

        # Same content hash is rejected
        result2 = gate.evaluate(
            artifact_id="art-24b",
            producer_node_id="node-5",
            cognitive_score=0.7,
            content_hash="hash-dup-1",
            is_producer_admitted=True,
        )
        assert not result2.is_payable
        assert "duplicate_content_hash" in result2.rejection_reasons

    def test_per_node_rate_limit(self):
        gate = PayabilityGate(max_payable_per_node=2)
        for i in range(2):
            result = gate.evaluate(
                artifact_id=f"art-25-{i}",
                producer_node_id="node-6",
                cognitive_score=0.7,
                content_hash=f"hash-rate-{i}",
                is_producer_admitted=True,
            )
            assert result.is_payable

        # Third should be rate-limited
        result3 = gate.evaluate(
            artifact_id="art-25-2",
            producer_node_id="node-6",
            cognitive_score=0.7,
            content_hash="hash-rate-2",
            is_producer_admitted=True,
        )
        assert not result3.is_payable

    def test_reset_cycle_clears_state(self):
        gate = PayabilityGate()
        gate.evaluate(
            artifact_id="art-26",
            producer_node_id="node-7",
            cognitive_score=0.7,
            content_hash="hash-cycle-1",
            is_producer_admitted=True,
        )
        gate.reset_cycle()

        # Same hash should now be allowed
        result = gate.evaluate(
            artifact_id="art-27",
            producer_node_id="node-7",
            cognitive_score=0.7,
            content_hash="hash-cycle-1",
            is_producer_admitted=True,
        )
        assert result.is_payable


# ---------------------------------------------------------------------------
# CanxianValidationPipeline tests (full pipeline)
# ---------------------------------------------------------------------------

class TestCanxianValidationPipeline:

    def _good_grounding_context(self):
        return {
            "context_references": ["sensor_001", "api_response_002"],
            "interaction_evidence": ["tool_use_event"],
            "operational_resistance": True,
        }

    def _good_causation_evidence(self):
        return {
            "causal_chain": ["premise", "inference", "conclusion", "verification"],
            "context_references": ["domain_knowledge_1", "empirical_data_2"],
            "novelty_score": 0.6,
            "confidence": 0.7,
        }

    def test_full_pipeline_success(self):
        pipeline = CanxianValidationPipeline()
        result = pipeline.run(
            artifact_id="pipe-1",
            grounding_context=self._good_grounding_context(),
            output_payload={"result": "meaningful"},
            causation_evidence=self._good_causation_evidence(),
            content_hash="unique-pipe-1",
            producer_node_id="node-A",
            is_producer_admitted=True,
        )
        assert result.final_status == CanxianArtifactStatus.PAYABLE
        assert result.halted_at_stage is None
        assert result.grounding is not None
        assert result.poc_validation is not None
        assert result.payability is not None
        assert len(result.stage_events) == 3

    def test_pipeline_halts_at_grounding(self):
        pipeline = CanxianValidationPipeline()
        result = pipeline.run(
            artifact_id="pipe-2",
            grounding_context={},  # Empty — no grounding
            output_payload={},
            causation_evidence=self._good_causation_evidence(),
            content_hash="unique-pipe-2",
            producer_node_id="node-B",
            is_producer_admitted=True,
        )
        assert result.final_status == CanxianArtifactStatus.RAW_OUTPUT
        assert result.halted_at_stage == "grounding"
        assert result.poc_validation is None
        assert result.payability is None

    def test_pipeline_halts_at_poc(self):
        pipeline = CanxianValidationPipeline()
        result = pipeline.run(
            artifact_id="pipe-3",
            grounding_context=self._good_grounding_context(),
            output_payload={},
            causation_evidence={
                "causal_chain": [],  # No causation
                "context_references": [],
                "confidence": 0.95,
            },
            content_hash="unique-pipe-3",
            producer_node_id="node-C",
            is_producer_admitted=True,
        )
        assert result.final_status == CanxianArtifactStatus.OPERATIONALLY_GROUNDED
        assert result.halted_at_stage == "poc_validation"
        assert result.poc_validation is not None
        assert result.poc_validation.is_zombie

    def test_pipeline_halts_at_payability(self):
        pipeline = CanxianValidationPipeline()
        result = pipeline.run(
            artifact_id="pipe-4",
            grounding_context=self._good_grounding_context(),
            output_payload={},
            causation_evidence=self._good_causation_evidence(),
            content_hash="unique-pipe-4",
            producer_node_id="node-D",
            is_producer_admitted=False,  # Not admitted
        )
        assert result.final_status == CanxianArtifactStatus.VALIDATED_CANXIAN
        assert result.halted_at_stage == "payability"

    def test_pipeline_with_peer_confirmations(self):
        pipeline = CanxianValidationPipeline()
        result = pipeline.run(
            artifact_id="pipe-5",
            grounding_context=self._good_grounding_context(),
            output_payload={},
            causation_evidence=self._good_causation_evidence(),
            content_hash="unique-pipe-5",
            producer_node_id="node-E",
            is_producer_admitted=True,
            peer_confirmations=2,
        )
        assert result.final_status == CanxianArtifactStatus.PAYABLE

    def test_pipeline_blocked_producer(self):
        pipeline = CanxianValidationPipeline()
        result = pipeline.run(
            artifact_id="pipe-6",
            grounding_context=self._good_grounding_context(),
            output_payload={},
            causation_evidence=self._good_causation_evidence(),
            content_hash="unique-pipe-6",
            producer_node_id="node-F",
            is_producer_admitted=True,
            is_producer_blocked=True,
        )
        assert result.final_status == CanxianArtifactStatus.VALIDATED_CANXIAN
        assert result.halted_at_stage == "payability"

    def test_pipeline_reset_cycle(self):
        pipeline = CanxianValidationPipeline()
        # First run
        pipeline.run(
            artifact_id="pipe-7a",
            grounding_context=self._good_grounding_context(),
            output_payload={},
            causation_evidence=self._good_causation_evidence(),
            content_hash="dup-hash-1",
            producer_node_id="node-G",
            is_producer_admitted=True,
        )
        # Second with same hash fails
        result_dup = pipeline.run(
            artifact_id="pipe-7b",
            grounding_context=self._good_grounding_context(),
            output_payload={},
            causation_evidence=self._good_causation_evidence(),
            content_hash="dup-hash-1",
            producer_node_id="node-G",
            is_producer_admitted=True,
        )
        assert result_dup.final_status == CanxianArtifactStatus.VALIDATED_CANXIAN

        # Reset and retry
        pipeline.reset_cycle()
        result_after = pipeline.run(
            artifact_id="pipe-7c",
            grounding_context=self._good_grounding_context(),
            output_payload={},
            causation_evidence=self._good_causation_evidence(),
            content_hash="dup-hash-1",
            producer_node_id="node-G",
            is_producer_admitted=True,
        )
        assert result_after.final_status == CanxianArtifactStatus.PAYABLE

    def test_stage_events_are_recorded(self):
        pipeline = CanxianValidationPipeline()
        result = pipeline.run(
            artifact_id="pipe-8",
            grounding_context=self._good_grounding_context(),
            output_payload={},
            causation_evidence=self._good_causation_evidence(),
            content_hash="unique-pipe-8",
            producer_node_id="node-H",
            is_producer_admitted=True,
        )
        stages = [e["stage"] for e in result.stage_events]
        assert stages == ["grounding", "poc_validation", "payability"]
