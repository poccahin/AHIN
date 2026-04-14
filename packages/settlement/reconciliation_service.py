"""
ReconciliationService — reconciles edge terminal receipts with the central ledger.
"""
from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Dict, List, Optional

from packages.shared.domain import new_id, now_utc
from packages.shared.events import ReconciliationEvent

logger = logging.getLogger(__name__)


class ReconciliationService:
    """
    Reconciles ObjectificationReceipts from edge terminals with the central ledger.

    Handles:
      - Offline transactions that were queued locally
      - Conflict detection (duplicate vs legitimate)
      - Discrepancy reporting
    """

    def __init__(self, event_bus: Optional[Any] = None) -> None:
        self._event_bus = event_bus

    async def reconcile_edge_sync(
        self,
        terminal_node_id: str,
        receipts: List[Dict[str, Any]],
        time_order_dict: dict,
    ) -> ReconciliationEvent:
        """
        Process a batch of ObjectificationReceipts from an edge terminal.

        Returns a ReconciliationEvent summarising the outcome.
        """
        total_lifepp = 0.0
        discrepancy_count = 0
        processed = 0

        for receipt in receipts:
            try:
                total_lifepp += float(receipt.get("amount_lifepp", 0.0))
                # TODO: validate receipt hash, check for duplicates in DB,
                #       apply journal entries for offline transactions
                processed += 1
            except Exception as exc:
                discrepancy_count += 1
                logger.warning(
                    "Receipt reconciliation error",
                    extra={
                        "receipt_id": receipt.get("receipt_id"),
                        "error": str(exc),
                    },
                )

        event = ReconciliationEvent(
            reconciliation_type="edge_sync",
            terminal_node_id=terminal_node_id,
            total_receipts=processed,
            total_lifepp=total_lifepp,
            discrepancy_count=discrepancy_count,
            time_order=time_order_dict,  # type: ignore[arg-type]
        )

        if self._event_bus:
            await self._event_bus.publish(event)

        logger.info(
            "Edge sync reconciliation complete",
            extra={
                "terminal": terminal_node_id,
                "processed": processed,
                "discrepancies": discrepancy_count,
            },
        )
        return event
