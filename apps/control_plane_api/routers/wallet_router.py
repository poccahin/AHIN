"""Wallet router — balance queries and value flow operations."""
from __future__ import annotations

from typing import Dict

from fastapi import APIRouter
from packages.shared.domain import LifePPBaseModel

router = APIRouter()


class BalanceResponse(LifePPBaseModel):
    node_id: str
    balances: Dict[str, float]


@router.get("/{node_id}/balances", response_model=BalanceResponse)
async def get_balances(node_id: str) -> BalanceResponse:
    """
    Return all account balances for a node.

    Account types:
      - capital_stake: AHIN admission stake (locked)
      - payment_balance: operational balance
      - contribution_credit: POC-earned credits
      - trust_weight: emergent trust metric
      - settlement_claim: pending settlement
      - locked_participation: locked during active tasks
    """
    # TODO: integrate with WalletService.get_all_balances()
    return BalanceResponse(
        node_id=node_id,
        balances={
            "capital_stake": 0.0,
            "payment_balance": 0.0,
            "contribution_credit": 0.0,
            "trust_weight": 0.0,
            "settlement_claim": 0.0,
            "locked_participation": 0.0,
        },
    )
