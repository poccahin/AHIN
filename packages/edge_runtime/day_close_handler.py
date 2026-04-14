"""
DayCloseHandler — day-end reconciliation and settlement at the edge terminal.

Per Aligned Virtue and Well-being:
  Settlement must structurally align contribution with well-being.
  Day-end reconciliation aggregates all edge interactions and feeds
  the VirtueWellbeing settlement process.

Per AHIN:
  Offline transactions must be synced before settlement.
  The local hash chain provides audit integrity.

This handler orchestrates:
  1. Drain offline queue (sync all pending receipts)
  2. Aggregate agent participation for POC evidence
  3. Produce reconciliation summary with audit hash
  4. Feed into central DayCloseService
"""
from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Callable, Dict, List, Optional

from packages.edge_runtime.agent_participation_tracker import AgentParticipationTracker
from packages.edge_runtime.cognitive_interaction_handler import CognitiveInteractionHandler
from packages.edge_runtime.local_transaction_store import LocalTransactionStore
from packages.edge_runtime.offline_sync_manager import OfflineSyncManager
from packages.edge_runtime.trust_anchor_service import TrustAnchorService
from packages.shared.domain import new_id, now_utc

logger = logging.getLogger(__name__)


class DayCloseHandler:
    """
    Handles end-of-day reconciliation at the Life++ Lite Edge Terminal.

    The day-close process at the edge is a cognitive objectification event:
    the terminal externalizes its accumulated interactions into a durable
    reconciliation record that feeds the VirtueWellbeing settlement.

    Steps:
      1. Sync all pending offline transactions
      2. Collect agent participation summary
      3. Collect interaction and trust anchor logs
      4. Compute reconciliation audit hash
      5. Produce a day-close reconciliation record
    """

    def __init__(
        self,
        terminal_node_id: str,
        store: LocalTransactionStore,
        sync_manager: Optional[OfflineSyncManager],
        interaction_handler: CognitiveInteractionHandler,
        trust_anchor_service: TrustAnchorService,
        participation_tracker: AgentParticipationTracker,
    ) -> None:
        self._terminal_id = terminal_node_id
        self._store = store
        self._sync_manager = sync_manager
        self._interaction_handler = interaction_handler
        self._trust_anchor_service = trust_anchor_service
        self._participation_tracker = participation_tracker

    async def execute_day_close(self) -> Dict[str, Any]:
        """
        Execute the full day-close reconciliation at this edge terminal.

        Returns a reconciliation record suitable for submission to the
        central DayCloseService.
        """
        logger.info(
            "Edge terminal day-close started",
            extra={"terminal": self._terminal_id},
        )

        # 1. Sync pending offline transactions
        synced_count = 0
        if self._sync_manager:
            synced_count = await self._sync_manager.sync()

        # 2. Collect summaries
        participation_summary = self._participation_tracker.get_contribution_summary()
        participation_audit_hash = self._participation_tracker.generate_audit_hash()

        interaction_log = self._interaction_handler.get_interaction_log()
        trust_anchor_log = self._trust_anchor_service.get_anchor_log()

        # 3. Compute reconciliation audit hash
        audit_payload = {
            "terminal_node_id": self._terminal_id,
            "day_close_at": now_utc().isoformat(),
            "synced_count": synced_count,
            "remaining_queue_size": self._store.queue_size,
            "interaction_count": len(interaction_log),
            "trust_anchor_count": len(trust_anchor_log),
            "participation_summary": participation_summary,
            "participation_audit_hash": participation_audit_hash,
        }
        audit_hash = hashlib.sha256(
            json.dumps(audit_payload, sort_keys=True, default=str).encode()
        ).hexdigest()

        reconciliation_record = {
            "reconciliation_id": new_id(),
            "terminal_node_id": self._terminal_id,
            "day_close_at": now_utc().isoformat(),
            "synced_transaction_count": synced_count,
            "remaining_queue_size": self._store.queue_size,
            "interaction_count": len(interaction_log),
            "trust_anchor_count": len(trust_anchor_log),
            "participation_summary": participation_summary,
            "participation_audit_hash": participation_audit_hash,
            "audit_hash": audit_hash,
        }

        logger.info(
            "Edge terminal day-close complete",
            extra={
                "reconciliation_id": reconciliation_record["reconciliation_id"],
                "synced": synced_count,
                "interactions": len(interaction_log),
                "trust_anchors": len(trust_anchor_log),
                "terminal": self._terminal_id,
            },
        )
        return reconciliation_record
