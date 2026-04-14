"""
packages/canxian_pipeline — Canxian Validation Pipeline.

The 4-stage cognitive output classification pipeline:
  RAW_OUTPUT → GROUNDED → VALIDATED_CANXIAN → PAYABLE

Each stage corresponds to a theory-grounded gating function:
  1. GroundingAssessor  — Tactile Brain Hypothesis check
  2. POCValidator       — Proof of Cognitive Canxian (zombie detection)
  3. PayabilityGate     — VirtueWellbeing settlement eligibility

This is NOT a generic ML scoring pipeline.
It is the epistemic progression from mere model output to economically
meaningful, ethically aligned cognitive objectification.
"""
from packages.canxian_pipeline.grounding_assessor import GroundingAssessor
from packages.canxian_pipeline.poc_validator import POCValidator
from packages.canxian_pipeline.payability_gate import PayabilityGate
from packages.canxian_pipeline.canxian_validation_pipeline import (
    CanxianValidationPipeline,
)

__all__ = [
    "GroundingAssessor",
    "POCValidator",
    "PayabilityGate",
    "CanxianValidationPipeline",
]
