"""
packages/edge_runtime — Life++ Lite Edge Terminal runtime.

The edge terminal is NOT a simple payment terminal.
It is an embodied cognition, payment, and settlement node.

Per Tactile Brain Hypothesis:
  Cognition must be grounded in resistance, context, and operational interaction.
  The terminal is the physical locus where user intention meets operational reality.

Per Life+ Objectification:
  Intelligence must externalize into durable action, record, and tool-mediated coordination.
  Every terminal transaction IS a cognitive objectification event.

Per AHIN:
  Local directional interactions become trust anchors.
  Even offline transactions contribute to the Spontaneous Time Order.

Per POC:
  Meaningful local execution can become evidence of cognitive contribution.
  Agent participation at the edge is tracked for auditability.
"""
from packages.edge_runtime.agent_participation_tracker import (
    AgentParticipationRecord,
    AgentParticipationTracker,
)
from packages.edge_runtime.cognitive_interaction_handler import CognitiveInteractionHandler
from packages.edge_runtime.day_close_handler import DayCloseHandler
from packages.edge_runtime.edge_runtime import EdgeRuntime
from packages.edge_runtime.local_transaction_store import LocalTransactionStore
from packages.edge_runtime.offline_sync_manager import OfflineSyncManager
from packages.edge_runtime.payment_coordinator import PaymentCoordinator
from packages.edge_runtime.receipt_proof_service import ReceiptProofService
from packages.edge_runtime.trust_anchor_service import TrustAnchorService

__all__ = [
    "AgentParticipationRecord",
    "AgentParticipationTracker",
    "CognitiveInteractionHandler",
    "DayCloseHandler",
    "EdgeRuntime",
    "LocalTransactionStore",
    "OfflineSyncManager",
    "PaymentCoordinator",
    "ReceiptProofService",
    "TrustAnchorService",
]
