"""
AdmissionGate — validates AHIN participation eligibility.

An agent must hold at least the equivalent of 10 USDT in LIFE++
to join AHIN.  This is a *participation threshold*, not a PoS stake.

The AdmissionGate checks:
  1. LIFE++ balance against the USDT-equivalent threshold
  2. That the agent is not already admitted
  3. That the agent is not blocked by policy
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

AHIN_ADMISSION_THRESHOLD_USDT = float(
    os.getenv("AHIN_ADMISSION_THRESHOLD_USDT", "10.0")
)


@dataclass
class AdmissionResult:
    """Result of an AHIN admission evaluation."""

    node_id: str
    is_admitted: bool
    stake_lifepp: float
    usdt_equivalent: float
    threshold_usdt: float
    rejection_reason: Optional[str] = None


class AdmissionGate:
    """
    Evaluates whether a node meets the AHIN admission requirements.

    Requirements:
      - stake_lifepp * lifepp_usdt_price >= 10.0 USDT
      - Node not already admitted
      - Node not blocked by policy
    """

    def __init__(
        self,
        threshold_usdt: float = AHIN_ADMISSION_THRESHOLD_USDT,
    ) -> None:
        self._threshold = threshold_usdt

    def evaluate(
        self,
        node_id: str,
        stake_lifepp: float,
        lifepp_usdt_price: float,
        is_already_admitted: bool = False,
        is_blocked: bool = False,
    ) -> AdmissionResult:
        """
        Evaluate whether a node can be admitted to AHIN.
        """
        usdt_value = stake_lifepp * lifepp_usdt_price
        rejection_reason: Optional[str] = None

        if is_already_admitted:
            rejection_reason = "already_admitted"
        elif is_blocked:
            rejection_reason = "node_blocked_by_policy"
        elif usdt_value < self._threshold:
            rejection_reason = (
                f"insufficient_stake:{usdt_value:.4f}<{self._threshold}"
            )

        is_admitted = rejection_reason is None

        result = AdmissionResult(
            node_id=node_id,
            is_admitted=is_admitted,
            stake_lifepp=stake_lifepp,
            usdt_equivalent=usdt_value,
            threshold_usdt=self._threshold,
            rejection_reason=rejection_reason,
        )

        if is_admitted:
            logger.info(
                "AHIN admission approved",
                extra={
                    "node_id": node_id,
                    "stake_lifepp": stake_lifepp,
                    "usdt_value": usdt_value,
                },
            )
        else:
            logger.warning(
                "AHIN admission denied",
                extra={
                    "node_id": node_id,
                    "reason": rejection_reason,
                },
            )

        return result
