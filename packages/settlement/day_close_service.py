"""
DayCloseService — end-of-day settlement and reconciliation trigger.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from packages.settlement.reconciliation_service import ReconciliationService
from packages.settlement.settlement_service import SettlementService
from packages.shared.domain import new_id, now_utc

logger = logging.getLogger(__name__)


class DayCloseService:
    """
    Orchestrates the end-of-day close:
      1. Triggers final edge sync for all registered terminals
      2. Runs the VirtueWellbeing settlement batch
      3. Publishes ReconciliationEvent

    Should be scheduled once per UTC day (e.g. cron at 23:59 UTC).
    """

    def __init__(
        self,
        settlement_service: SettlementService,
        reconciliation_service: ReconciliationService,
        total_daily_pool_lifepp: float = 0.0,
    ) -> None:
        self._settlement = settlement_service
        self._reconciliation = reconciliation_service
        self._daily_pool = total_daily_pool_lifepp

    async def execute_day_close(
        self, time_order_dict: dict, pool_override_lifepp: Optional[float] = None
    ) -> None:
        """Run the full day-close sequence."""
        today = now_utc().date()
        period_start = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
        period_end = period_start + timedelta(days=1)
        pool = pool_override_lifepp or self._daily_pool

        logger.info(
            "Day-close sequence started",
            extra={"period_start": period_start.isoformat(), "pool_lifepp": pool},
        )

        if pool > 0:
            batch = await self._settlement.run_settlement_batch(
                period_start=period_start,
                period_end=period_end,
                total_pool_lifepp=pool,
                time_order_dict=time_order_dict,
            )
            logger.info("Day-close settlement batch complete", extra={"batch_id": batch.batch_id})
        else:
            logger.warning("Day-close: pool is zero — skipping settlement")

        logger.info("Day-close sequence complete")
