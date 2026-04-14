"""
CognitiveInteractionHandler — processes local cognitive interactions at the edge.

This handler is where agent collaboration becomes operationally anchored:
  - User intention is captured in real context (DeviceContext)
  - Agent execution produces CanxianArtifacts with grounding
  - Interaction events are recorded in the AHIN trust graph
  - Every interaction contributes to Spontaneous Time Order

Per Life+ Objectification:
  Intelligence must externalize into durable action, record, and
  tool-mediated coordination.  Each interaction at this terminal IS
  a cognitive objectification event.
"""
from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Dict, List, Optional

from packages.ahin_network.ahin_node import AhinNode
from packages.ahin_network.local_time_sequencer import LocalTimeSequencer
from packages.shared.domain import (
    AssociationEventType,
    CanxianArtifactStatus,
    new_id,
    now_utc,
)
from packages.shared.events import AssociationEvent

from apps.edge_terminal.context import DeviceContextManager

logger = logging.getLogger(__name__)


class CognitiveInteractionHandler:
    """
    Processes local cognitive interactions at the edge terminal.

    Responsibilities:
      1. Wrap user intention into a CognitiveTask-like structure
      2. Attach grounding context from DeviceContextManager
      3. Produce artifact metadata with grounding status
      4. Record AHIN association events for agent participation
      5. Maintain an interaction log for POC evidence
    """

    def __init__(
        self,
        terminal_id: str,
        context_manager: DeviceContextManager,
        sequencer: LocalTimeSequencer,
        ahin_node: AhinNode,
    ) -> None:
        self._terminal_id = terminal_id
        self._context_manager = context_manager
        self._sequencer = sequencer
        self._ahin_node = ahin_node
        self._interaction_log: List[Dict[str, Any]] = []
        logger.info(
            "CognitiveInteractionHandler initialised",
            extra={"terminal_id": terminal_id},
        )

    def handle_cognitive_interaction(
        self,
        intent_description: str,
        input_payload: Dict[str, Any],
        agent_node_id: Optional[str] = None,
        artifact_content: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Process a local cognitive interaction and produce an objectification record.

        This is the core Tactile Brain cycle:
          intention → operational interaction → grounded artifact → durable record

        Args:
            intent_description: Natural-language description of user intent
            input_payload: Structured input data for the interaction
            agent_node_id: If an agent participated, its AHIN node ID
            artifact_content: Optional content produced by the interaction

        Returns:
            An interaction record suitable for POC evidence.
        """
        grounding = self._context_manager.to_grounding_dict()
        time_order = self._sequencer.next(
            interaction_type="cognitive_interaction",
            payload=input_payload,
        )

        artifact_id = new_id()
        content_for_hash = artifact_content or json.dumps(input_payload, sort_keys=True)
        content_hash = hashlib.sha256(content_for_hash.encode()).hexdigest()

        # Determine grounding status
        is_grounded = self._context_manager.has_grounding and bool(grounding)
        artifact_status = (
            CanxianArtifactStatus.OPERATIONALLY_GROUNDED.value
            if is_grounded
            else CanxianArtifactStatus.RAW_OUTPUT.value
        )

        record = {
            "interaction_id": new_id(),
            "artifact_id": artifact_id,
            "terminal_id": self._terminal_id,
            "intent_description": intent_description,
            "input_payload": input_payload,
            "artifact_status": artifact_status,
            "content_hash": content_hash,
            "grounding_context": grounding,
            "agent_node_id": agent_node_id,
            "spontaneous_time_order": time_order.model_dump(),
            "created_at": now_utc().isoformat(),
        }

        self._interaction_log.append(record)

        logger.info(
            "Cognitive interaction processed",
            extra={
                "interaction_id": record["interaction_id"],
                "artifact_id": artifact_id,
                "is_grounded": is_grounded,
                "agent": agent_node_id,
            },
        )
        return record

    def record_association_event(
        self,
        responder_node_id: str,
        event_type: AssociationEventType,
        task_id: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
    ) -> Optional[AssociationEvent]:
        """
        Record an AHIN association event from this terminal.

        Proactive: terminal initiates collaboration with a peer node.
        Acceptance: terminal confirms a collaboration request from a peer.

        Returns the AssociationEvent, or None if the terminal is not
        admitted to AHIN.
        """
        if not self._ahin_node.is_admitted:
            logger.warning(
                "Cannot record association — terminal not admitted to AHIN",
                extra={"terminal_id": self._terminal_id},
            )
            return None

        if event_type == AssociationEventType.PROACTIVE:
            event = self._ahin_node.propose_association(
                responder_node_id=responder_node_id,
                task_id=task_id,
                payload=payload,
            )
        elif event_type == AssociationEventType.ACCEPTANCE:
            # For acceptance, we need a synthetic proactive event reference.
            # In practice, the proactive event would be passed in.
            # Here we create a minimal acceptance event.
            time_order = self._sequencer.next(
                interaction_type=AssociationEventType.ACCEPTANCE,
                initiator_node_id=self._terminal_id,
                responder_node_id=responder_node_id,
                payload=payload or {},
            )
            from packages.ahin_network.interaction_hasher import InteractionHasher

            chained_hash = InteractionHasher.hash_interaction(
                predecessor_hash=self._sequencer.last_hash,
                initiator_node_id=self._terminal_id,
                responder_node_id=responder_node_id,
                interaction_type=AssociationEventType.ACCEPTANCE,
                payload=payload or {},
            )
            event = AssociationEvent(
                association_type=AssociationEventType.ACCEPTANCE,
                initiator_node_id=self._terminal_id,
                responder_node_id=responder_node_id,
                task_id=task_id,
                interaction_hash=chained_hash,
                time_order=time_order,
                payload=payload or {},
            )
        else:
            logger.warning(
                "Unsupported association event type at edge",
                extra={"event_type": event_type},
            )
            return None

        logger.info(
            "Association event recorded at edge",
            extra={
                "event_id": event.event_id,
                "type": event_type,
                "responder": responder_node_id,
            },
        )
        return event

    @property
    def interaction_log(self) -> List[Dict[str, Any]]:
        """Return the full interaction log for audit / POC evidence."""
        return list(self._interaction_log)

    @property
    def interaction_count(self) -> int:
        return len(self._interaction_log)
