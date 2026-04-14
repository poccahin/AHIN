"""
CollaborationCostEngine — end-to-end micro-usage cost for collaboration.

Each collaboration interaction in AHIN consumes a micro-usage fee:
  min{LIFE++ equivalent of 0.00001 USDT, 1 LIFE++}

This engine orchestrates:
  1. Cost computation from the PriceOracle
  2. Balance check (anti-spam: no balance → no collaboration)
  3. Deduction from payer's payment_balance
  4. Credit to receiver's payment_balance (if peer-to-peer)
  5. ValueFlowEvent emission for audit

This is NOT a gas fee.
It is a cognitive-economic friction that ensures every collaboration
interaction carries meaningful commitment, not spam.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

from packages.shared.domain import (
    AccountType,
    ValueFlowEventType,
    new_id,
    now_utc,
)
from packages.shared.events import ValueFlowEvent
from packages.value_flow.price_oracle import PriceOracle

logger = logging.getLogger(__name__)

COLLABORATION_COST_USDT = float(
    os.getenv("COLLABORATION_COST_USDT", "0.00001")
)
COLLABORATION_COST_MAX_LIFEPP = float(
    os.getenv("COLLABORATION_COST_MAX_LIFEPP", "1.0")
)


class CollaborationCostResult:
    """Outcome of a collaboration cost deduction."""

    __slots__ = (
        "success",
        "cost_lifepp",
        "cost_usdt_equivalent",
        "from_node_id",
        "to_node_id",
        "reason",
    )

    def __init__(
        self,
        success: bool,
        cost_lifepp: float,
        cost_usdt_equivalent: float,
        from_node_id: str,
        to_node_id: Optional[str],
        reason: str,
    ) -> None:
        self.success = success
        self.cost_lifepp = cost_lifepp
        self.cost_usdt_equivalent = cost_usdt_equivalent
        self.from_node_id = from_node_id
        self.to_node_id = to_node_id
        self.reason = reason


class CollaborationCostEngine:
    """
    Orchestrates per-interaction micro-usage cost in the AHIN value flow.

    The cost formula is:
        cost = min(0.00001 USDT ÷ lifepp_usdt_price, 1 LIFE++)

    If the payer has insufficient balance, the collaboration is rejected
    (this is an anti-spam / anti-zombie constraint).
    """

    def __init__(
        self,
        wallet_service: Any,
        price_oracle: PriceOracle,
        event_bus: Optional[Any] = None,
        cost_usdt: float = COLLABORATION_COST_USDT,
        cost_max_lifepp: float = COLLABORATION_COST_MAX_LIFEPP,
    ) -> None:
        self._wallet = wallet_service
        self._oracle = price_oracle
        self._event_bus = event_bus
        self._cost_usdt = cost_usdt
        self._cost_max_lifepp = cost_max_lifepp

    # ------------------------------------------------------------------
    # Cost computation (pure)
    # ------------------------------------------------------------------

    def compute_cost(self, lifepp_usdt_price: Optional[float] = None) -> float:
        """
        Compute the collaboration micro-usage cost in LIFE++.

        Formula: min(0.00001 USDT / price, 1 LIFE++)
        """
        price = lifepp_usdt_price or self._oracle.lifepp_usdt
        if price <= 0:
            return self._cost_max_lifepp
        lifepp_equiv = self._cost_usdt / price
        return min(lifepp_equiv, self._cost_max_lifepp)

    # ------------------------------------------------------------------
    # Deduction lifecycle
    # ------------------------------------------------------------------

    async def charge_collaboration(
        self,
        from_node_id: str,
        to_node_id: Optional[str],
        task_id: Optional[str],
        time_order_dict: dict,
        idempotency_key: Optional[str] = None,
        artifact_id: Optional[str] = None,
        poc_id: Optional[str] = None,
    ) -> CollaborationCostResult:
        """
        Deduct the collaboration micro-cost from the payer.

        Steps:
          1. Compute cost at current price
          2. Check payer balance
          3. Debit payer payment_balance
          4. Optionally credit receiver payment_balance
          5. Emit COLLABORATION_COST ValueFlowEvent
        """
        idem_key = idempotency_key or new_id()
        price = self._oracle.lifepp_usdt
        cost = self.compute_cost(price)
        usdt_equiv = cost * price

        # Balance check
        balance = await self._wallet.get_balance(
            from_node_id, AccountType.PAYMENT_BALANCE
        )
        if balance < cost:
            reason = (
                f"Insufficient balance for collaboration: "
                f"{balance:.8f} available, {cost:.8f} required"
            )
            logger.warning(
                "Collaboration denied — insufficient balance (anti-spam)",
                extra={
                    "from_node_id": from_node_id,
                    "balance": balance,
                    "cost": cost,
                },
            )
            return CollaborationCostResult(
                success=False,
                cost_lifepp=cost,
                cost_usdt_equivalent=usdt_equiv,
                from_node_id=from_node_id,
                to_node_id=to_node_id,
                reason=reason,
            )

        # Debit payer
        await self._wallet.debit(
            node_id=from_node_id,
            amount_lifepp=cost,
            account_type=AccountType.PAYMENT_BALANCE,
            event_type=ValueFlowEventType.COLLABORATION_COST,
            idempotency_key=f"{idem_key}:collab_debit",
            time_order_dict=time_order_dict,
            memo="Collaboration micro-usage cost",
        )

        # Credit receiver (if specified)
        if to_node_id:
            await self._wallet.credit(
                node_id=to_node_id,
                amount_lifepp=cost,
                account_type=AccountType.PAYMENT_BALANCE,
                event_type=ValueFlowEventType.COLLABORATION_COST,
                idempotency_key=f"{idem_key}:collab_credit",
                time_order_dict=time_order_dict,
                memo="Collaboration micro-usage income",
            )

        # Emit event
        if self._event_bus:
            event = ValueFlowEvent(
                flow_type=ValueFlowEventType.COLLABORATION_COST,
                from_node_id=from_node_id,
                to_node_id=to_node_id,
                amount_lifepp=cost,
                amount_usdt_equivalent=usdt_equiv,
                related_task_id=task_id,
                related_artifact_id=artifact_id,
                related_poc_id=poc_id,
                idempotency_key=f"{idem_key}:collab_event",
                time_order=time_order_dict,  # type: ignore[arg-type]
            )
            await self._event_bus.publish(event)

        logger.info(
            "Collaboration cost charged",
            extra={
                "from": from_node_id,
                "to": to_node_id,
                "cost_lifepp": cost,
                "usdt_equiv": usdt_equiv,
            },
        )

        return CollaborationCostResult(
            success=True,
            cost_lifepp=cost,
            cost_usdt_equivalent=usdt_equiv,
            from_node_id=from_node_id,
            to_node_id=to_node_id,
            reason="Collaboration cost deducted",
        )
