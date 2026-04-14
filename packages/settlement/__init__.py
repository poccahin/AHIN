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
from packages.settlement.settlement_service import SettlementService
from packages.settlement.reconciliation_service import ReconciliationService
from packages.settlement.day_close_service import DayCloseService
from packages.settlement.virtue_wellbeing_distributor import VirtueWellbeingDistributor

__all__ = [
    "SettlementService",
    "ReconciliationService",
    "DayCloseService",
    "VirtueWellbeingDistributor",
]
