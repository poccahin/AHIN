"""
Sync router — offline sync and day-end reconciliation at the edge terminal.

Handles:
  1. Manual trigger of offline queue sync
  2. Day-end reconciliation trigger
  3. Sync status queries

Per AHIN theory:
  Offline transactions preserve their local Spontaneous Time Order.
  Sync brings them into the central record without requiring global consensus
  at the moment of interaction.
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from packages.shared.domain import LifePPBaseModel

router = APIRouter()


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class SyncStatusResponse(LifePPBaseModel):
    """Response for sync status queries."""
    terminal_id: str
    queue_size: int
    is_online: bool
    last_sync_count: int


class SyncResultResponse(LifePPBaseModel):
    """Response after triggering a sync."""
    terminal_id: str
    synced_count: int
    remaining_queue_size: int
    status: str


class DayCloseResultResponse(LifePPBaseModel):
    """Response after triggering day-end reconciliation."""
    terminal_id: str
    status: str
    message: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/trigger", response_model=SyncResultResponse)
async def trigger_sync() -> Dict[str, Any]:
    """
    Trigger synchronization of the offline transaction queue.

    Drains pending ObjectificationReceipts from the local queue
    and uploads them to the central ReconciliationService.

    Each receipt carries its local Spontaneous Time Order,
    preserving interaction-derived sequencing.
    """
    from apps.edge_terminal.main import get_terminal_state

    state = get_terminal_state()
    if not state:
        raise HTTPException(status_code=503, detail="Edge terminal not initialised")

    synced_count = await state.runtime.sync_offline_queue()

    # Audit trail
    state.audit_log.append(
        entry_type="sync",
        payload={
            "synced_count": synced_count,
            "remaining_queue_size": state.runtime.device_status()["queue_size"],
        },
    )

    return {
        "terminal_id": state.runtime.terminal_id,
        "synced_count": synced_count,
        "remaining_queue_size": state.runtime.device_status()["queue_size"],
        "status": "completed",
    }


@router.get("/status", response_model=SyncStatusResponse)
async def get_sync_status() -> Dict[str, Any]:
    """
    Return the current sync status of this edge terminal.

    Includes queue size, online status, and local sequence position.
    """
    from apps.edge_terminal.main import get_terminal_state

    state = get_terminal_state()
    if not state:
        raise HTTPException(status_code=503, detail="Edge terminal not initialised")

    device = state.runtime.device_status()
    return {
        "terminal_id": device["terminal_id"],
        "queue_size": device["queue_size"],
        "is_online": device["is_online"],
        "last_sync_count": 0,
    }


@router.post("/day-close", response_model=DayCloseResultResponse)
async def trigger_day_close() -> Dict[str, Any]:
    """
    Trigger day-end reconciliation for this edge terminal.

    This first syncs all pending offline transactions,
    then signals readiness for VirtueWellbeing settlement.

    Per Aligned Virtue and Well-being:
      Day-close settlement distributes LIFE++ proportionally to
      contribution credit, not capital stake.
    """
    from apps.edge_terminal.main import get_terminal_state

    state = get_terminal_state()
    if not state:
        raise HTTPException(status_code=503, detail="Edge terminal not initialised")

    # First sync any remaining offline transactions
    synced_count = await state.runtime.sync_offline_queue()

    # Audit trail
    state.audit_log.append(
        entry_type="day_close",
        payload={
            "synced_before_close": synced_count,
            "queue_after_close": state.runtime.device_status()["queue_size"],
        },
    )

    return {
        "terminal_id": state.runtime.terminal_id,
        "status": "completed",
        "message": (
            f"Day-close complete. Synced {synced_count} pending transactions. "
            f"Terminal ready for settlement."
        ),
    }
