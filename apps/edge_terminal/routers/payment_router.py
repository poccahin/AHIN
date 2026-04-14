"""
Payment router — LIFE++ and hybrid payment acceptance at the edge terminal.

Every payment at this terminal is a cognitive objectification event:
  user intention → operational interaction → durable receipt

Per Tactile Brain Hypothesis:
  The terminal's physical interaction with the merchant/customer IS
  the cognitive objectification event that anchors the payment.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException

from packages.shared.domain import LifePPBaseModel

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class AcceptPaymentRequest(LifePPBaseModel):
    """Request body for payment acceptance."""
    amount_lifepp: Optional[float] = None
    amount_fiat: Optional[float] = None
    fiat_currency: Optional[str] = None
    customer_node_id: Optional[str] = None
    artifact_id: Optional[str] = None
    payload: Dict[str, Any] = {}


class AcceptPaymentResponse(LifePPBaseModel):
    """Response for a completed payment."""
    receipt_id: str
    terminal_id: str
    merchant_node_id: str
    amount_lifepp: Optional[float] = None
    amount_fiat: Optional[float] = None
    fiat_currency: Optional[str] = None
    is_offline: bool
    receipt_hash: str
    status: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/accept", response_model=AcceptPaymentResponse)
async def accept_payment(req: AcceptPaymentRequest) -> Dict[str, Any]:
    """
    Accept a LIFE++ or hybrid payment at this edge terminal.

    This is a trust-anchored interaction event:
      1. User intention is captured in the request payload
      2. DeviceContext provides operational grounding
      3. The receipt is an ObjectificationReceipt — durable proof of the event
      4. The interaction contributes to Spontaneous Time Order

    If the terminal is offline, the payment is queued locally and will be
    synced when connectivity is restored.
    """
    from apps.edge_terminal.main import get_terminal_state

    state = get_terminal_state()
    if not state:
        raise HTTPException(status_code=503, detail="Edge terminal not initialised")

    if not state.runtime.merchant_node_id:
        raise HTTPException(
            status_code=400, detail="No merchant_node_id configured for this terminal"
        )

    # Accept the payment through the EdgeRuntime
    receipt = await state.runtime.accept_payment(
        amount_lifepp=req.amount_lifepp,
        customer_node_id=req.customer_node_id,
        payload=req.payload,
        amount_fiat=req.amount_fiat,
        fiat_currency=req.fiat_currency,
        artifact_id=req.artifact_id,
    )

    # Record in audit log
    state.audit_log.append(
        entry_type="payment",
        payload={
            "receipt_id": receipt["receipt_id"],
            "amount_lifepp": req.amount_lifepp,
            "amount_fiat": req.amount_fiat,
            "fiat_currency": req.fiat_currency,
            "customer_node_id": req.customer_node_id,
            "is_offline": receipt.get("is_offline", False),
        },
    )

    return {
        "receipt_id": receipt["receipt_id"],
        "terminal_id": state.runtime.terminal_id,
        "merchant_node_id": state.runtime.merchant_node_id,
        "amount_lifepp": req.amount_lifepp,
        "amount_fiat": req.amount_fiat,
        "fiat_currency": req.fiat_currency,
        "is_offline": receipt.get("is_offline", False),
        "receipt_hash": receipt.get("receipt_hash", ""),
        "status": receipt.get("status", "queued"),
    }
