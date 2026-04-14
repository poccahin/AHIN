"""
TreasuryService — manages the LIFE++ treasury allocation.

The treasury receives a fraction of each settlement batch
for public goods, governance, and system sustainability.

This is the fiscal mechanism aligned with Virtue and Well-being:
  - Treasury funds are NOT discretionary
  - They must be allocated to cognitive-economic public goods
  - Allocation decisions are auditable
"""
from __future__ import annotations

import logging
import os
from typing import Dict, List

logger = logging.getLogger(__name__)

_DEFAULT_TREASURY_FRACTION = float(
    os.getenv("TREASURY_FRACTION", "0.05")
)

_TREASURY_NODE_ID = "treasury:system"


class TreasuryService:
    """
    Manages the LIFE++ treasury — the public goods fund.

    The treasury receives a configurable fraction (default 5%) of each
    settlement batch.  Funds are tracked as journal entries against
    the treasury node.
    """

    def __init__(
        self,
        treasury_fraction: float = _DEFAULT_TREASURY_FRACTION,
        treasury_node_id: str = _TREASURY_NODE_ID,
    ) -> None:
        if not (0.0 <= treasury_fraction <= 1.0):
            raise ValueError(
                f"Treasury fraction must be in [0, 1], got {treasury_fraction}"
            )
        self._fraction = treasury_fraction
        self._node_id = treasury_node_id
        self._allocations: List[Dict] = []
        self._total_allocated: float = 0.0

    @property
    def treasury_node_id(self) -> str:
        """The system-level treasury node identifier."""
        return self._node_id

    @property
    def treasury_fraction(self) -> float:
        """Fraction of each settlement batch allocated to treasury."""
        return self._fraction

    def compute_treasury_amount(self, total_pool_lifepp: float) -> float:
        """Compute the treasury's share of a settlement pool."""
        return total_pool_lifepp * self._fraction

    def record_allocation(
        self,
        batch_id: str,
        amount_lifepp: float,
        purpose: str = "settlement_treasury",
    ) -> Dict:
        """Record a treasury allocation from a settlement batch."""
        allocation = {
            "batch_id": batch_id,
            "amount_lifepp": amount_lifepp,
            "purpose": purpose,
            "treasury_node_id": self._node_id,
        }
        self._allocations.append(allocation)
        self._total_allocated += amount_lifepp
        logger.info(
            "Treasury allocation recorded",
            extra={
                "batch_id": batch_id,
                "amount_lifepp": amount_lifepp,
                "total_allocated": self._total_allocated,
            },
        )
        return allocation

    @property
    def total_allocated(self) -> float:
        """Total LIFE++ allocated to treasury across all batches."""
        return self._total_allocated

    @property
    def allocation_count(self) -> int:
        """Number of treasury allocations recorded."""
        return len(self._allocations)
