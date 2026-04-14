"""
EdgeRuntime — the Life++ Lite Edge Terminal runtime orchestrator.

The EdgeRuntime is the top-level coordinator for an edge terminal.
It integrates:
  - PaymentCoordinator (payment acceptance)
  - LocalTransactionStore (offline queue)
  - OfflineSyncManager (deferred sync)
  - AhinNode (AHIN participation)
  - LocalTimeSequencer (Spontaneous Time Order)

Per Tactile Brain Hypothesis:
  This device is the embodied locus where user intention meets operational reality.
  Every interaction is a potential cognitive objectification event.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

from packages.ahin_network.ahin_node import AhinNode
from packages.ahin_network.local_time_sequencer import LocalTimeSequencer
from packages.edge_runtime.local_transaction_store import LocalTransactionStore
from packages.edge_runtime.offline_sync_manager import OfflineSyncManager
from packages.edge_runtime.payment_coordinator import PaymentCoordinator
from packages.edge_runtime.receipt_proof_service import ReceiptProofService
from packages.shared.domain import NodeType, new_id

logger = logging.getLogger(__name__)


class EdgeRuntime:
    """
    Life++ Lite Edge Terminal — embodied cognition and settlement node.

    Lifecycle:
      1. Initialise with device context
      2. Register as AHIN node (may be offline at boot)
      3. Accept payments and cognitive interactions
      4. Sync offline queue when connectivity restored
      5. Participate in day-close reconciliation
    """

    def __init__(
        self,
        terminal_id: Optional[str] = None,
        merchant_node_id: Optional[str] = None,
        max_queue_size: int = int(os.getenv("EDGE_OFFLINE_QUEUE_MAX_SIZE", "10000")),
        transfer_engine: Optional[Any] = None,
        sync_fn: Optional[Any] = None,
    ) -> None:
        self.terminal_id: str = terminal_id or os.getenv("EDGE_TERMINAL_ID") or new_id()
        self.merchant_node_id: Optional[str] = merchant_node_id
        self._sequencer = LocalTimeSequencer(self.terminal_id)
        self._ahin_node = AhinNode(
            node_id=self.terminal_id, node_type=NodeType.EDGE_TERMINAL
        )
        self._store = LocalTransactionStore(
            terminal_node_id=self.terminal_id,
            max_size=max_queue_size,
            sequencer=self._sequencer,
        )
        self._payment_coordinator = PaymentCoordinator(
            terminal_node_id=self.terminal_id,
            store=self._store,
            transfer_engine=transfer_engine,
            is_online=transfer_engine is not None,
        )
        self._proof_service = ReceiptProofService()

        if sync_fn:
            self._sync_manager = OfflineSyncManager(
                store=self._store, sync_fn=sync_fn
            )
        else:
            self._sync_manager = None

        logger.info(
            "EdgeRuntime initialised",
            extra={"terminal_id": self.terminal_id, "merchant": merchant_node_id},
        )

    # ------------------------------------------------------------------
    # Payment acceptance
    # ------------------------------------------------------------------

    async def accept_payment(
        self,
        amount_lifepp: Optional[float],
        customer_node_id: Optional[str],
        payload: Dict[str, Any],
        amount_fiat: Optional[float] = None,
        fiat_currency: Optional[str] = None,
        artifact_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Accept a payment at this edge terminal.

        This is a cognitive objectification event:
          user intention → operational interaction → durable receipt
        """
        if not self.merchant_node_id:
            raise ValueError("Edge terminal has no merchant_node_id configured")

        receipt = await self._payment_coordinator.accept_payment(
            amount_lifepp=amount_lifepp,
            merchant_node_id=self.merchant_node_id,
            customer_node_id=customer_node_id,
            payload=payload,
            amount_fiat=amount_fiat,
            fiat_currency=fiat_currency,
            artifact_id=artifact_id,
        )

        # Ensure receipt has a valid proof hash
        if "receipt_hash" not in receipt or not receipt["receipt_hash"]:
            receipt["receipt_hash"] = self._proof_service.create_proof(receipt)

        return receipt

    # ------------------------------------------------------------------
    # Sync
    # ------------------------------------------------------------------

    async def sync_offline_queue(self) -> int:
        """Drain and upload the offline queue. Returns count synced."""
        if not self._sync_manager:
            logger.warning("No sync_fn configured — cannot sync")
            return 0
        return await self._sync_manager.sync()

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    def device_status(self) -> Dict[str, Any]:
        """Return a status snapshot of this terminal."""
        return {
            "terminal_id": self.terminal_id,
            "merchant_node_id": self.merchant_node_id,
            "is_admitted_to_ahin": self._ahin_node.is_admitted,
            "queue_size": self._store.queue_size,
            "is_online": self._payment_coordinator.is_online,
            "local_sequence": self._sequencer.current_sequence,
        }
