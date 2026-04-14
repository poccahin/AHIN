"""
LocalTransactionStore — offline-first local transaction queue for edge terminals.

When the terminal loses connectivity, transactions are queued locally.
Upon reconnection, the OfflineSyncManager drains this queue to the central system.

Each entry is an ObjectificationReceipt — proof of a local cognitive/payment event.
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
from collections import deque
from typing import Any, Dict, List, Optional

from packages.ahin_network.local_time_sequencer import LocalTimeSequencer
from packages.shared.domain import new_id, now_utc

logger = logging.getLogger(__name__)

_DEFAULT_MAX_SIZE = int(10_000)


class LocalTransactionStore:
    """
    In-memory (SQLite-backed in production) queue for offline transactions.

    Thread-safe for concurrent edge interactions.
    In production: back with SQLite for durability across restarts.

    TODO: replace deque with persistent SQLite store for production
    """

    def __init__(
        self,
        terminal_node_id: str,
        max_size: int = _DEFAULT_MAX_SIZE,
        sequencer: Optional[LocalTimeSequencer] = None,
    ) -> None:
        self._terminal_id = terminal_node_id
        self._max_size = max_size
        self._sequencer = sequencer or LocalTimeSequencer(terminal_node_id)
        self._queue: deque[Dict[str, Any]] = deque()
        self._lock = threading.Lock()

    def enqueue(
        self,
        amount_lifepp: Optional[float],
        amount_fiat: Optional[float],
        fiat_currency: Optional[str],
        merchant_node_id: Optional[str],
        payload: Dict[str, Any],
        artifact_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Enqueue a transaction as an ObjectificationReceipt.

        Returns the receipt dict.  Raises if queue is full (anti-DoS).
        """
        with self._lock:
            if len(self._queue) >= self._max_size:
                raise OverflowError(
                    f"LocalTransactionStore at capacity ({self._max_size}). "
                    "Sync required before new transactions."
                )

            time_order = self._sequencer.next(
                interaction_type="payment",
                payload=payload,
            )

            receipt_content = json.dumps(
                {
                    "terminal_node_id": self._terminal_id,
                    "amount_lifepp": amount_lifepp,
                    "amount_fiat": amount_fiat,
                    "fiat_currency": fiat_currency,
                    "merchant_node_id": merchant_node_id,
                    "artifact_id": artifact_id,
                    "payload": payload,
                    "sequence": time_order.local_sequence,
                },
                sort_keys=True,
            )
            receipt_hash = hashlib.sha256(receipt_content.encode()).hexdigest()

            receipt = {
                "receipt_id": new_id(),
                "terminal_node_id": self._terminal_id,
                "artifact_id": artifact_id,
                "merchant_node_id": merchant_node_id,
                "amount_lifepp": amount_lifepp,
                "amount_fiat": amount_fiat,
                "fiat_currency": fiat_currency,
                "is_offline": True,
                "sync_status": "pending",
                "receipt_hash": receipt_hash,
                "payload": payload,
                "spontaneous_time_order": time_order.model_dump(),
                "created_at": now_utc().isoformat(),
            }
            self._queue.append(receipt)
            logger.info(
                "Transaction enqueued offline",
                extra={
                    "receipt_id": receipt["receipt_id"],
                    "queue_size": len(self._queue),
                    "terminal": self._terminal_id,
                },
            )
            return receipt

    def drain(self, batch_size: int = 100) -> List[Dict[str, Any]]:
        """
        Drain up to batch_size receipts from the queue for sync.

        Returns the drained receipts.
        """
        with self._lock:
            batch = []
            for _ in range(min(batch_size, len(self._queue))):
                batch.append(self._queue.popleft())
            return batch

    @property
    def queue_size(self) -> int:
        return len(self._queue)

    @property
    def is_empty(self) -> bool:
        return len(self._queue) == 0
