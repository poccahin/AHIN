"""AHIN network router — trust weights, association graph queries."""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter

router = APIRouter()


@router.get("/{node_id}/trust-weights")
async def get_trust_weights(node_id: str) -> Dict[str, Any]:
    """
    Return the directional trust weights from a node to its neighbours.

    Trust is emergent from directional AHIN interactions —
    it is NOT a centralised reputation score.
    """
    # TODO: query AssociationGraph
    return {
        "node_id": node_id,
        "trust_weights": {},
        "message": "TODO: integrate AssociationGraph",
    }


@router.get("/{node_id}/neighbours")
async def get_neighbours(node_id: str, min_trust: float = 0.3) -> Dict[str, Any]:
    """Return trusted neighbours (Continuous Spectrum Topology)."""
    # TODO: query AssociationGraph.get_trusted_neighbours()
    return {
        "node_id": node_id,
        "min_trust": min_trust,
        "neighbours": {},
        "message": "TODO: integrate AssociationGraph",
    }
