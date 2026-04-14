"""
SettlementService — orchestrates VirtueWellbeing settlement batches.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from packages.settlement.virtue_wellbeing_distributor import VirtueWellbeingDistributor
from packages.shared.domain import AccountType, new_id, now_utc
from packages.shared.events import SettlementEvent
from packages.shared.models import (
    JournalEntryORM,
    POCRecordORM,
    VirtueWellbeingSettlementBatchORM,
)

logger = logging.getLogger(__name__)


class SettlementService:
    """
    Creates and executes VirtueWellbeing settlement batches.

    A batch covers all POC-validated contributions in a time period
    and distributes LIFE++ proportionally.
    """

    def __init__(
        self,
        session: AsyncSession,
        distributor: Optional[VirtueWellbeingDistributor] = None,
        ledger_service: Optional[Any] = None,
        event_bus: Optional[Any] = None,
    ) -> None:
        self._session = session
        self._distributor = distributor or VirtueWellbeingDistributor()
        self._ledger = ledger_service
        self._event_bus = event_bus

    async def run_settlement_batch(
        self,
        period_start: datetime,
        period_end: datetime,
        total_pool_lifepp: float,
        time_order_dict: dict,
    ) -> VirtueWellbeingSettlementBatchORM:
        """
        Execute a full settlement batch for the given period.

        Steps:
          1. Collect all validated POC records in the period
          2. Aggregate contribution credits per node
          3. Compute distribution
          4. Write journal entries for each payout
          5. Persist batch record with audit hash
          6. Publish SettlementEvents
        """
        # 1. Collect POC records
        poc_result = await self._session.execute(
            select(POCRecordORM).where(
                POCRecordORM.created_at >= period_start,
                POCRecordORM.created_at < period_end,
                POCRecordORM.is_zombie_output == False,  # noqa: E712
            )
        )
        poc_records: List[POCRecordORM] = list(poc_result.scalars().all())

        # 2. Aggregate credits
        contribution_credits: Dict[str, float] = {}
        for poc in poc_records:
            contribution_credits[poc.producer_node_id] = (
                contribution_credits.get(poc.producer_node_id, 0.0)
                + poc.cognitive_score
            )

        # 3. Distribution
        distributions, treasury_amount = self._distributor.compute_distribution(
            contribution_credits, total_pool_lifepp
        )

        # 4. Journal entries
        if self._ledger:
            for node_id, amount in distributions.items():
                if amount > 0:
                    await self._ledger.record_entry(
                        node_id=node_id,
                        account_type=AccountType.CONTRIBUTION_CREDIT,
                        event_type="virtue_wellbeing_distribution",
                        amount=amount,
                        idempotency_key=f"settlement:{period_start.date()}:{node_id}",
                        time_order_dict=time_order_dict,
                        memo=f"VirtueWellbeing settlement {period_start.date()}",
                    )

        # 5. Compute audit hash
        audit_data = json.dumps(
            {
                "period_start": period_start.isoformat(),
                "period_end": period_end.isoformat(),
                "distributions": distributions,
                "treasury": treasury_amount,
                "poc_count": len(poc_records),
            },
            sort_keys=True,
        )
        audit_hash = hashlib.sha256(audit_data.encode()).hexdigest()

        batch = VirtueWellbeingSettlementBatchORM(
            batch_id=new_id(),
            period_start=period_start,
            period_end=period_end,
            status="closed",
            total_contribution_credits=sum(contribution_credits.values()),
            total_lifepp_distributed=sum(distributions.values()),
            treasury_allocation_lifepp=treasury_amount,
            participant_count=len(distributions),
            settlement_entries={"distributions": distributions, "treasury": treasury_amount},
            audit_hash=audit_hash,
            created_at=now_utc(),
            closed_at=now_utc(),
        )
        self._session.add(batch)
        await self._session.flush()

        # 6. Publish events
        if self._event_bus:
            for node_id, amount in distributions.items():
                poc_ids = [p.poc_id for p in poc_records if p.producer_node_id == node_id]
                event = SettlementEvent(
                    batch_id=batch.batch_id,
                    recipient_node_id=node_id,
                    contribution_credit=contribution_credits.get(node_id, 0.0),
                    lifepp_awarded=amount,
                    poc_ids=poc_ids,
                    period_start=period_start,
                    period_end=period_end,
                    time_order=time_order_dict,  # type: ignore[arg-type]
                )
                await self._event_bus.publish(event)

        logger.info(
            "Settlement batch completed",
            extra={
                "batch_id": batch.batch_id,
                "participants": batch.participant_count,
                "total_distributed": batch.total_lifepp_distributed,
                "treasury": treasury_amount,
            },
        )
        return batch
