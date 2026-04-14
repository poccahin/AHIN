"""Settlement router — trigger and query VirtueWellbeing settlement batches."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter
from packages.shared.domain import LifePPBaseModel, new_id, now_utc

router = APIRouter()


class TriggerSettlementRequest(LifePPBaseModel):
    period_start_iso: str
    period_end_iso: str
    total_pool_lifepp: float


@router.post("/trigger")
async def trigger_settlement(req: TriggerSettlementRequest) -> Dict[str, Any]:
    """
    Manually trigger a VirtueWellbeing settlement batch.

    In production this is triggered by DayCloseService.
    """
    # TODO: call SettlementService.run_settlement_batch()
    batch_id = new_id()
    return {
        "batch_id": batch_id,
        "status": "queued",
        "period_start": req.period_start_iso,
        "period_end": req.period_end_iso,
        "total_pool_lifepp": req.total_pool_lifepp,
        "message": "TODO: integrate SettlementService",
    }


@router.get("/batches/{batch_id}")
async def get_settlement_batch(batch_id: str) -> Dict[str, Any]:
    """Get details of a VirtueWellbeing settlement batch."""
    # TODO: query VirtueWellbeingSettlementBatchORM
    return {"batch_id": batch_id, "status": "TODO"}
