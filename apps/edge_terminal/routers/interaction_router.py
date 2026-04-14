"""
Interaction router — records cognitive interactions at the edge terminal.

Handles:
  - Proactive association proposals
  - Acceptance of association responses
  - Local cognitive interaction recording
  - Interaction hash chaining
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from packages.shared.domain import AssociationEventType, new_id

router = APIRouter()


class InteractionRequest(BaseModel):
    """Request to record a cognitive interaction at this terminal."""

    initiator_node_id: str
    responder_node_id: Optional[str] = None
    interaction_type: str = "proactive_association"
    task_id: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)


class InteractionResponse(BaseModel):
    """Response from recording an interaction."""

    event_id: str
    interaction_hash: str
    local_sequence: int
    interaction_type: str


@router.post("/record", response_model=InteractionResponse)
async def record_interaction(body: InteractionRequest, request: Request):
    """
    Record a cognitive interaction at this edge terminal.

    Generates a locally-sequenced, hash-chained interaction record
    implementing Spontaneous Time Order.
    """
    ahin_node = request.app.state.ahin_node
    audit_log = request.app.state.audit_log

    if body.interaction_type == AssociationEventType.PROACTIVE.value:
        event = ahin_node.propose_association(
            responder_node_id=body.responder_node_id or "",
            task_id=body.task_id or new_id(),
            payload=body.payload,
        )
    else:
        event = {
            "event_id": new_id(),
            "interaction_hash": "local:" + new_id()[:16],
            "local_sequence": 0,
            "interaction_type": body.interaction_type,
        }

    audit_log.append("interaction_recorded", {
        "initiator": body.initiator_node_id,
        "responder": body.responder_node_id,
        "type": body.interaction_type,
    })

    # Handle both dict and event object returns
    if hasattr(event, "event_id"):
        return InteractionResponse(
            event_id=event.event_id,
            interaction_hash=event.interaction_hash,
            local_sequence=event.time_order.local_sequence if hasattr(event, "time_order") else 0,
            interaction_type=body.interaction_type,
        )
    else:
        return InteractionResponse(
            event_id=event.get("event_id", new_id()),
            interaction_hash=event.get("interaction_hash", ""),
            local_sequence=event.get("local_sequence", 0),
            interaction_type=body.interaction_type,
        )


@router.get("/history")
async def get_interaction_history(request: Request):
    """Return recent interaction history from this terminal."""
    audit_log = request.app.state.audit_log
    interaction_entries = [
        e for e in audit_log.entries if e["operation"] == "interaction_recorded"
    ]
    return {
        "terminal_id": request.app.state.terminal_id,
        "interaction_count": len(interaction_entries),
        "interactions": interaction_entries[-50:],  # Last 50
    }
