"""
packages/canxian_pipeline — Canxian Layer.

The Canxian Layer is the core epistemic engine of the Life++ Agent OS.
It manages the representation, validation, and status promotion of
cognitive output artifacts through four levels:

  1. RAW_OUTPUT      — mere model output (not yet Canxian)
  2. GROUNDED        — operationally anchored via Tactile Brain Hypothesis
  3. VALIDATED_CANXIAN — POC-confirmed cognitive objectification
  4. PAYABLE         — eligible for VirtueWellbeing settlement

This is NOT a generic data pipeline.
It is the structural answer to the core question:
  "How does the system distinguish genuine cognitive contribution
   from philosophical-zombie-like output?"
"""
from packages.canxian_pipeline.grounding_assessor import GroundingAssessor
from packages.canxian_pipeline.payability_gate import PayabilityGate
from packages.canxian_pipeline.canxian_validation_pipeline import (
    CanxianValidationPipeline,
)

__all__ = [
    "GroundingAssessor",
    "PayabilityGate",
    "CanxianValidationPipeline",
]
