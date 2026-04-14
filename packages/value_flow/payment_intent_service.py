"""
PaymentIntentService — creates and manages payment intents for LIFE++ flows.

A payment intent captures the user's intention to transfer value BEFORE
the transfer is executed.  This two-phase approach enables:
  - Pre-authorization checks (balance, policy, anti-spam)
  - Atomic execution
  - Idempotent retry
  - Audit trail from intent to settlement
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

from packages.shared.domain import ValueFlowEventType, new_id, now_utc
from packages.shared.events import ValueFlowEvent

logger = logging.getLogger(__name__)

COLLABORATION_COST_USDT = float(os.getenv("COLLABORATION_COST_USDT", "0.00001"))
COLLABORATION_COST_MAX_LIFEPP = float(
    os.getenv("COLLABORATION_COST_MAX_LIFEPP", "1.0")
)


class PaymentIntentService:
    """
    Creates and validates PaymentIntents before executing ValueFlowEvents.

    Anti-spam / anti-zombie constraints:
      - Rate limiting per node (TODO: Redis-backed in production)
      - Minimum balance check before intent creation
      - Policy engine integration for large flows
    """

    def __init__(
        self,
        wallet_service: Any,
        event_bus: Optional[Any] = None,
    ) -> None:
        self._wallet = wallet_service
        self._event_bus = event_bus
        self._pending_intents: Dict[str, Dict] = {}

    def compute_collaboration_cost(self, lifepp_usdt_price: float) -> float:
        """
        Cost per collaboration interaction:
          min{0.00001 USDT equivalent in LIFE++, 1 LIFE++}
        """
        if lifepp_usdt_price <= 0:
            return COLLABORATION_COST_MAX_LIFEPP
        lifepp_equiv = COLLABORATION_COST_USDT / lifepp_usdt_price
        return min(lifepp_equiv, COLLABORATION_COST_MAX_LIFEPP)

    async def create_collaboration_intent(
        self,
        from_node_id: str,
        to_node_id: str,
        task_id: str,
        lifepp_usdt_price: float,
        time_order_dict: dict,
        artifact_id: Optional[str] = None,
        poc_id: Optional[str] = None,
    ) -> Optional[ValueFlowEvent]:
        """
        Create a collaboration micro-payment intent.

        Returns a ValueFlowEvent that can be passed to TransferEngine.execute().
        """
        amount = self.compute_collaboration_cost(lifepp_usdt_price)

        # Anti-spam: check balance before creating intent
        from packages.shared.domain import AccountType
        balance = await self._wallet.get_balance(from_node_id, AccountType.PAYMENT_BALANCE)
        if balance < amount:
            logger.warning(
                "Insufficient balance for collaboration — intent rejected",
                extra={
                    "from_node_id": from_node_id,
                    "required": amount,
                    "available": balance,
                },
            )
            return None

        idempotency_key = new_id()
        event = ValueFlowEvent(
            flow_type=ValueFlowEventType.COLLABORATION_COST,
            from_node_id=from_node_id,
            to_node_id=to_node_id,
            amount_lifepp=amount,
            amount_usdt_equivalent=amount * lifepp_usdt_price,
            related_task_id=task_id,
            related_artifact_id=artifact_id,
            related_poc_id=poc_id,
            idempotency_key=idempotency_key,
            time_order=time_order_dict,  # type: ignore[arg-type]
        )

        self._pending_intents[idempotency_key] = {
            "event": event,
            "created_at": now_utc().isoformat(),
            "status": "pending",
        }

        logger.info(
            "Collaboration intent created",
            extra={
                "from": from_node_id,
                "to": to_node_id,
                "amount_lifepp": amount,
                "idempotency_key": idempotency_key,
            },
        )
        return event

    def get_intent_status(self, idempotency_key: str) -> Optional[str]:
        """Return the status of a pending intent."""
        intent = self._pending_intents.get(idempotency_key)
        return intent["status"] if intent else None
