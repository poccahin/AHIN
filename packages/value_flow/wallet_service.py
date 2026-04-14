"""
WalletService — manages LIFE++ account balances for AHIN participants.

Distinct account types (MUST NOT be collapsed):
  - capital_stake: AHIN admission stake (locked, not spendable)
  - payment_balance: operational spendable balance
  - contribution_credit: POC-earned credits pending settlement
  - trust_weight: dimensionless trust metric (not currency)
  - settlement_claim: pending settlement obligation
  - locked_participation: locked while actively participating in a task
"""
from __future__ import annotations

import logging
import os
from typing import Dict, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from packages.ledger.ledger_service import LedgerService
from packages.shared.domain import AccountType, new_id

logger = logging.getLogger(__name__)

AHIN_ADMISSION_THRESHOLD_USDT = float(
    os.getenv("AHIN_ADMISSION_THRESHOLD_USDT", "10.0")
)


class WalletService:
    """
    High-level wallet operations over the Cognitive Value Ledger.

    All mutations go through LedgerService to maintain the append-only invariant.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._ledger = LedgerService(session)

    async def get_balance(
        self,
        node_id: str,
        account_type: AccountType = AccountType.PAYMENT_BALANCE,
        currency: str = "LIFEPP",
    ) -> float:
        return await self._ledger.get_balance(node_id, account_type, currency)

    async def get_all_balances(
        self, node_id: str, currency: str = "LIFEPP"
    ) -> Dict[str, float]:
        return await self._ledger.get_all_balances(node_id, currency)

    async def credit(
        self,
        node_id: str,
        amount_lifepp: float,
        account_type: AccountType,
        event_type: str,
        idempotency_key: str,
        time_order_dict: dict,
        memo: Optional[str] = None,
        related_artifact_id: Optional[str] = None,
        related_poc_id: Optional[str] = None,
    ) -> None:
        """Credit LIFE++ to a node account (positive journal entry)."""
        if amount_lifepp <= 0:
            raise ValueError(f"Credit amount must be positive, got {amount_lifepp}")
        await self._ledger.record_entry(
            node_id=node_id,
            account_type=account_type,
            event_type=event_type,
            amount=amount_lifepp,
            idempotency_key=idempotency_key,
            time_order_dict=time_order_dict,
            memo=memo,
            related_artifact_id=related_artifact_id,
            related_poc_id=related_poc_id,
        )

    async def debit(
        self,
        node_id: str,
        amount_lifepp: float,
        account_type: AccountType,
        event_type: str,
        idempotency_key: str,
        time_order_dict: dict,
        memo: Optional[str] = None,
    ) -> None:
        """Debit LIFE++ from a node account (negative journal entry)."""
        if amount_lifepp <= 0:
            raise ValueError(f"Debit amount must be positive, got {amount_lifepp}")
        balance = await self.get_balance(node_id, account_type)
        if balance < amount_lifepp:
            raise ValueError(
                f"Insufficient balance: {balance} LIFEPP available, "
                f"{amount_lifepp} requested"
            )
        await self._ledger.record_entry(
            node_id=node_id,
            account_type=account_type,
            event_type=event_type,
            amount=-amount_lifepp,
            idempotency_key=idempotency_key,
            time_order_dict=time_order_dict,
            memo=memo,
        )

    async def stake_for_ahin_admission(
        self,
        node_id: str,
        amount_lifepp: float,
        lifepp_usdt_price: float,
        idempotency_key: str,
        time_order_dict: dict,
    ) -> bool:
        """
        Lock LIFE++ as AHIN admission stake.

        Checks that the USD-equivalent value meets the admission threshold.
        Moves funds from payment_balance → capital_stake (locked).
        """
        usdt_value = amount_lifepp * lifepp_usdt_price
        if usdt_value < AHIN_ADMISSION_THRESHOLD_USDT:
            logger.warning(
                "Admission stake insufficient",
                extra={
                    "node_id": node_id,
                    "usdt_value": usdt_value,
                    "threshold": AHIN_ADMISSION_THRESHOLD_USDT,
                },
            )
            return False

        # Debit payment balance
        await self.debit(
            node_id=node_id,
            amount_lifepp=amount_lifepp,
            account_type=AccountType.PAYMENT_BALANCE,
            event_type="admission_stake_debit",
            idempotency_key=f"{idempotency_key}:payment_debit",
            time_order_dict=time_order_dict,
            memo="AHIN admission stake — locked",
        )

        # Credit capital stake
        await self.credit(
            node_id=node_id,
            amount_lifepp=amount_lifepp,
            account_type=AccountType.CAPITAL_STAKE,
            event_type="admission_stake_credit",
            idempotency_key=f"{idempotency_key}:stake_credit",
            time_order_dict=time_order_dict,
            memo="AHIN admission stake",
        )

        logger.info(
            "AHIN admission stake locked",
            extra={"node_id": node_id, "amount_lifepp": amount_lifepp},
        )
        return True
