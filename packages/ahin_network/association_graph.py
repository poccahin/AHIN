"""
AssociationGraph — the AHIN interaction graph.

The AssociationGraph is the runtime representation of all AHIN interactions.
It is NOT a social graph.
It is a directional trust graph built from AssociationEvent records.

Key properties:
  - Directional edges (A→B trust ≠ B→A trust)
  - No global consensus needed — each node maintains its local view
  - Continuous Spectrum Topology: nodes are connected across a spectrum
    of trust intensities, not binary on/off
"""
from __future__ import annotations

import logging
from collections import defaultdict
from typing import Dict, List, Optional, Set, Tuple

from packages.ahin_network.trust_weight_model import TrustWeightModel
from packages.shared.domain import AssociationEventType
from packages.shared.events import AssociationEvent

logger = logging.getLogger(__name__)


class AssociationGraph:
    """
    Runtime directional interaction graph for AHIN.

    Implements Continuous Spectrum Topology:
      Each edge carries a trust weight in [0, 1] rather than boolean membership.
    """

    def __init__(self, trust_model: Optional[TrustWeightModel] = None) -> None:
        self._trust_model = trust_model or TrustWeightModel()
        # Adjacency: {from_node: {to_node: [AssociationEvent]}}
        self._edges: Dict[str, Dict[str, List[AssociationEvent]]] = defaultdict(
            lambda: defaultdict(list)
        )
        self._all_events: List[AssociationEvent] = []

    def record_event(self, event: AssociationEvent) -> None:
        """
        Record an AssociationEvent into the graph and update trust.

        Proactive: creates or reinforces a directed edge.
        Acceptance: closes the loop and adds a positive trust delta.
        Dissolution: records a negative trust event.
        """
        initiator = event.initiator_node_id
        responder = event.responder_node_id

        if responder:
            self._edges[initiator][responder].append(event)

        self._all_events.append(event)

        # Update trust weight
        delta = event.trust_delta
        if event.association_type == AssociationEventType.PROACTIVE:
            delta = delta or 0.05  # Initiation earns small trust
        elif event.association_type == AssociationEventType.ACCEPTANCE:
            delta = delta or 0.1   # Acceptance earns more
        elif event.association_type == AssociationEventType.DISSOLUTION:
            delta = -(abs(delta) or 0.05)

        if responder:
            self._trust_model.record_interaction(initiator, responder, delta)

        logger.debug(
            "AssociationEvent recorded",
            extra={
                "type": event.association_type,
                "initiator": initiator,
                "responder": responder,
                "trust_delta": delta,
            },
        )

    def get_trust_weight(self, from_node: str, to_node: str) -> float:
        """Return the directional trust weight from one node to another."""
        return self._trust_model.get_trust_weight(from_node, to_node)

    def get_neighbours(self, node_id: str) -> Set[str]:
        """Return the set of nodes that node_id has interacted with."""
        return set(self._edges.get(node_id, {}).keys())

    def get_interaction_history(
        self, from_node: str, to_node: str
    ) -> List[AssociationEvent]:
        """Return the ordered history of interactions from from_node to to_node."""
        return self._edges.get(from_node, {}).get(to_node, [])

    def get_trusted_neighbours(
        self, node_id: str, min_trust: float = 0.3
    ) -> Dict[str, float]:
        """Return neighbours above a trust threshold — Continuous Spectrum Topology."""
        result = {}
        for neighbour in self.get_neighbours(node_id):
            w = self.get_trust_weight(node_id, neighbour)
            if w >= min_trust:
                result[neighbour] = w
        return result

    def all_node_ids(self) -> Set[str]:
        """Return all node IDs that appear in the graph."""
        ids: Set[str] = set()
        for f, targets in self._edges.items():
            ids.add(f)
            ids.update(targets.keys())
        return ids
