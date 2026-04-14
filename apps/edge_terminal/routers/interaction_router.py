"""
Interaction router — cognitive interactions and AHIN association events.

This router handles:
  1. Local cognitive interactions (user + agent at terminal)
  2. AHIN Proactive Association events (terminal initiates collaboration)
  3. AHIN Acceptance of Association events (terminal confirms collaboration)

Per AHIN theory:
  Local directional interactions become trust anchors.
  Even offline interactions contribute to the Spontaneous Time Order.

Per POC:
  Meaningful local execution becomes evidence of cognitive contribution.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException

from packages.shared.domain import AssociationEventType, LifePPBaseModel

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class CognitiveInteractionRequest(LifePPBaseModel):
    """Request body for a local cognitive interaction."""
    intent_description: str
    input_payload: Dict[str, Any] = {}
    agent_node_id: Optional[str] = None
    artifact_content: Optional[str] = None


class CognitiveInteractionResponse(LifePPBaseModel):
    """Response for a processed cognitive interaction."""
    interaction_id: str
    artifact_id: str
    artifact_status: str
    content_hash: str
    is_grounded: bool
    terminal_id: str


class AssociationEventRequest(LifePPBaseModel):
    """Request body for an AHIN association event."""
    responder_node_id: str
    event_type: str  # "proactive_association" or "acceptance_of_association"
    task_id: Optional[str] = None
    payload: Dict[str, Any] = {}


class AssociationEventResponse(LifePPBaseModel):
    """Response for a recorded association event."""
    event_id: str
    association_type: str
    initiator_node_id: str
    responder_node_id: str
    interaction_hash: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/cognitive", response_model=CognitiveInteractionResponse)
async def submit_cognitive_interaction(
    req: CognitiveInteractionRequest,
) -> Dict[str, Any]:
    """
    Submit a local cognitive interaction at this edge terminal.

    This is the Tactile Brain cycle:
      intention → operational interaction → grounded artifact → durable record

    The interaction produces a CanxianArtifact record with:
      - grounding_context from the terminal's DeviceContext
      - content_hash for tamper evidence
      - Spontaneous Time Order sequencing

    The artifact is logged as POC evidence for future settlement.
    """
    from apps.edge_terminal.main import get_terminal_state

    state = get_terminal_state()
    if not state:
        raise HTTPException(status_code=503, detail="Edge terminal not initialised")

    record = state.interaction_handler.handle_cognitive_interaction(
        intent_description=req.intent_description,
        input_payload=req.input_payload,
        agent_node_id=req.agent_node_id,
        artifact_content=req.artifact_content,
    )

    # Audit trail
    state.audit_log.append(
        entry_type="cognitive_interaction",
        payload={
            "interaction_id": record["interaction_id"],
            "artifact_id": record["artifact_id"],
            "agent_node_id": req.agent_node_id,
            "intent": req.intent_description,
        },
    )

    is_grounded = record["artifact_status"] != "raw_output"

    return {
        "interaction_id": record["interaction_id"],
        "artifact_id": record["artifact_id"],
        "artifact_status": record["artifact_status"],
        "content_hash": record["content_hash"],
        "is_grounded": is_grounded,
        "terminal_id": state.runtime.terminal_id,
    }


@router.post("/association", response_model=AssociationEventResponse)
async def record_association_event(
    req: AssociationEventRequest,
) -> Dict[str, Any]:
    """
    Record an AHIN association event at this edge terminal.

    Proactive Association: terminal initiates collaboration with a peer.
    Acceptance of Association: terminal confirms collaboration request.

    These events are trust anchors in the AHIN network.
    They carry interaction hashes for Spontaneous Time Order.
    """
    from apps.edge_terminal.main import get_terminal_state

    state = get_terminal_state()
    if not state:
        raise HTTPException(status_code=503, detail="Edge terminal not initialised")

    # Map string to enum
    try:
        event_type = AssociationEventType(req.event_type)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid event_type: {req.event_type}. "
            f"Must be one of: {[e.value for e in AssociationEventType]}",
        )

    event = state.interaction_handler.record_association_event(
        responder_node_id=req.responder_node_id,
        event_type=event_type,
        task_id=req.task_id,
        payload=req.payload,
    )

    if event is None:
        raise HTTPException(
            status_code=403,
            detail="Terminal not admitted to AHIN — cannot record association events",
        )

    # Audit trail
    state.audit_log.append(
        entry_type="association_event",
        payload={
            "event_id": event.event_id,
            "association_type": event.association_type,
            "responder_node_id": req.responder_node_id,
        },
    )

    return {
        "event_id": event.event_id,
        "association_type": event.association_type,
        "initiator_node_id": event.initiator_node_id,
        "responder_node_id": event.responder_node_id or req.responder_node_id,
        "interaction_hash": event.interaction_hash,
    }
