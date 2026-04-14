"""
CognitiveInteractionHandler — captures local contextual interaction at the edge.

Per Tactile Brain Hypothesis:
  Cognition must be grounded in resistance, context, and operational interaction.
  Every interaction at the edge terminal is a potential cognitive objectification event.

Per Life+ Objectification:
  Intelligence must externalize into durable action, record, and tool-mediated coordination.
  The handler captures user intention and produces a grounding_context that anchors
  the interaction in real operational reality.

This handler is NOT a generic request processor.
It is the embodiment interface where user intention becomes operationally grounded.
"""
from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Dict, List, Optional

from packages.ahin_network.local_time_sequencer import LocalTimeSequencer
from packages.shared.domain import CanxianArtifactStatus, new_id, now_utc

logger = logging.getLogger(__name__)


class CognitiveInteractionHandler:
    """
    Handles local contextual interactions at the Life++ Lite Edge Terminal.

    Responsibilities:
      1. Capture user intention with operational grounding_context
      2. Classify interactions as cognitive objectification events
      3. Produce grounding evidence for POC validation
      4. Anchor interactions to the terminal's Spontaneous Time Order
      5. Distinguish grounded cognitive events from ungrounded pass-through
    """

    def __init__(
        self,
        terminal_node_id: str,
        sequencer: LocalTimeSequencer,
    ) -> None:
        self._terminal_id = terminal_node_id
        self._sequencer = sequencer
        self._interaction_log: List[Dict[str, Any]] = []

    def capture_interaction(
        self,
        interaction_type: str,
        user_intent: Dict[str, Any],
        device_context: Optional[Dict[str, Any]] = None,
        agent_node_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Capture a local contextual interaction at this edge terminal.

        This is the core cognitive objectification entry point:
          user intention → grounding_context → durable interaction record.

        Args:
            interaction_type: Classification of the interaction (e.g.
                'purchase', 'query', 'agent_request', 'service_activation').
            user_intent: The user's expressed intention (payload).
            device_context: Physical/operational context from the device
                (location, modality, resistance signals).
            agent_node_ids: IDs of agents collaborating on this interaction.

        Returns:
            A cognitive interaction record with grounding_context and
            Spontaneous Time Order.
        """
        time_order = self._sequencer.next(
            interaction_type=interaction_type,
            payload=user_intent,
        )

        grounding_context = self._build_grounding_context(
            interaction_type=interaction_type,
            user_intent=user_intent,
            device_context=device_context or {},
            agent_node_ids=agent_node_ids or [],
        )

        interaction_record = {
            "interaction_id": new_id(),
            "terminal_node_id": self._terminal_id,
            "interaction_type": interaction_type,
            "user_intent": user_intent,
            "grounding_context": grounding_context,
            "artifact_status": self._classify_grounding(grounding_context),
            "agent_node_ids": agent_node_ids or [],
            "spontaneous_time_order": time_order.model_dump(),
            "created_at": now_utc().isoformat(),
        }

        # Compute content hash for tamper evidence
        content = json.dumps(
            {k: v for k, v in interaction_record.items() if k != "interaction_id"},
            sort_keys=True,
            default=str,
        )
        interaction_record["content_hash"] = hashlib.sha256(
            content.encode()
        ).hexdigest()

        self._interaction_log.append(interaction_record)

        logger.info(
            "Cognitive interaction captured",
            extra={
                "interaction_id": interaction_record["interaction_id"],
                "type": interaction_type,
                "is_grounded": interaction_record["artifact_status"] != CanxianArtifactStatus.RAW_OUTPUT.value,
                "terminal": self._terminal_id,
            },
        )
        return interaction_record

    def get_interaction_log(self) -> List[Dict[str, Any]]:
        """Return the full interaction log for this terminal session."""
        return list(self._interaction_log)

    @property
    def interaction_count(self) -> int:
        return len(self._interaction_log)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    @staticmethod
    def _build_grounding_context(
        interaction_type: str,
        user_intent: Dict[str, Any],
        device_context: Dict[str, Any],
        agent_node_ids: List[str],
    ) -> Dict[str, Any]:
        """
        Build the grounding_context dict that anchors a cognitive event.

        Per Tactile Brain Hypothesis, a grounded interaction requires:
          - Operational context (device, location, modality)
          - User interaction evidence (intent is non-empty)
          - Resistance signal (the real-world constraint the agent faces)

        An empty grounding_context means RAW_OUTPUT (ungrounded).
        """
        context: Dict[str, Any] = {}

        if device_context:
            context["device"] = device_context

        if user_intent:
            context["user_interaction"] = {
                "has_explicit_intent": True,
                "intent_type": interaction_type,
                "intent_field_count": len(user_intent),
            }

        if agent_node_ids:
            context["agent_collaboration"] = {
                "participating_agents": agent_node_ids,
                "collaboration_count": len(agent_node_ids),
            }

        context["timestamp_utc"] = now_utc().isoformat()

        return context

    @staticmethod
    def _classify_grounding(grounding_context: Dict[str, Any]) -> str:
        """
        Classify an interaction's grounding level.

        Per the four-level CanxianArtifact lifecycle:
          - Empty or trivial context → RAW_OUTPUT
          - Non-empty context with device or user interaction → OPERATIONALLY_GROUNDED
        """
        has_device = bool(grounding_context.get("device"))
        has_user = bool(grounding_context.get("user_interaction"))

        if has_device or has_user:
            return CanxianArtifactStatus.OPERATIONALLY_GROUNDED.value
        return CanxianArtifactStatus.RAW_OUTPUT.value
