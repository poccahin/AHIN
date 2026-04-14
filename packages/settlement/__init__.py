"""
packages/settlement — VirtueWellbeing Settlement System.

Settlement in Life++ is NOT a generic payment batch.
It is the structural alignment of moral contribution with welfare outcomes
(德福一致 — Aligned Virtue and Well-being).

Each settlement cycle:
  1. Aggregates POC-validated contribution credits
  2. Computes proportional LIFE++ distribution
  3. Optionally allocates to treasury / public goods
  4. Produces VirtueWellbeingSettlementBatch
  5. Triggers day-close reconciliation
"""
from __future__ import annotations

from typing import TYPE_CHECKING

# VirtueWellbeingDistributor has no heavy dependencies — import eagerly.
from packages.settlement.virtue_wellbeing_distributor import VirtueWellbeingDistributor

# The remaining services depend on SQLAlchemy (via models / ledger).
# Lazy-import them so that lightweight consumers (tests, scripts) do not
# need SQLAlchemy installed.
if TYPE_CHECKING:
    from packages.settlement.day_close_service import DayCloseService
    from packages.settlement.reconciliation_service import ReconciliationService
    from packages.settlement.settlement_service import SettlementService


def __getattr__(name: str):
    if name == "SettlementService":
        from packages.settlement.settlement_service import SettlementService
        return SettlementService
    if name == "ReconciliationService":
        from packages.settlement.reconciliation_service import ReconciliationService
        return ReconciliationService
    if name == "DayCloseService":
        from packages.settlement.day_close_service import DayCloseService
        return DayCloseService
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "SettlementService",
    "ReconciliationService",
    "DayCloseService",
    "VirtueWellbeingDistributor",
]
