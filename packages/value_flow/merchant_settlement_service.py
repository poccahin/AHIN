"""
MerchantSettlementService — handles merchant payment settlement.

This service manages the merchant-facing settlement loop:
  1. Merchant submits payment request (acquiring)
  2. Payment is authorised against payer balance
  3. Funds are transferred (LIFE++ or hybrid LIFE++ + fiat)
  4. Settlement batch is created for reconciliation
  5. Day-close reconciliation finalises

Merchants are MERCHANT_NODE participants in AHIN — they are
cognitive-economic actors, not passive payment endpoints.
"""
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from packages.shared.domain import ValueFlowEventType, new_id, now_utc

logger = logging.getLogger(__name__)


@dataclass
class MerchantPaymentRequest:
    """A merchant payment request (acquiring side)."""

    request_id: str
    merchant_node_id: str
    payer_node_id: str
    amount_lifepp: float
    amount_fiat: Optional[float] = None
    fiat_currency: Optional[str] = None
    description: str = ""
    idempotency_key: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.request_id:
            self.request_id = new_id()
        if not self.idempotency_key:
            self.idempotency_key = f"merchant_payment:{self.request_id}"


@dataclass
class MerchantSettlementRecord:
    """A record in a merchant settlement batch."""

    record_id: str
    request_id: str
    merchant_node_id: str
    payer_node_id: str
    amount_lifepp: float
    amount_fiat: Optional[float]
    status: str  # "pending", "completed", "failed", "disputed"
    settled_at: Optional[str] = None


class MerchantSettlementService:
    """
    Orchestrates the merchant payment, acquiring, and settlement loop.

    Lifecycle:
      1. create_payment()    — validate and record payment request
      2. authorise_payment() — check payer balance
      3. capture_payment()   — execute the transfer
      4. batch_settlements() — create settlement batch for reconciliation
    """

    def __init__(self) -> None:
        self._pending_requests: Dict[str, MerchantPaymentRequest] = {}
        self._settlement_records: List[MerchantSettlementRecord] = []
        self._batch_counter: int = 0

    def create_payment(
        self,
        merchant_node_id: str,
        payer_node_id: str,
        amount_lifepp: float,
        amount_fiat: Optional[float] = None,
        fiat_currency: Optional[str] = None,
        description: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> MerchantPaymentRequest:
        """Create a new merchant payment request."""
        request = MerchantPaymentRequest(
            request_id=new_id(),
            merchant_node_id=merchant_node_id,
            payer_node_id=payer_node_id,
            amount_lifepp=amount_lifepp,
            amount_fiat=amount_fiat,
            fiat_currency=fiat_currency,
            description=description,
            metadata=metadata or {},
        )
        self._pending_requests[request.request_id] = request
        logger.info(
            "Merchant payment request created",
            extra={
                "request_id": request.request_id,
                "merchant": merchant_node_id,
                "payer": payer_node_id,
                "amount_lifepp": amount_lifepp,
            },
        )
        return request

    def authorise_payment(
        self,
        request_id: str,
        payer_balance: float,
    ) -> bool:
        """
        Authorise a merchant payment against the payer's balance.

        Returns True if the payment is authorised.
        """
        request = self._pending_requests.get(request_id)
        if request is None:
            logger.warning(
                "Payment request not found",
                extra={"request_id": request_id},
            )
            return False

        if payer_balance < request.amount_lifepp:
            logger.warning(
                "Payment authorisation failed — insufficient balance",
                extra={
                    "request_id": request_id,
                    "required": request.amount_lifepp,
                    "available": payer_balance,
                },
            )
            return False

        return True

    def capture_payment(
        self,
        request_id: str,
    ) -> Optional[MerchantSettlementRecord]:
        """
        Mark a payment as captured (transfer has been executed).

        Returns the settlement record.
        """
        request = self._pending_requests.pop(request_id, None)
        if request is None:
            return None

        record = MerchantSettlementRecord(
            record_id=new_id(),
            request_id=request.request_id,
            merchant_node_id=request.merchant_node_id,
            payer_node_id=request.payer_node_id,
            amount_lifepp=request.amount_lifepp,
            amount_fiat=request.amount_fiat,
            status="completed",
            settled_at=now_utc().isoformat(),
        )
        self._settlement_records.append(record)
        logger.info(
            "Merchant payment captured",
            extra={
                "record_id": record.record_id,
                "request_id": request_id,
            },
        )
        return record

    def batch_settlements(self) -> Dict[str, Any]:
        """
        Create a settlement batch from all completed records.

        Returns batch summary with audit hash.
        """
        completed = [
            r for r in self._settlement_records if r.status == "completed"
        ]
        if not completed:
            return {"batch_id": None, "record_count": 0, "total_lifepp": 0.0}

        self._batch_counter += 1
        batch_id = f"merchant_batch_{self._batch_counter}"
        total_lifepp = sum(r.amount_lifepp for r in completed)

        # Audit hash
        hash_input = "|".join(
            f"{r.record_id}:{r.amount_lifepp}" for r in completed
        )
        audit_hash = hashlib.sha256(hash_input.encode()).hexdigest()

        # Clear settled records
        self._settlement_records = [
            r for r in self._settlement_records if r.status != "completed"
        ]

        logger.info(
            "Merchant settlement batch created",
            extra={
                "batch_id": batch_id,
                "record_count": len(completed),
                "total_lifepp": total_lifepp,
            },
        )

        return {
            "batch_id": batch_id,
            "record_count": len(completed),
            "total_lifepp": total_lifepp,
            "audit_hash": audit_hash,
        }

    @property
    def pending_count(self) -> int:
        """Number of pending payment requests."""
        return len(self._pending_requests)
