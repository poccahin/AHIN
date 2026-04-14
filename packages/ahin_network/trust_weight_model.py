"""
TrustWeightModel — emergent trust in AHIN.

Trust in AHIN is NOT:
  - A centralised reputation score
  - A PoS-style stake amount
  - A simple rating system

Trust IS:
  - Emergent from the history of directional interactions between nodes
  - Directional (A trusts B ≠ B trusts A)
  - Decaying over time without reinforcing interactions
  - Sensitive to the quality of CanxianArtifacts produced

The TrustWeightModel computes trust weights from AssociationEvent history.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Tuple


class TrustWeightModel:
    """
    Computes and maintains directional trust weights between AHIN nodes.

    Trust weight formula (simplified):
        w(A→B) = sum(delta_i * decay(t_i)) / normalisation

    Where:
        delta_i  = trust delta from interaction i (positive or negative)
        decay(t) = exp(-λ * days_since_interaction)
        λ        = decay rate (configurable, default 0.1)
    """

    DEFAULT_DECAY_RATE = 0.1  # per day
    MAX_TRUST_WEIGHT = 1.0

    def __init__(self, decay_rate: float = DEFAULT_DECAY_RATE) -> None:
        self._decay_rate = decay_rate
        # {(from_node, to_node): [(delta, days_ago), ...]}
        self._interaction_log: Dict[Tuple[str, str], List[Tuple[float, float]]] = {}

    def record_interaction(
        self,
        from_node_id: str,
        to_node_id: str,
        trust_delta: float,
        days_ago: float = 0.0,
    ) -> None:
        """
        Record a trust-affecting interaction.

        trust_delta > 0: reinforcing (successful collaboration, valid artifact)
        trust_delta < 0: degrading (failed delivery, zombie output detected)
        """
        key = (from_node_id, to_node_id)
        self._interaction_log.setdefault(key, [])
        self._interaction_log[key].append((trust_delta, days_ago))

    def get_trust_weight(self, from_node_id: str, to_node_id: str) -> float:
        """
        Compute the current trust weight from from_node_id to to_node_id.

        Returns a value in [0, MAX_TRUST_WEIGHT].
        """
        key = (from_node_id, to_node_id)
        if key not in self._interaction_log:
            return 0.0
        records = self._interaction_log[key]
        raw_weight = sum(
            delta * math.exp(-self._decay_rate * days)
            for delta, days in records
        )
        # Clamp to [0, MAX_TRUST_WEIGHT]
        return max(0.0, min(raw_weight, self.MAX_TRUST_WEIGHT))

    def get_all_weights_from(self, from_node_id: str) -> Dict[str, float]:
        """Return all directional trust weights from a given node."""
        result = {}
        for (f, t), _ in self._interaction_log.items():
            if f == from_node_id:
                result[t] = self.get_trust_weight(f, t)
        return result

    def degrade_trust(self, from_node_id: str, to_node_id: str, penalty: float) -> None:
        """Apply an immediate trust penalty (e.g. zombie output detected)."""
        self.record_interaction(from_node_id, to_node_id, -abs(penalty))

    def revoke_trust(self, from_node_id: str, to_node_id: str) -> None:
        """Completely reset trust (e.g. policy violation)."""
        key = (from_node_id, to_node_id)
        self._interaction_log[key] = [(-self.MAX_TRUST_WEIGHT, 0.0)]
