"""
TransferEngine — executes ValueFlowEvents against the Cognitive Value Ledger.

The TransferEngine is the atomic execution unit of the value flow system.
It ensures that every value transfer is:
  - Idempotent (safe to retry)
  - Atomic (both sides succeed or neither do)
  - Audit-logged (journal entry on both sides)
  - Event-sourced (ValueFlowEvent published to event bus)
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from packages.ledger.ledger_service import LedgerService
from packages.shared.domain import AccountType, new_id, now_utc
from packages.shared.events import ValueFlowEvent
from packages.shared.models import ValueFlowEventORM

logger = logging.getLogger(__name__)


class TransferEngine:
    """
    Executes ValueFlowEvents atomically.

    Guarantees:
      - Idempotency via idempotency_key
      - No partial execution (both sides in one transaction)
      - Ledger entries produced for both debit and credit
      - ValueFlowEventORM persisted for audit
    """

    def __init__(
        self,
        session: AsyncSession,
        ledger: LedgerService,
        event_bus: Optional[Any] = None,
    ) -> None:
        self._session = session
        self._ledger = ledger
        self._event_bus = event_bus

    async def execute(
        self,
        event: ValueFlowEvent,
        time_order_dict: dict,
        from_account_type: AccountType = AccountType.PAYMENT_BALANCE,
        to_account_type: AccountType = AccountType.PAYMENT_BALANCE,
    ) -> Optional[ValueFlowEventORM]:
        """
        Execute a ValueFlowEvent atomically.

        Steps:
          1. Check for existing execution (idempotency)
          2. Apply debit to sender
          3. Apply credit to receiver
          4. Persist ValueFlowEventORM
          5. Publish to event bus
        """
        from sqlalchemy import select

        # Idempotency check
        existing = await self._session.execute(
            select(ValueFlowEventORM).where(
                ValueFlowEventORM.idempotency_key == event.idempotency_key
            )
        )
        existing_orm = existing.scalar_one_or_none()
        if existing_orm is not None:
            logger.warning(
                "Duplicate ValueFlowEvent suppressed",
                extra={"idempotency_key": event.idempotency_key},
            )
            return existing_orm

        # Apply ledger entries
        await self._ledger.apply_value_flow_event(event, time_order_dict)

        # Persist the flow event record
        flow_orm = ValueFlowEventORM(
            flow_id=event.event_id,
            flow_type=event.flow_type,
            from_node_id=event.from_node_id,
            to_node_id=event.to_node_id,
            amount_lifepp=event.amount_lifepp,
            amount_usdt_equivalent=event.amount_usdt_equivalent,
            related_task_id=event.related_task_id,
            related_artifact_id=event.related_artifact_id,
            related_poc_id=event.related_poc_id,
            status="completed",
            idempotency_key=event.idempotency_key,
            spontaneous_time_order=time_order_dict,
            created_at=now_utc(),
            settled_at=now_utc(),
        )
        self._session.add(flow_orm)
        await self._session.flush()

        # Publish to event bus
        if self._event_bus:
            await self._event_bus.publish(event)

        logger.info(
            "ValueFlowEvent executed",
            extra={
                "flow_id": event.event_id,
                "flow_type": event.flow_type,
                "from": event.from_node_id,
                "to": event.to_node_id,
                "amount_lifepp": event.amount_lifepp,
            },
        )
        return flow_orm
