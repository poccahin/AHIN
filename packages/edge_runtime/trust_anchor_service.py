"""
TrustAnchorService — AHIN trust-anchored interaction events at the edge.

Per AHIN theory:
  Local directional interactions become trust anchors.
  Coordination must NOT rely solely on global consensus.
  Important collaborative actions must be representable as proactive
  association and acceptance of association events.

Per Spontaneous Time Order:
  Temporal ordering is modeled through interaction-derived sequencing,
  not a centralized timestamp authority.

This service generates AHIN AssociationEvents at the edge terminal,
anchoring each interaction in the directional trust graph.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from packages.ahin_network.ahin_node import AhinNode
from packages.ahin_network.association_graph import AssociationGraph
from packages.ahin_network.interaction_hasher import InteractionHasher
from packages.ahin_network.local_time_sequencer import LocalTimeSequencer
from packages.shared.domain import AssociationEventType, new_id
from packages.shared.events import AssociationEvent

logger = logging.getLogger(__name__)


class TrustAnchorService:
    """
    Generates and records trust-anchored interaction events at the edge terminal.

    Every meaningful edge interaction can produce:
      1. A Proactive Association event (terminal initiates toward collaborator)
      2. An Acceptance of Association event (collaborator confirms participation)
      3. Trust weight updates in the local association graph

    These events are hash-chained for Spontaneous Time Order integrity
    and do NOT require global consensus for validity.
    """

    def __init__(
        self,
        terminal_node_id: str,
        ahin_node: AhinNode,
        sequencer: LocalTimeSequencer,
        association_graph: Optional[AssociationGraph] = None,
    ) -> None:
        self._terminal_id = terminal_node_id
        self._ahin_node = ahin_node
        self._sequencer = sequencer
        self._graph = association_graph or AssociationGraph()
        self._anchor_log: List[Dict[str, Any]] = []

    def anchor_interaction(
        self,
        responder_node_id: str,
        interaction_context: Dict[str, Any],
        trust_delta: float = 0.05,
        task_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Create a trust-anchored interaction event at this edge terminal.

        This produces a Proactive Association event from the terminal toward
        the responder node, anchoring the interaction in the AHIN trust graph.

        Args:
            responder_node_id: The node being interacted with (customer,
                merchant, or collaborating agent).
            interaction_context: Context payload for the association.
            trust_delta: Trust weight adjustment (positive = reinforcing).
            task_id: Optional CognitiveTask associated with this interaction.

        Returns:
            An anchor record with the AssociationEvent details and
            interaction hash for chain verification.
        """
        if not self._ahin_node.is_admitted:
            logger.warning(
                "Terminal not admitted to AHIN — trust anchoring degraded",
                extra={"terminal": self._terminal_id},
            )
            return self._create_unadmitted_anchor(
                responder_node_id, interaction_context
            )

        event = self._ahin_node.propose_association(
            responder_node_id=responder_node_id,
            task_id=task_id,
            payload=interaction_context,
        )
        # Override trust_delta with the caller's specification
        event.trust_delta = trust_delta

        self._graph.record_event(event)

        anchor_record = {
            "anchor_id": new_id(),
            "event_id": event.event_id,
            "association_type": event.association_type,
            "initiator_node_id": event.initiator_node_id,
            "responder_node_id": responder_node_id,
            "interaction_hash": event.interaction_hash,
            "trust_delta": trust_delta,
            "task_id": task_id,
            "current_trust_weight": self._graph.get_trust_weight(
                self._terminal_id, responder_node_id
            ),
        }
        self._anchor_log.append(anchor_record)

        logger.info(
            "Trust-anchored interaction recorded",
            extra={
                "anchor_id": anchor_record["anchor_id"],
                "responder": responder_node_id,
                "trust_delta": trust_delta,
                "current_trust": anchor_record["current_trust_weight"],
            },
        )
        return anchor_record

    def accept_remote_association(
        self,
        proactive_event: AssociationEvent,
        payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Accept an incoming association from a remote node.

        This completes the bidirectional trust anchoring:
        the edge terminal acknowledges the remote node's collaboration.

        Returns:
            An anchor record for the Acceptance event.
        """
        if not self._ahin_node.is_admitted:
            raise PermissionError(
                f"Terminal {self._terminal_id} not admitted to AHIN"
            )

        event = self._ahin_node.accept_association(
            proactive_event=proactive_event,
            payload=payload,
        )
        self._graph.record_event(event)

        anchor_record = {
            "anchor_id": new_id(),
            "event_id": event.event_id,
            "association_type": event.association_type,
            "initiator_node_id": event.initiator_node_id,
            "responder_node_id": proactive_event.initiator_node_id,
            "interaction_hash": event.interaction_hash,
            "trust_delta": event.trust_delta,
        }
        self._anchor_log.append(anchor_record)

        logger.info(
            "Acceptance of association recorded at edge",
            extra={
                "anchor_id": anchor_record["anchor_id"],
                "from_node": proactive_event.initiator_node_id,
            },
        )
        return anchor_record

    def get_trust_weight(self, to_node_id: str) -> float:
        """Return the current directional trust weight from this terminal to a node."""
        return self._graph.get_trust_weight(self._terminal_id, to_node_id)

    def get_anchor_log(self) -> List[Dict[str, Any]]:
        """Return the full trust anchor log for audit."""
        return list(self._anchor_log)

    @property
    def anchor_count(self) -> int:
        return len(self._anchor_log)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _create_unadmitted_anchor(
        self,
        responder_node_id: str,
        interaction_context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Create a degraded anchor record when the terminal is not admitted.

        The interaction is still logged for future reconciliation,
        but no trust delta is applied.
        """
        time_order = self._sequencer.next(
            interaction_type="unadmitted_anchor",
            payload=interaction_context,
        )
        anchor_record = {
            "anchor_id": new_id(),
            "event_id": None,
            "association_type": "unadmitted_anchor",
            "initiator_node_id": self._terminal_id,
            "responder_node_id": responder_node_id,
            "interaction_hash": time_order.interaction_hash,
            "trust_delta": 0.0,
            "current_trust_weight": 0.0,
            "is_degraded": True,
        }
        self._anchor_log.append(anchor_record)
        return anchor_record
