"""
MerchantSettlementService — settles LIFE++ payouts to merchant/service nodes.

Merchants participate in AHIN as MERCHANT_NODE types.
They receive LIFE++ payments through edge terminals (ObjectificationReceipts)
and settle them into their payment_balance accounts.

This service handles:
  1. Aggregation of pending merchant claims from edge receipts
  2. Validation of receipt proofs (tamper detection)
  3. Batch settlement into the Cognitive Value Ledger
  4. MERCHANT_SETTLEMENT ValueFlowEvent emission

This is NOT a generic payment processor.
It is the merchant-facing settlement arm of the cognitive value flow,
ensuring that real-world service providers are compensated for their
participation in the AHIN economy.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from packages.shared.domain import (
    AccountType,
    ValueFlowEventType,
    new_id,
    now_utc,
)
from packages.shared.events import ValueFlowEvent

logger = logging.getLogger(__name__)


class MerchantSettlementResult:
    """Outcome of a merchant settlement batch."""

    __slots__ = (
        "batch_id",
        "merchant_node_id",
        "total_lifepp",
        "receipt_count",
        "rejected_count",
        "audit_hash",
    )

    def __init__(
        self,
        batch_id: str,
        merchant_node_id: str,
        total_lifepp: float,
        receipt_count: int,
        rejected_count: int,
        audit_hash: str,
    ) -> None:
        self.batch_id = batch_id
        self.merchant_node_id = merchant_node_id
        self.total_lifepp = total_lifepp
        self.receipt_count = receipt_count
        self.rejected_count = rejected_count
        self.audit_hash = audit_hash


class MerchantSettlementService:
    """
    Settles edge terminal receipts into merchant LIFE++ accounts.

    Flow:
      1. Collect ObjectificationReceipts for a merchant
      2. Validate each receipt (proof hash, no double-settlement)
      3. Aggregate total LIFE++ owed
      4. Credit merchant payment_balance via WalletService
      5. Emit MERCHANT_SETTLEMENT ValueFlowEvent
      6. Return MerchantSettlementResult with audit hash
    """

    def __init__(
        self,
        wallet_service: Any,
        event_bus: Optional[Any] = None,
    ) -> None:
        self._wallet = wallet_service
        self._event_bus = event_bus
        self._settled_receipt_ids: set = set()  # In-memory dedup (Redis in prod)

    async def settle_merchant_receipts(
        self,
        merchant_node_id: str,
        receipts: List[Dict[str, Any]],
        time_order_dict: dict,
        customer_node_id: Optional[str] = None,
    ) -> MerchantSettlementResult:
        """
        Settle a batch of ObjectificationReceipts for a merchant.

        Receipts are validated, deduplicated, and aggregated.
        The total is credited to the merchant's payment_balance.
        """
        batch_id = new_id()
        total_lifepp = 0.0
        accepted = []
        rejected_count = 0

        for receipt in receipts:
            receipt_id = receipt.get("receipt_id")

            # Dedup — skip already-settled receipts
            if receipt_id in self._settled_receipt_ids:
                logger.warning(
                    "Duplicate receipt skipped",
                    extra={"receipt_id": receipt_id},
                )
                rejected_count += 1
                continue

            # Validate receipt hash
            if not self._verify_receipt(receipt):
                logger.warning(
                    "Receipt proof verification failed",
                    extra={"receipt_id": receipt_id},
                )
                rejected_count += 1
                continue

            amount = float(receipt.get("amount_lifepp", 0.0))
            if amount <= 0:
                rejected_count += 1
                continue

            total_lifepp += amount
            accepted.append(receipt)
            self._settled_receipt_ids.add(receipt_id)

        # Credit merchant if there is a positive total
        if total_lifepp > 0:
            await self._wallet.credit(
                node_id=merchant_node_id,
                amount_lifepp=total_lifepp,
                account_type=AccountType.PAYMENT_BALANCE,
                event_type=ValueFlowEventType.MERCHANT_SETTLEMENT,
                idempotency_key=f"merchant_settle:{batch_id}",
                time_order_dict=time_order_dict,
                memo=f"Merchant settlement batch {batch_id} — {len(accepted)} receipts",
            )

            # Emit event
            if self._event_bus:
                event = ValueFlowEvent(
                    flow_type=ValueFlowEventType.MERCHANT_SETTLEMENT,
                    from_node_id=customer_node_id,
                    to_node_id=merchant_node_id,
                    amount_lifepp=total_lifepp,
                    idempotency_key=f"merchant_settle:{batch_id}:event",
                    time_order=time_order_dict,  # type: ignore[arg-type]
                )
                await self._event_bus.publish(event)

        # Compute audit hash
        audit_data = json.dumps(
            {
                "batch_id": batch_id,
                "merchant_node_id": merchant_node_id,
                "total_lifepp": total_lifepp,
                "receipt_ids": [r.get("receipt_id") for r in accepted],
            },
            sort_keys=True,
        )
        audit_hash = hashlib.sha256(audit_data.encode()).hexdigest()

        logger.info(
            "Merchant settlement complete",
            extra={
                "batch_id": batch_id,
                "merchant": merchant_node_id,
                "total_lifepp": total_lifepp,
                "accepted": len(accepted),
                "rejected": rejected_count,
            },
        )

        return MerchantSettlementResult(
            batch_id=batch_id,
            merchant_node_id=merchant_node_id,
            total_lifepp=total_lifepp,
            receipt_count=len(accepted),
            rejected_count=rejected_count,
            audit_hash=audit_hash,
        )

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    @staticmethod
    def _verify_receipt(receipt: Dict[str, Any]) -> bool:
        """
        Verify the integrity of an ObjectificationReceipt.

        Re-computes the expected hash and compares to receipt_hash.
        """
        stored_hash = receipt.get("receipt_hash")
        if not stored_hash:
            return False

        # Re-derive the hash from receipt fields (same algorithm as ReceiptProofService)
        hashable = {
            k: v
            for k, v in receipt.items()
            if k != "receipt_hash"
        }
        computed = hashlib.sha256(
            json.dumps(hashable, sort_keys=True, default=str).encode()
        ).hexdigest()
        return computed == stored_hash
