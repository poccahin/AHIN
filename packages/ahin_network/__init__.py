"""
packages/ahin_network — Active Hashed Interaction Network implementation.

AHIN is the decentralized interaction substrate of Life++.
Key properties:
  - NO global consensus required
  - Trust emerges from directional interaction records
  - Temporal ordering is interaction-derived (Spontaneous Time Order)
  - Every interaction is hashed and chained for tamper-evidence
"""
from packages.ahin_network.ahin_node import AhinNode
from packages.ahin_network.association_graph import AssociationGraph
from packages.ahin_network.interaction_hasher import InteractionHasher
from packages.ahin_network.local_time_sequencer import LocalTimeSequencer
from packages.ahin_network.trust_weight_model import TrustWeightModel

__all__ = [
    "AhinNode",
    "AssociationGraph",
    "InteractionHasher",
    "LocalTimeSequencer",
    "TrustWeightModel",
]
