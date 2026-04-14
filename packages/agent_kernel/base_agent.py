"""
BaseAgent — the fundamental cognitive-economic actor in Life++.

Every agent is:
  1. An identity node in AHIN
  2. A capability holder registered in the CapabilityRegistry
  3. A value-flow participant with a Cognitive Value Ledger account
  4. A producer of CanxianArtifacts (NOT generic outputs)

An agent is NOT a simple function caller.
It is an actor that externalises intelligence into durable artifacts
(Life+ Objectification) and participates in trust formation.
"""
from __future__ import annotations

import abc
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from packages.shared.domain import (
    DigitalAvatarNode,
    NodeType,
    SpontaneousTimeOrder,
    new_id,
    now_utc,
)

logger = logging.getLogger(__name__)


class BaseAgent(abc.ABC):
    """
    Abstract base for all Life++ cognitive-economic agents.

    Concrete agents must implement:
      - execute_cognitive_task: produce a CanxianArtifact from a CognitiveTask
      - get_capabilities: declare what this agent can do
      - verify_causation: demonstrate causal grounding (anti-zombie check)
    """

    def __init__(
        self,
        node_id: Optional[str] = None,
        node_type: NodeType = NodeType.MACHINE_AGENT,
        display_name: Optional[str] = None,
        public_key: Optional[str] = None,
    ) -> None:
        self.node_id: str = node_id or new_id()
        self.node_type: NodeType = node_type
        self.display_name: str = display_name or f"agent-{self.node_id[:8]}"
        self.public_key: Optional[str] = public_key
        self._local_sequence: int = 0
        self._last_interaction_hash: Optional[str] = None
        logger.info(
            "BaseAgent initialised",
            extra={"node_id": self.node_id, "node_type": self.node_type},
        )

    # ------------------------------------------------------------------
    # Identity
    # ------------------------------------------------------------------

    def to_digital_avatar_node(self) -> DigitalAvatarNode:
        """Return the AHIN identity representation of this agent."""
        return DigitalAvatarNode(
            node_id=self.node_id,
            node_type=self.node_type,
            display_name=self.display_name,
            public_key=self.public_key,
        )

    def next_time_order(self) -> SpontaneousTimeOrder:
        """
        Produce the next SpontaneousTimeOrder for this agent.

        This is the local-sequence-based time ordering per AHIN theory.
        It does NOT rely on a centralised timestamp authority.
        """
        self._local_sequence += 1
        return SpontaneousTimeOrder(
            local_sequence=self._local_sequence,
            node_id=self.node_id,
            interaction_hash=self._last_interaction_hash,
        )

    # ------------------------------------------------------------------
    # Abstract interface
    # ------------------------------------------------------------------

    @abc.abstractmethod
    async def execute_cognitive_task(
        self, task_id: str, input_payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Process a CognitiveTask and return artifact content.

        The returned dict is the raw content that will be wrapped into
        a CanxianArtifact by the ExecutionSupervisor.

        Implementations MUST:
          - Ground their output in the input context (Tactile Brain Hypothesis)
          - Include causal reasoning, not just statistical correlation
          - Not fabricate context not present in input_payload
        """

    @abc.abstractmethod
    def get_capabilities(self) -> List[str]:
        """
        Return the list of capability identifiers this agent supports.

        Used by CapabilityRegistry to route CognitiveTasks.
        """

    @abc.abstractmethod
    async def verify_causation(
        self, input_payload: Dict[str, Any], output: Dict[str, Any]
    ) -> bool:
        """
        Causation Re-engineering of Intelligence check.

        Returns True if the output is causally grounded in the input
        (genuine intelligence), False if it is mere probabilistic inference
        (philosophical-zombie-like output).

        This is the primary anti-zombie heuristic hook.
        Implementations may call external validators, LLM judges, or
        formal verification tools.
        """

    # ------------------------------------------------------------------
    # Lifecycle hooks (optional overrides)
    # ------------------------------------------------------------------

    async def on_task_received(self, task_id: str, payload: Dict[str, Any]) -> None:
        """Called before execute_cognitive_task. Override for pre-processing."""
        logger.debug("Task received", extra={"task_id": task_id, "node_id": self.node_id})

    async def on_artifact_produced(self, artifact_id: str) -> None:
        """Called after a CanxianArtifact is stored. Override for post-processing."""
        logger.debug(
            "Artifact produced", extra={"artifact_id": artifact_id, "node_id": self.node_id}
        )

    async def on_admission_confirmed(self, stake_lifepp: float) -> None:
        """Called when AHIN admission stake is confirmed."""
        logger.info(
            "AHIN admission confirmed",
            extra={"node_id": self.node_id, "stake_lifepp": stake_lifepp},
        )
