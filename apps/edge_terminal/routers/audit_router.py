"""
Audit router — device status and audit trail for the edge terminal.

Provides:
  1. Device status (AHIN admission, queue size, online state)
  2. Audit trail of all events (payment, cognitive, association, sync)
  3. Audit chain integrity verification
  4. Interaction log for POC evidence

Per Life+ Objectification:
  All important state transitions must be auditable.
  The audit trail is hash-chained for tamper evidence,
  supporting Spontaneous Time Order verification.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query

from packages.shared.domain import LifePPBaseModel

router = APIRouter()


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class DeviceStatusResponse(LifePPBaseModel):
    """Full device status snapshot."""
    terminal_id: str
    merchant_node_id: Optional[str] = None
    is_admitted_to_ahin: bool
    queue_size: int
    is_online: bool
    local_sequence: int
    interaction_count: int
    audit_entry_count: int
    audit_chain_valid: bool
    has_grounding: bool


class AuditEntryResponse(LifePPBaseModel):
    """A single audit log entry."""
    entry_id: str
    entry_type: str
    terminal_id: str
    payload: Dict[str, Any]
    entry_hash: str
    predecessor_hash: Optional[str] = None
    created_at: str


class AuditTrailResponse(LifePPBaseModel):
    """Response containing audit trail entries."""
    terminal_id: str
    entries: List[AuditEntryResponse]
    total_count: int
    chain_valid: bool


class InteractionLogResponse(LifePPBaseModel):
    """Response containing cognitive interaction log for POC evidence."""
    terminal_id: str
    interactions: List[Dict[str, Any]]
    total_count: int


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/status", response_model=DeviceStatusResponse)
async def get_device_status() -> Dict[str, Any]:
    """
    Return the full status of this edge terminal.

    Includes AHIN membership, queue state, grounding status,
    and audit chain integrity.
    """
    from apps.edge_terminal.main import get_terminal_state

    state = get_terminal_state()
    if not state:
        raise HTTPException(status_code=503, detail="Edge terminal not initialised")

    device = state.runtime.device_status()
    return {
        "terminal_id": device["terminal_id"],
        "merchant_node_id": device["merchant_node_id"],
        "is_admitted_to_ahin": device["is_admitted_to_ahin"],
        "queue_size": device["queue_size"],
        "is_online": device["is_online"],
        "local_sequence": device["local_sequence"],
        "interaction_count": state.interaction_handler.interaction_count,
        "audit_entry_count": state.audit_log.entry_count,
        "audit_chain_valid": state.audit_log.verify_chain(),
        "has_grounding": state.context_manager.has_grounding,
    }


@router.get("/trail", response_model=AuditTrailResponse)
async def get_audit_trail(
    entry_type: Optional[str] = Query(
        None,
        description=(
            "Filter by entry type: payment, cognitive_interaction, "
            "association_event, sync, day_close"
        ),
    ),
    limit: int = Query(100, ge=1, le=1000, description="Max entries to return"),
) -> Dict[str, Any]:
    """
    Return the audit trail for this edge terminal.

    The audit trail is hash-chained: each entry's hash incorporates
    its predecessor, supporting tamper-evident Spontaneous Time Order
    verification without a central timestamp authority.

    Filterable by entry type for targeted audit queries.
    """
    from apps.edge_terminal.main import get_terminal_state

    state = get_terminal_state()
    if not state:
        raise HTTPException(status_code=503, detail="Edge terminal not initialised")

    entries = state.audit_log.get_entries(entry_type=entry_type, limit=limit)
    return {
        "terminal_id": state.runtime.terminal_id,
        "entries": entries,
        "total_count": state.audit_log.entry_count,
        "chain_valid": state.audit_log.verify_chain(),
    }


@router.get("/interactions", response_model=InteractionLogResponse)
async def get_interaction_log() -> Dict[str, Any]:
    """
    Return the cognitive interaction log for this terminal.

    This log is the terminal's contribution to POC evidence:
      each interaction record documents a grounded cognitive event
      with content hash, grounding context, and agent participation.

    Per POC:
      Meaningful local execution becomes evidence of cognitive contribution.
    """
    from apps.edge_terminal.main import get_terminal_state

    state = get_terminal_state()
    if not state:
        raise HTTPException(status_code=503, detail="Edge terminal not initialised")

    interactions = state.interaction_handler.interaction_log
    return {
        "terminal_id": state.runtime.terminal_id,
        "interactions": interactions,
        "total_count": state.interaction_handler.interaction_count,
    }


@router.get("/verify-chain")
async def verify_audit_chain() -> Dict[str, Any]:
    """
    Verify the integrity of the terminal's audit log hash chain.

    Returns whether the chain is intact — no entries have been
    tampered with or reordered since creation.

    This supports AHIN's requirement for tamper-evident interaction
    records without relying on a central authority.
    """
    from apps.edge_terminal.main import get_terminal_state

    state = get_terminal_state()
    if not state:
        raise HTTPException(status_code=503, detail="Edge terminal not initialised")

    is_valid = state.audit_log.verify_chain()
    return {
        "terminal_id": state.runtime.terminal_id,
        "chain_valid": is_valid,
        "entry_count": state.audit_log.entry_count,
        "last_hash": state.audit_log.last_hash,
    }
