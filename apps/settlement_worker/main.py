"""
Settlement Worker — VirtueWellbeing day-close cron process.

Runs once per day (configurable) to:
  1. Execute the VirtueWellbeing settlement batch
  2. Distribute LIFE++ to contributing agents
  3. Allocate treasury fraction

Deploy as a cron job or a long-running process with asyncio.sleep.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone

from packages.shared.domain import now_utc

logger = logging.getLogger(__name__)
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

DAY_CLOSE_UTC_HOUR = int(os.getenv("DAY_CLOSE_UTC_HOUR", "23"))
DAILY_POOL_LIFEPP = float(os.getenv("DAILY_SETTLEMENT_POOL_LIFEPP", "0.0"))


async def run_once() -> None:
    """Execute one settlement cycle."""
    logger.info("Settlement worker: starting day-close cycle")

    # TODO: Wire up DB session, SettlementService, DayCloseService
    # from packages.shared.db import get_session
    # from packages.settlement import DayCloseService, SettlementService, ReconciliationService
    # from packages.settlement.virtue_wellbeing_distributor import VirtueWellbeingDistributor
    # async with get_session() as session:
    #     settlement = SettlementService(session, VirtueWellbeingDistributor())
    #     reconciliation = ReconciliationService()
    #     day_close = DayCloseService(settlement, reconciliation, DAILY_POOL_LIFEPP)
    #     await day_close.execute_day_close(time_order_dict={})

    logger.info("Settlement worker: day-close cycle complete")


async def main() -> None:
    """Main loop — runs once per day at DAY_CLOSE_UTC_HOUR."""
    logger.info(
        "Settlement worker started",
        extra={"day_close_utc_hour": DAY_CLOSE_UTC_HOUR},
    )
    while True:
        now = datetime.now(tz=timezone.utc)
        if now.hour == DAY_CLOSE_UTC_HOUR and now.minute == 0:
            try:
                await run_once()
            except Exception:
                logger.exception("Settlement worker error in day-close cycle")
        await asyncio.sleep(60)  # Check every minute


if __name__ == "__main__":
    asyncio.run(main())
