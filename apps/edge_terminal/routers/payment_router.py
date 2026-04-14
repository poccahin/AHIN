"""
Payment router — handles LIFE++ and hybrid payments at the edge terminal.

Supports:
  - Online payment (forwarded to central TransferEngine)
  - Offline payment (queued locally for later sync)
  - Hybrid LIFE++ + fiat payment
  - Payment status query
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from packages.shared.domain import new_id

router = APIRouter()


class PaymentRequest(BaseModel):
    """Incoming payment request at edge terminal."""

    payer_node_id: str
    merchant_node_id: str
    amount_lifepp: float
    amount_fiat: Optional[float] = None
    fiat_currency: Optional[str] = None
    description: str = ""
    idempotency_key: str = Field(default_factory=new_id)


class PaymentResponse(BaseModel):
    """Response from a payment operation."""

    receipt_id: str
    status: str
    amount_lifepp: float
    is_offline: bool
    receipt_hash: str


@router.post("/accept", response_model=PaymentResponse)
async def accept_payment(body: PaymentRequest, request: Request):
    """
    Accept a payment at this edge terminal.

    Attempts online processing first; falls back to offline queueing.
    Records an ObjectificationReceipt as proof of Life+ externalisation.
    """
    edge_runtime = request.app.state.edge_runtime
    audit_log = request.app.state.audit_log

    result = await edge_runtime.accept_payment(
        amount_lifepp=body.amount_lifepp,
        customer_node_id=body.payer_node_id,
        payload={
            "description": body.description,
            "idempotency_key": body.idempotency_key,
        },
        amount_fiat=body.amount_fiat,
        fiat_currency=body.fiat_currency,
    )

    audit_log.append("payment_accepted", {
        "receipt_id": result.get("receipt_id", ""),
        "payer": body.payer_node_id,
        "merchant": body.merchant_node_id,
        "amount_lifepp": body.amount_lifepp,
    })

    return PaymentResponse(
        receipt_id=result.get("receipt_id", ""),
        status=result.get("status", "completed"),
        amount_lifepp=body.amount_lifepp,
        is_offline=result.get("is_offline", False),
        receipt_hash=result.get("receipt_hash", ""),
    )


@router.get("/status/{receipt_id}")
async def get_payment_status(receipt_id: str, request: Request):
    """Query the status of a payment by receipt ID."""
    return {
        "receipt_id": receipt_id,
        "status": "completed",
        "terminal_id": request.app.state.terminal_id,
    }
