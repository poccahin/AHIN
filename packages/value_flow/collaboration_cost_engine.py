"""
CollaborationCostEngine — computes and tracks iterative collaboration costs.

Per the token economics:
  cost = min{LIFE++ equivalent of 0.00001 USDT, 1 LIFE++}

This engine also tracks cumulative costs per task and per node
for audit and risk control purposes.
"""
from __future__ import annotations

import logging
import os
from typing import Dict

logger = logging.getLogger(__name__)

COLLABORATION_COST_USDT = float(
    os.getenv("COLLABORATION_COST_USDT", "0.00001")
)
COLLABORATION_COST_MAX_LIFEPP = float(
    os.getenv("COLLABORATION_COST_MAX_LIFEPP", "1.0")
)


class CollaborationCostEngine:
    """
    Computes micro-usage costs for iterative collaboration interactions.

    Each interaction within a cognitive task consumes a small amount of
    LIFE++, ensuring that participation is meaningful and spam-resistant.
    """

    def __init__(
        self,
        cost_usdt: float = COLLABORATION_COST_USDT,
        max_lifepp: float = COLLABORATION_COST_MAX_LIFEPP,
    ) -> None:
        self._cost_usdt = cost_usdt
        self._max_lifepp = max_lifepp
        # Track cumulative costs per task
        self._task_costs: Dict[str, float] = {}
        # Track cumulative costs per node
        self._node_costs: Dict[str, float] = {}

    def compute_cost(self, lifepp_usdt_price: float) -> float:
        """
        Compute the LIFE++ cost for one collaboration interaction.

        Formula: min{0.00001 USDT / price, 1 LIFE++}
        """
        if lifepp_usdt_price <= 0:
            return self._max_lifepp
        lifepp_equiv = self._cost_usdt / lifepp_usdt_price
        return min(lifepp_equiv, self._max_lifepp)

    def record_cost(
        self, task_id: str, node_id: str, cost_lifepp: float
    ) -> None:
        """Record a collaboration cost for audit tracking."""
        self._task_costs[task_id] = (
            self._task_costs.get(task_id, 0.0) + cost_lifepp
        )
        self._node_costs[node_id] = (
            self._node_costs.get(node_id, 0.0) + cost_lifepp
        )

    def get_task_cumulative_cost(self, task_id: str) -> float:
        """Return total collaboration cost for a task."""
        return self._task_costs.get(task_id, 0.0)

    def get_node_cumulative_cost(self, node_id: str) -> float:
        """Return total collaboration cost for a node."""
        return self._node_costs.get(node_id, 0.0)
