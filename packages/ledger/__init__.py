"""
packages/ledger — Cognitive Value Ledger (append-only).

The ledger is NOT a generic accounting database.
It is the cognitive-economic audit trail of Life++.

Rules (STRICT):
  - Append-only: no UPDATE or DELETE on journal_entry rows
  - Balances derived from summing entries (never stored separately)
  - Every system action maps to journal entries
  - Idempotency key ensures retry-safety and no double-spend
  - All entries are POC-linkable for VirtueWellbeing settlement
"""
from packages.ledger.ledger_service import LedgerService
from packages.ledger.poc_service import POCService

__all__ = ["LedgerService", "POCService"]
