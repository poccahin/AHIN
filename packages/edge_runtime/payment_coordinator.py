"""
PaymentCoordinator — coordinates LIFE++ and hybrid payments at the edge.

Supports:
  - LIFE++ payments (primary)
  - Fiat hybrid payments (LIFE++ + fiat)
  - Offline payment acceptance with local queue
  - Merchant settlement hooks
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

from packages.edge_runtime.local_transaction_store import LocalTransactionStore
from packages.edge_runtime.receipt_proof_service import ReceiptProofService
from packages.shared.domain import new_id, now_utc

logger = logging.getLogger(__name__)


class PaymentCoordinator:
    """
    Accepts payments at the edge terminal and produces ObjectificationReceipts.

    In online mode: forwards to the central TransferEngine immediately.
    In offline mode: queues locally for deferred sync.

    This embodies the Tactile Brain Hypothesis:
      the terminal's physical interaction with the merchant/customer is
      the cognitive objectification event.
    """

    def __init__(
        self,
        terminal_node_id: str,
        store: LocalTransactionStore,
        transfer_engine: Optional[Any] = None,
        is_online: bool = True,
    ) -> None:
        self._terminal_id = terminal_node_id
        self._store = store
        self._transfer_engine = transfer_engine
        self.is_online = is_online

    async def accept_payment(
        self,
        amount_lifepp: Optional[float],
        merchant_node_id: str,
        customer_node_id: Optional[str],
        payload: Dict[str, Any],
        amount_fiat: Optional[float] = None,
        fiat_currency: Optional[str] = None,
        artifact_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Accept a payment and produce an ObjectificationReceipt.

        In online mode: attempt immediate transfer; fall back to offline queue.
        In offline mode: queue immediately.
        """
        if self.is_online and self._transfer_engine:
            try:
                return await self._process_online(
                    amount_lifepp=amount_lifepp,
                    merchant_node_id=merchant_node_id,
                    customer_node_id=customer_node_id,
                    payload=payload,
                    amount_fiat=amount_fiat,
                    fiat_currency=fiat_currency,
                    artifact_id=artifact_id,
                )
            except Exception as exc:
                logger.warning(
                    "Online payment failed — falling back to offline queue",
                    extra={"error": str(exc)},
                )

        return self._process_offline(
            amount_lifepp=amount_lifepp,
            merchant_node_id=merchant_node_id,
            payload=payload,
            amount_fiat=amount_fiat,
            fiat_currency=fiat_currency,
            artifact_id=artifact_id,
        )

    async def _process_online(
        self,
        amount_lifepp: Optional[float],
        merchant_node_id: str,
        customer_node_id: Optional[str],
        payload: Dict[str, Any],
        amount_fiat: Optional[float],
        fiat_currency: Optional[str],
        artifact_id: Optional[str],
    ) -> Dict[str, Any]:
        """
        Immediately forward to central TransferEngine.
        TODO: implement on-chain Solana transaction submission
        """
        receipt_id = new_id()
        logger.info(
            "Online payment processed",
            extra={
                "receipt_id": receipt_id,
                "amount_lifepp": amount_lifepp,
                "merchant": merchant_node_id,
            },
        )
        return {
            "receipt_id": receipt_id,
            "status": "completed",
            "amount_lifepp": amount_lifepp,
            "merchant_node_id": merchant_node_id,
            "is_offline": False,
        }

    def _process_offline(
        self,
        amount_lifepp: Optional[float],
        merchant_node_id: str,
        payload: Dict[str, Any],
        amount_fiat: Optional[float],
        fiat_currency: Optional[str],
        artifact_id: Optional[str],
    ) -> Dict[str, Any]:
        """Queue payment locally for deferred sync."""
        receipt = self._store.enqueue(
            amount_lifepp=amount_lifepp,
            amount_fiat=amount_fiat,
            fiat_currency=fiat_currency,
            merchant_node_id=merchant_node_id,
            payload=payload,
            artifact_id=artifact_id,
        )
        logger.info(
            "Payment queued offline",
            extra={
                "receipt_id": receipt["receipt_id"],
                "queue_size": self._store.queue_size,
            },
        )
        return receipt
