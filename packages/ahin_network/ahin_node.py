"""
AhinNode — a participant node in the Active Hashed Interaction Network.

An AhinNode encapsulates:
  - Local identity and Solana key binding
  - A LocalTimeSequencer for Spontaneous Time Order
  - The admission stake and AHIN membership status
  - Methods for emitting Proactive and Acceptance Association events
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from packages.ahin_network.interaction_hasher import InteractionHasher
from packages.ahin_network.local_time_sequencer import LocalTimeSequencer
from packages.shared.domain import AssociationEventType, NodeType, new_id
from packages.shared.events import AssociationEvent

logger = logging.getLogger(__name__)


class AhinNode:
    """
    An active participant in the AHIN network.

    Each node maintains its own interaction chain (Spontaneous Time Order)
    and can initiate or accept associations with other nodes.
    """

    def __init__(
        self,
        node_id: Optional[str] = None,
        node_type: NodeType = NodeType.MACHINE_AGENT,
        public_key: Optional[str] = None,
    ) -> None:
        self.node_id: str = node_id or new_id()
        self.node_type: NodeType = node_type
        self.public_key: Optional[str] = public_key
        self.is_admitted: bool = False
        self.admission_stake_lifepp: float = 0.0
        self._sequencer = LocalTimeSequencer(self.node_id)
        logger.info("AhinNode created", extra={"node_id": self.node_id})

    # ------------------------------------------------------------------
    # Association events
    # ------------------------------------------------------------------

    def propose_association(
        self,
        responder_node_id: str,
        task_id: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
    ) -> AssociationEvent:
        """
        Emit a Proactive Association event toward another node.

        This is the AHIN equivalent of initiating a collaboration —
        NOT sending a generic message.
        """
        if not self.is_admitted:
            raise PermissionError(
                f"Node {self.node_id} is not admitted to AHIN — cannot associate"
            )

        time_order = self._sequencer.next(
            interaction_type=AssociationEventType.PROACTIVE,
            initiator_node_id=self.node_id,
            responder_node_id=responder_node_id,
            payload=payload or {},
        )

        event = AssociationEvent(
            association_type=AssociationEventType.PROACTIVE,
            initiator_node_id=self.node_id,
            responder_node_id=responder_node_id,
            task_id=task_id,
            interaction_hash=time_order.interaction_hash or "",
            time_order=time_order,
            payload=payload or {},
        )
        logger.info(
            "Proactive association proposed",
            extra={
                "initiator": self.node_id,
                "responder": responder_node_id,
                "event_id": event.event_id,
            },
        )
        return event

    def accept_association(
        self,
        proactive_event: AssociationEvent,
        payload: Optional[Dict[str, Any]] = None,
    ) -> AssociationEvent:
        """
        Emit an Acceptance of Association event in response to a proactive one.

        This closes the collaboration loop and reinforces the trust link.
        """
        if not self.is_admitted:
            raise PermissionError(
                f"Node {self.node_id} is not admitted to AHIN — cannot accept association"
            )

        time_order = self._sequencer.next(
            interaction_type=AssociationEventType.ACCEPTANCE,
            initiator_node_id=self.node_id,
            responder_node_id=proactive_event.initiator_node_id,
            payload=payload or {},
        )

        # Chain to the proactive event's hash
        chained_hash = InteractionHasher.hash_interaction(
            predecessor_hash=proactive_event.interaction_hash,
            initiator_node_id=self.node_id,
            responder_node_id=proactive_event.initiator_node_id,
            interaction_type=AssociationEventType.ACCEPTANCE,
            payload=payload or {},
        )

        event = AssociationEvent(
            association_type=AssociationEventType.ACCEPTANCE,
            initiator_node_id=self.node_id,
            responder_node_id=proactive_event.initiator_node_id,
            task_id=proactive_event.task_id,
            interaction_hash=chained_hash,
            time_order=time_order,
            payload=payload or {},
        )
        logger.info(
            "Acceptance of association emitted",
            extra={
                "acceptor": self.node_id,
                "initiator": proactive_event.initiator_node_id,
                "event_id": event.event_id,
            },
        )
        return event

    def set_admitted(self, stake_lifepp: float) -> None:
        """Mark this node as admitted to AHIN with the given stake."""
        self.is_admitted = True
        self.admission_stake_lifepp = stake_lifepp
        logger.info(
            "Node admitted to AHIN",
            extra={"node_id": self.node_id, "stake_lifepp": stake_lifepp},
        )
