"""
GroundingAssessor — Tactile Brain Hypothesis grounding check.

Determines whether a cognitive output is operationally grounded in real
context and resistance, or is merely a statistical artefact with no
embodied anchor.

This is the gate from RAW_OUTPUT → OPERATIONALLY_GROUNDED.

Grounding criteria (all configurable):
  1. Non-empty grounding_context (physical/operational context dict)
  2. At least one context reference linking output to real-world input
  3. Presence of causal chain entries (not just probability scores)

An output that fails grounding assessment remains RAW_OUTPUT and is
NOT eligible for POC validation or settlement.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

# Minimum number of context references for grounding
_MIN_CONTEXT_REFS = 1

# Minimum number of causal chain steps
_MIN_CAUSAL_STEPS = 1


class GroundingAssessor:
    """
    Assesses whether a cognitive output artifact is operationally grounded.

    Implements the Tactile Brain Hypothesis check: cognition must be
    anchored in real interaction and resistance, not floating in abstract
    statistical space.
    """

    def __init__(
        self,
        min_context_refs: int = _MIN_CONTEXT_REFS,
        min_causal_steps: int = _MIN_CAUSAL_STEPS,
    ) -> None:
        self._min_context_refs = min_context_refs
        self._min_causal_steps = min_causal_steps

    def assess(
        self,
        output: Dict[str, Any],
        grounding_context: Dict[str, Any],
    ) -> "GroundingResult":
        """
        Assess whether *output* is operationally grounded.

        Parameters
        ----------
        output:
            The raw artifact content produced by an agent.
        grounding_context:
            Operational context from the edge terminal, user device, or
            input payload that anchors the output.

        Returns
        -------
        GroundingResult with ``is_grounded``, individual check outcomes,
        and a human-readable explanation.
        """
        has_context = bool(grounding_context)
        context_refs: List[str] = output.get("context_references", [])
        has_refs = len(context_refs) >= self._min_context_refs
        causal_chain: List[str] = output.get("causal_chain", [])
        has_causation = len(causal_chain) >= self._min_causal_steps

        is_grounded = has_context and has_refs and has_causation

        reasons: List[str] = []
        if not has_context:
            reasons.append("grounding_context is empty")
        if not has_refs:
            reasons.append(
                f"insufficient context_references "
                f"({len(context_refs)}<{self._min_context_refs})"
            )
        if not has_causation:
            reasons.append(
                f"insufficient causal_chain steps "
                f"({len(causal_chain)}<{self._min_causal_steps})"
            )

        result = GroundingResult(
            is_grounded=is_grounded,
            has_context=has_context,
            has_sufficient_refs=has_refs,
            has_causation=has_causation,
            context_ref_count=len(context_refs),
            causal_step_count=len(causal_chain),
            reasons=reasons,
        )

        if is_grounded:
            logger.info(
                "Grounding assessment PASSED",
                extra={
                    "context_refs": len(context_refs),
                    "causal_steps": len(causal_chain),
                },
            )
        else:
            logger.info(
                "Grounding assessment FAILED — output remains RAW_OUTPUT",
                extra={"reasons": reasons},
            )

        return result


class GroundingResult:
    """Outcome of a grounding assessment."""

    __slots__ = (
        "is_grounded",
        "has_context",
        "has_sufficient_refs",
        "has_causation",
        "context_ref_count",
        "causal_step_count",
        "reasons",
    )

    def __init__(
        self,
        *,
        is_grounded: bool,
        has_context: bool,
        has_sufficient_refs: bool,
        has_causation: bool,
        context_ref_count: int,
        causal_step_count: int,
        reasons: List[str],
    ) -> None:
        self.is_grounded = is_grounded
        self.has_context = has_context
        self.has_sufficient_refs = has_sufficient_refs
        self.has_causation = has_causation
        self.context_ref_count = context_ref_count
        self.causal_step_count = causal_step_count
        self.reasons = reasons

    def to_dict(self) -> Dict[str, Any]:
        return {
            "is_grounded": self.is_grounded,
            "has_context": self.has_context,
            "has_sufficient_refs": self.has_sufficient_refs,
            "has_causation": self.has_causation,
            "context_ref_count": self.context_ref_count,
            "causal_step_count": self.causal_step_count,
            "reasons": self.reasons,
        }
