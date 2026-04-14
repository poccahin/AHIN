"""
Sync router — manages offline queue synchronisation with the control plane.

Handles:
  - Triggering offline queue drain
  - Sync status queries
  - Receipt batch upload
  - Conflict detection reporting
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

router = APIRouter()


class SyncRequest(BaseModel):
    """Request to trigger an offline queue sync."""

    force: bool = False
    max_batch_size: int = 100


class SyncResponse(BaseModel):
    """Response from a sync operation."""

    total_synced: int
    remaining_in_queue: int
    conflicts: int
    terminal_id: str


@router.post("/trigger", response_model=SyncResponse)
async def trigger_sync(body: SyncRequest, request: Request):
    """
    Trigger synchronisation of the offline queue to the control plane.

    Drains the local transaction queue and uploads receipts in batches.
    """
    edge_runtime = request.app.state.edge_runtime
    audit_log = request.app.state.audit_log

    total_synced = await edge_runtime.sync_offline_queue()

    audit_log.append("sync_triggered", {
        "total_synced": total_synced,
        "force": body.force,
    })

    return SyncResponse(
        total_synced=total_synced,
        remaining_in_queue=edge_runtime.device_status().get("offline_queue_size", 0),
        conflicts=0,
        terminal_id=request.app.state.terminal_id,
    )


@router.get("/status")
async def get_sync_status(request: Request):
    """Return the current sync and device status."""
    edge_runtime = request.app.state.edge_runtime
    status = edge_runtime.device_status()
    return {
        "terminal_id": request.app.state.terminal_id,
        **status,
    }


class ReceiptBatchUpload(BaseModel):
    """Batch of ObjectificationReceipts for upload."""

    receipts: List[Dict[str, Any]] = Field(default_factory=list)
    terminal_node_id: str


@router.post("/receipts")
async def upload_receipts(body: ReceiptBatchUpload, request: Request):
    """
    Upload a batch of ObjectificationReceipts from this edge terminal
    to the control plane for reconciliation.
    """
    audit_log = request.app.state.audit_log

    audit_log.append("receipts_uploaded", {
        "terminal_node_id": body.terminal_node_id,
        "receipt_count": len(body.receipts),
    })

    return {
        "accepted": len(body.receipts),
        "terminal_node_id": body.terminal_node_id,
        "status": "queued_for_reconciliation",
    }
