"""Edge terminal router — sync receipts, device status."""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter
from packages.shared.domain import LifePPBaseModel

router = APIRouter()


class SyncReceiptsRequest(LifePPBaseModel):
    terminal_node_id: str
    receipts: List[Dict[str, Any]]


@router.post("/sync")
async def sync_edge_receipts(req: SyncReceiptsRequest) -> Dict[str, Any]:
    """
    Accept a batch of ObjectificationReceipts from an edge terminal.

    This is the embodied sync: offline cognitive/payment events become
    part of the central AHIN interaction record.
    """
    # TODO: call ReconciliationService.reconcile_edge_sync()
    return {
        "terminal_node_id": req.terminal_node_id,
        "received_count": len(req.receipts),
        "status": "accepted",
        "message": "TODO: integrate ReconciliationService",
    }


@router.get("/{terminal_id}/status")
async def get_terminal_status(terminal_id: str) -> Dict[str, Any]:
    """Return the status of an edge terminal."""
    # TODO: query EdgeRuntime status
    return {"terminal_id": terminal_id, "status": "TODO"}
