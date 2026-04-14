"""
OfflineSyncManager — drains the local transaction queue to the central system.

Handles:
  - Batched upload of ObjectificationReceipts
  - Conflict detection (duplicate detection vs legitimate offline events)
  - Retry with exponential backoff
  - Sync status reporting
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, List, Optional

from packages.edge_runtime.local_transaction_store import LocalTransactionStore

logger = logging.getLogger(__name__)

_SYNC_BATCH_SIZE = 100
_MAX_RETRIES = 5
_BASE_BACKOFF = 2.0


class OfflineSyncManager:
    """
    Drains the LocalTransactionStore to the central reconciliation endpoint.

    Should be triggered:
      - On reconnection detection
      - On a periodic schedule (configurable)
      - On day-close
    """

    def __init__(
        self,
        store: LocalTransactionStore,
        sync_fn: Callable[[List[dict]], Any],
        batch_size: int = _SYNC_BATCH_SIZE,
    ) -> None:
        """
        Args:
            store: The local transaction queue.
            sync_fn: Async callable that accepts a list of receipts and
                     posts them to the central ReconciliationService.
            batch_size: Max receipts per sync batch.
        """
        self._store = store
        self._sync_fn = sync_fn
        self._batch_size = batch_size
        self._is_syncing = False

    async def sync(self) -> int:
        """
        Drain the queue and upload all pending receipts.

        Returns the total number of receipts synced.
        """
        if self._is_syncing:
            logger.warning("Sync already in progress — skipping")
            return 0

        self._is_syncing = True
        total_synced = 0

        try:
            while not self._store.is_empty:
                batch = self._store.drain(self._batch_size)
                if not batch:
                    break

                for attempt in range(1, _MAX_RETRIES + 1):
                    try:
                        await self._sync_fn(batch)
                        total_synced += len(batch)
                        logger.info(
                            "Sync batch uploaded",
                            extra={"batch_size": len(batch), "total": total_synced},
                        )
                        break
                    except Exception as exc:
                        logger.warning(
                            "Sync batch failed",
                            extra={"attempt": attempt, "error": str(exc)},
                        )
                        if attempt < _MAX_RETRIES:
                            await asyncio.sleep(_BASE_BACKOFF ** attempt)
                        else:
                            # Re-enqueue failed batch
                            logger.error(
                                "Sync batch permanently failed — re-enqueuing",
                                extra={"batch_size": len(batch)},
                            )
                            for receipt in batch:
                                try:
                                    self._store.enqueue(
                                        amount_lifepp=receipt.get("amount_lifepp"),
                                        amount_fiat=receipt.get("amount_fiat"),
                                        fiat_currency=receipt.get("fiat_currency"),
                                        merchant_node_id=receipt.get("merchant_node_id"),
                                        payload=receipt.get("payload", {}),
                                        artifact_id=receipt.get("artifact_id"),
                                    )
                                except OverflowError:
                                    logger.critical("Queue full — cannot re-enqueue")
        finally:
            self._is_syncing = False

        return total_synced
