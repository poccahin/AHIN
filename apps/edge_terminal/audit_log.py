"""
AuditLog — unified audit trail for payment and cognitive events at the edge.

Every important state transition at the edge terminal is logged:
  - Payment events (LIFE++ and hybrid)
  - Cognitive interaction events (agent collaboration)
  - Association events (AHIN proactive/acceptance)
  - Sync events (offline queue drain)
  - Reconciliation events (day-end)

Per Life+ Objectification:
  Auditability requires durable, tamper-evident records.
  The AuditLog chains entries via hash to support Spontaneous Time Order
  verification without relying on a central timestamp authority.
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
from typing import Any, Dict, List, Optional

from packages.shared.domain import new_id, now_utc

logger = logging.getLogger(__name__)

_DEFAULT_MAX_ENTRIES = 100_000


class AuditEntry:
    """A single audit log entry."""

    __slots__ = (
        "entry_id",
        "entry_type",
        "terminal_id",
        "payload",
        "entry_hash",
        "predecessor_hash",
        "created_at",
    )

    def __init__(
        self,
        entry_type: str,
        terminal_id: str,
        payload: Dict[str, Any],
        predecessor_hash: Optional[str] = None,
    ) -> None:
        self.entry_id = new_id()
        self.entry_type = entry_type
        self.terminal_id = terminal_id
        self.payload = payload
        self.predecessor_hash = predecessor_hash
        self.created_at = now_utc().isoformat()

        # Compute tamper-evident hash
        canonical = json.dumps(
            {
                "entry_id": self.entry_id,
                "entry_type": self.entry_type,
                "terminal_id": self.terminal_id,
                "predecessor_hash": self.predecessor_hash or "GENESIS",
                "payload_hash": hashlib.sha256(
                    json.dumps(payload, sort_keys=True, default=str).encode()
                ).hexdigest(),
                "created_at": self.created_at,
            },
            sort_keys=True,
        )
        self.entry_hash = hashlib.sha256(canonical.encode()).hexdigest()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "entry_id": self.entry_id,
            "entry_type": self.entry_type,
            "terminal_id": self.terminal_id,
            "payload": self.payload,
            "entry_hash": self.entry_hash,
            "predecessor_hash": self.predecessor_hash,
            "created_at": self.created_at,
        }


class AuditLog:
    """
    Hash-chained audit trail for the edge terminal.

    Thread-safe.  In production, back with persistent storage (SQLite/Postgres).
    """

    def __init__(
        self,
        terminal_id: str,
        max_entries: int = _DEFAULT_MAX_ENTRIES,
    ) -> None:
        self._terminal_id = terminal_id
        self._max_entries = max_entries
        self._entries: List[AuditEntry] = []
        self._lock = threading.Lock()
        self._last_hash: Optional[str] = None

    def append(self, entry_type: str, payload: Dict[str, Any]) -> AuditEntry:
        """
        Append a new audit entry, chained to the previous one.

        Returns the new entry.
        """
        with self._lock:
            entry = AuditEntry(
                entry_type=entry_type,
                terminal_id=self._terminal_id,
                payload=payload,
                predecessor_hash=self._last_hash,
            )
            self._entries.append(entry)
            self._last_hash = entry.entry_hash

            # Prevent unbounded growth in memory
            if len(self._entries) > self._max_entries:
                self._entries = self._entries[-self._max_entries:]

            logger.debug(
                "Audit entry appended",
                extra={
                    "entry_id": entry.entry_id,
                    "entry_type": entry_type,
                    "terminal_id": self._terminal_id,
                },
            )
            return entry

    def get_entries(
        self,
        entry_type: Optional[str] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """
        Return recent audit entries, optionally filtered by type.

        Returns entries in reverse chronological order (newest first).
        """
        with self._lock:
            entries = self._entries
            if entry_type:
                entries = [e for e in entries if e.entry_type == entry_type]
            return [e.to_dict() for e in entries[-limit:][::-1]]

    def verify_chain(self) -> bool:
        """
        Verify the integrity of the audit log hash chain.

        Returns True if the chain is intact.
        """
        with self._lock:
            prev_hash: Optional[str] = None
            for entry in self._entries:
                if entry.predecessor_hash != prev_hash:
                    logger.warning(
                        "Audit chain integrity violation",
                        extra={"entry_id": entry.entry_id},
                    )
                    return False
                prev_hash = entry.entry_hash
            return True

    @property
    def entry_count(self) -> int:
        return len(self._entries)

    @property
    def last_hash(self) -> Optional[str]:
        return self._last_hash
