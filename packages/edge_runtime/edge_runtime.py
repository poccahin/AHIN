"""
EdgeRuntime — the Life++ Lite Edge Terminal runtime orchestrator.

The EdgeRuntime is the top-level coordinator for an edge terminal.
It integrates:
  - PaymentCoordinator (payment acceptance)
  - LocalTransactionStore (offline queue)
  - OfflineSyncManager (deferred sync)
  - AhinNode (AHIN participation)
  - LocalTimeSequencer (Spontaneous Time Order)
  - CognitiveInteractionHandler (local contextual interaction)
  - TrustAnchorService (AHIN trust-anchored events)
  - AgentParticipationTracker (agent collaboration audit)
  - DayCloseHandler (day-end reconciliation)

Per Tactile Brain Hypothesis:
  This device is the embodied locus where user intention meets operational reality.
  Every interaction is a potential cognitive objectification event.

Per Life+ Objectification:
  Intelligence must externalize into durable action, record, and tool-mediated
  coordination.  The terminal produces ObjectificationReceipts, trust anchors,
  and participation records — all durable structures.

Per AHIN:
  Local directional interactions become trust anchors.
  Coordination does NOT rely solely on global consensus.
  Temporal ordering via Spontaneous Time Order (hash-chained, local-first).
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from packages.ahin_network.ahin_node import AhinNode
from packages.ahin_network.association_graph import AssociationGraph
from packages.ahin_network.local_time_sequencer import LocalTimeSequencer
from packages.edge_runtime.agent_participation_tracker import AgentParticipationTracker
from packages.edge_runtime.cognitive_interaction_handler import CognitiveInteractionHandler
from packages.edge_runtime.day_close_handler import DayCloseHandler
from packages.edge_runtime.local_transaction_store import LocalTransactionStore
from packages.edge_runtime.offline_sync_manager import OfflineSyncManager
from packages.edge_runtime.payment_coordinator import PaymentCoordinator
from packages.edge_runtime.receipt_proof_service import ReceiptProofService
from packages.edge_runtime.trust_anchor_service import TrustAnchorService
from packages.shared.domain import NodeType, new_id

logger = logging.getLogger(__name__)


class EdgeRuntime:
    """
    Life++ Lite Edge Terminal — embodied cognition, payment, and settlement node.

    This is NOT merely a payment terminal.
    It is an embodied operational node where:
      - user intention is captured in real context
      - local interaction generates grounded cognitive events
      - agent collaboration becomes operationally anchored
      - payment and settlement become part of trust-confirmed action
      - edge interaction contributes to AHIN's spontaneous time order

    Lifecycle:
      1. Initialise with device context
      2. Register as AHIN node (may be offline at boot)
      3. Accept payments and cognitive interactions
      4. Anchor interactions in the AHIN trust graph
      5. Track agent collaboration for POC auditability
      6. Sync offline queue when connectivity restored
      7. Participate in day-close reconciliation
    """

    def __init__(
        self,
        terminal_id: Optional[str] = None,
        merchant_node_id: Optional[str] = None,
        max_queue_size: int = int(os.getenv("EDGE_OFFLINE_QUEUE_MAX_SIZE", "10000")),
        transfer_engine: Optional[Any] = None,
        sync_fn: Optional[Any] = None,
        association_graph: Optional[AssociationGraph] = None,
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

        # Cognitive interaction handler (Tactile Brain Hypothesis)
        self._interaction_handler = CognitiveInteractionHandler(
            terminal_node_id=self.terminal_id,
            sequencer=self._sequencer,
        )

        # AHIN trust anchoring
        self._trust_anchor_service = TrustAnchorService(
            terminal_node_id=self.terminal_id,
            ahin_node=self._ahin_node,
            sequencer=self._sequencer,
            association_graph=association_graph,
        )

        # Agent participation audit trail
        self._participation_tracker = AgentParticipationTracker(
            terminal_node_id=self.terminal_id,
        )

        if sync_fn:
            self._sync_manager = OfflineSyncManager(
                store=self._store, sync_fn=sync_fn
            )
        else:
            self._sync_manager = None

        # Day-close handler
        self._day_close_handler = DayCloseHandler(
            terminal_node_id=self.terminal_id,
            store=self._store,
            sync_manager=self._sync_manager,
            interaction_handler=self._interaction_handler,
            trust_anchor_service=self._trust_anchor_service,
            participation_tracker=self._participation_tracker,
        )

        logger.info(
            "EdgeRuntime initialised",
            extra={"terminal_id": self.terminal_id, "merchant": merchant_node_id},
        )

    # ------------------------------------------------------------------
    # AHIN admission
    # ------------------------------------------------------------------

    def set_admitted(self, stake_lifepp: float) -> None:
        """Mark this terminal as admitted to AHIN with the given stake."""
        self._ahin_node.set_admitted(stake_lifepp)

    @property
    def is_admitted(self) -> bool:
        return self._ahin_node.is_admitted

    # ------------------------------------------------------------------
    # Cognitive interaction (Tactile Brain Hypothesis)
    # ------------------------------------------------------------------

    def capture_interaction(
        self,
        interaction_type: str,
        user_intent: Dict[str, Any],
        device_context: Optional[Dict[str, Any]] = None,
        agent_node_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Capture a local contextual interaction at this edge terminal.

        This is the primary cognitive objectification entry point.
        User intention is captured with operational grounding context.
        """
        return self._interaction_handler.capture_interaction(
            interaction_type=interaction_type,
            user_intent=user_intent,
            device_context=device_context,
            agent_node_ids=agent_node_ids,
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
        device_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Accept a payment at this edge terminal.

        This is a cognitive objectification event:
          user intention → operational interaction → durable receipt

        Also captures the interaction as a grounded cognitive event
        and anchors trust when merchant and customer are provided.
        """
        if not self.merchant_node_id:
            raise ValueError("Edge terminal has no merchant_node_id configured")

        # 1. Capture as cognitive interaction
        interaction = self._interaction_handler.capture_interaction(
            interaction_type="payment_acceptance",
            user_intent=payload,
            device_context=device_context,
            agent_node_ids=None,
        )

        # 2. Process payment
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

        # 3. Anchor trust (if terminal is admitted)
        if self._ahin_node.is_admitted and customer_node_id:
            anchor = self._trust_anchor_service.anchor_interaction(
                responder_node_id=customer_node_id,
                interaction_context={"type": "payment", "receipt_id": receipt.get("receipt_id")},
                trust_delta=0.02,
            )
            receipt["trust_anchor"] = anchor

        receipt["interaction_id"] = interaction.get("interaction_id")

        return receipt

    # ------------------------------------------------------------------
    # Trust anchoring
    # ------------------------------------------------------------------

    def anchor_trust(
        self,
        responder_node_id: str,
        interaction_context: Dict[str, Any],
        trust_delta: float = 0.05,
        task_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a trust-anchored interaction event at this edge terminal."""
        return self._trust_anchor_service.anchor_interaction(
            responder_node_id=responder_node_id,
            interaction_context=interaction_context,
            trust_delta=trust_delta,
            task_id=task_id,
        )

    # ------------------------------------------------------------------
    # Agent participation tracking
    # ------------------------------------------------------------------

    def record_agent_participation(
        self,
        agent_node_id: str,
        interaction_id: str,
        role: str,
        contribution_summary: str,
        grounding_evidence: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Record an agent's participation in an edge terminal interaction."""
        record = self._participation_tracker.record_participation(
            agent_node_id=agent_node_id,
            interaction_id=interaction_id,
            role=role,
            contribution_summary=contribution_summary,
            grounding_evidence=grounding_evidence,
        )
        return record.to_dict()

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
    # Day-close
    # ------------------------------------------------------------------

    async def execute_day_close(self) -> Dict[str, Any]:
        """Execute end-of-day reconciliation at this edge terminal."""
        return await self._day_close_handler.execute_day_close()

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
            "interaction_count": self._interaction_handler.interaction_count,
            "trust_anchor_count": self._trust_anchor_service.anchor_count,
            "agent_participation_count": self._participation_tracker.total_records,
        }
