"""
VirtueWellbeingDistributor — distributes LIFE++ aligned with 德福一致.

This component computes the proportional distribution of LIFE++ to
each contributing agent based on their validated cognitive contribution
credits (from POCRecords).

This is the ethical core of the settlement system:
  contribution → credit → aligned distribution → well-being
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Fraction of settlement pool allocated to public goods treasury
_TREASURY_FRACTION = 0.05  # 5%


class VirtueWellbeingDistributor:
    """
    Computes proportional LIFE++ distribution from a settlement pool.

    Distribution is proportional to contribution credit (not capital stake).
    This implements the POC-aligned incentive structure.
    """

    def __init__(self, treasury_fraction: float = _TREASURY_FRACTION) -> None:
        if not 0.0 <= treasury_fraction < 1.0:
            raise ValueError("treasury_fraction must be in [0, 1)")
        self._treasury_fraction = treasury_fraction

    def compute_distribution(
        self,
        contribution_credits: Dict[str, float],  # {node_id: credit}
        total_pool_lifepp: float,
    ) -> Tuple[Dict[str, float], float]:
        """
        Compute how much LIFE++ each node receives from the settlement pool.

        Returns:
          - distributions: {node_id: lifepp_amount}
          - treasury_amount: LIFE++ allocated to treasury

        Rules:
          - Treasury gets treasury_fraction of total_pool
          - Remaining pool is distributed proportionally to contribution credit
          - Nodes with zero credit receive nothing
        """
        treasury_amount = total_pool_lifepp * self._treasury_fraction
        distributable = total_pool_lifepp - treasury_amount

        total_credit = sum(contribution_credits.values())
        if total_credit <= 0:
            logger.warning("No contribution credits — nothing to distribute")
            return {}, treasury_amount

        distributions: Dict[str, float] = {}
        for node_id, credit in contribution_credits.items():
            if credit > 0:
                share = credit / total_credit
                distributions[node_id] = round(distributable * share, 8)

        total_distributed = sum(distributions.values())
        logger.info(
            "VirtueWellbeing distribution computed",
            extra={
                "participants": len(distributions),
                "total_pool": total_pool_lifepp,
                "distributed": total_distributed,
                "treasury": treasury_amount,
            },
        )
        return distributions, treasury_amount
