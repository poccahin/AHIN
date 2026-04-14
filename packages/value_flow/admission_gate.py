"""
AdmissionGate — orchestrates the full AHIN admission flow.

Admission is the first act of cognitive-economic participation in AHIN.
An agent must hold at least the equivalent of 10 USDT in LIFE++ to join.

The AdmissionGate brings together:
  - PriceOracle (current LIFE++/USDT rate)
  - WalletService (balance check and stake locking)
  - EventBus (admission events for audit)

This is NOT a generic signup flow.
It is the economic gate that ensures every participant has a meaningful
stake in the network, aligning admission with cognitive commitment.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

from packages.shared.domain import (
    AccountType,
    SpontaneousTimeOrder,
    ValueFlowEventType,
    new_id,
    now_utc,
)
from packages.shared.events import ValueFlowEvent
from packages.value_flow.price_oracle import PriceOracle

logger = logging.getLogger(__name__)

AHIN_ADMISSION_THRESHOLD_USDT = float(
    os.getenv("AHIN_ADMISSION_THRESHOLD_USDT", "10.0")
)


class AdmissionResult:
    """Outcome of an admission attempt."""

    __slots__ = ("admitted", "node_id", "stake_lifepp", "usdt_value", "reason")

    def __init__(
        self,
        admitted: bool,
        node_id: str,
        stake_lifepp: float,
        usdt_value: float,
        reason: str,
    ) -> None:
        self.admitted = admitted
        self.node_id = node_id
        self.stake_lifepp = stake_lifepp
        self.usdt_value = usdt_value
        self.reason = reason


class AdmissionGate:
    """
    Orchestrates the full AHIN admission lifecycle:

      1. Check that the LIFE++ stake meets the 10 USDT equivalent threshold
      2. Verify sufficient payment_balance to fund the stake
      3. Lock the stake (payment_balance → capital_stake)
      4. Emit an ADMISSION_STAKE ValueFlowEvent
      5. Return a deterministic AdmissionResult
    """

    def __init__(
        self,
        wallet_service: Any,
        price_oracle: PriceOracle,
        event_bus: Optional[Any] = None,
        threshold_usdt: float = AHIN_ADMISSION_THRESHOLD_USDT,
    ) -> None:
        self._wallet = wallet_service
        self._oracle = price_oracle
        self._event_bus = event_bus
        self._threshold_usdt = threshold_usdt

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def attempt_admission(
        self,
        node_id: str,
        stake_lifepp: float,
        time_order_dict: dict,
        idempotency_key: Optional[str] = None,
    ) -> AdmissionResult:
        """
        Attempt AHIN admission for a node.

        Returns an AdmissionResult indicating success or failure.
        """
        idem_key = idempotency_key or new_id()
        price = self._oracle.lifepp_usdt
        usdt_value = stake_lifepp * price

        # 1. Threshold check
        if usdt_value < self._threshold_usdt:
            reason = (
                f"Stake {stake_lifepp} LIFE++ "
                f"(≈ {usdt_value:.4f} USDT at {price} USDT/LIFEPP) "
                f"is below the {self._threshold_usdt} USDT threshold"
            )
            logger.warning(
                "AHIN admission denied — insufficient stake value",
                extra={"node_id": node_id, "usdt_value": usdt_value},
            )
            return AdmissionResult(
                admitted=False,
                node_id=node_id,
                stake_lifepp=stake_lifepp,
                usdt_value=usdt_value,
                reason=reason,
            )

        # 2. Balance check
        balance = await self._wallet.get_balance(
            node_id, AccountType.PAYMENT_BALANCE
        )
        if balance < stake_lifepp:
            reason = (
                f"Insufficient payment_balance: "
                f"{balance:.8f} available, {stake_lifepp:.8f} required"
            )
            logger.warning(
                "AHIN admission denied — insufficient balance",
                extra={
                    "node_id": node_id,
                    "balance": balance,
                    "required": stake_lifepp,
                },
            )
            return AdmissionResult(
                admitted=False,
                node_id=node_id,
                stake_lifepp=stake_lifepp,
                usdt_value=usdt_value,
                reason=reason,
            )

        # 3. Lock stake (payment_balance → capital_stake)
        locked = await self._wallet.stake_for_ahin_admission(
            node_id=node_id,
            amount_lifepp=stake_lifepp,
            lifepp_usdt_price=price,
            idempotency_key=idem_key,
            time_order_dict=time_order_dict,
        )
        if not locked:
            return AdmissionResult(
                admitted=False,
                node_id=node_id,
                stake_lifepp=stake_lifepp,
                usdt_value=usdt_value,
                reason="Stake locking failed in WalletService",
            )

        # 4. Emit admission event
        if self._event_bus:
            event = ValueFlowEvent(
                flow_type=ValueFlowEventType.ADMISSION_STAKE,
                from_node_id=node_id,
                to_node_id=None,
                amount_lifepp=stake_lifepp,
                amount_usdt_equivalent=usdt_value,
                idempotency_key=f"{idem_key}:admission_event",
                time_order=time_order_dict,  # type: ignore[arg-type]
            )
            await self._event_bus.publish(event)

        logger.info(
            "AHIN admission granted",
            extra={
                "node_id": node_id,
                "stake_lifepp": stake_lifepp,
                "usdt_value": usdt_value,
            },
        )

        return AdmissionResult(
            admitted=True,
            node_id=node_id,
            stake_lifepp=stake_lifepp,
            usdt_value=usdt_value,
            reason="Admitted to AHIN",
        )

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    def minimum_stake_lifepp(self) -> float:
        """
        Return the minimum LIFE++ stake needed at the current price.

        This is the LIFE++ equivalent of the threshold USDT value.
        """
        return self._oracle.usdt_to_lifepp(self._threshold_usdt)

    @property
    def threshold_usdt(self) -> float:
        """Return the admission threshold in USDT."""
        return self._threshold_usdt
