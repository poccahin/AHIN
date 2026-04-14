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
"""
from packages.edge_runtime.edge_runtime import EdgeRuntime
from packages.edge_runtime.local_transaction_store import LocalTransactionStore
from packages.edge_runtime.offline_sync_manager import OfflineSyncManager
from packages.edge_runtime.payment_coordinator import PaymentCoordinator
from packages.edge_runtime.receipt_proof_service import ReceiptProofService

__all__ = [
    "EdgeRuntime",
    "LocalTransactionStore",
    "OfflineSyncManager",
    "PaymentCoordinator",
    "ReceiptProofService",
]
