"""
LedgerService — append-only Cognitive Value Ledger.

Implements strict double-entry bookkeeping semantics:
  - Every debit has a corresponding credit
  - Balances are computed by summing JournalEntry rows
  - No balance field is ever mutated directly

Account types are separate (capital_stake, payment_balance,
contribution_credit, trust_weight, settlement_claim, locked_participation).
"""
from __future__ import annotations

import logging
from typing import Dict, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from packages.shared.domain import AccountType, ValueFlowEventType, new_id, now_utc
from packages.shared.events import ValueFlowEvent
from packages.shared.models import JournalEntryORM, WalletAccountORM

logger = logging.getLogger(__name__)


class LedgerService:
    """
    The Cognitive Value Ledger service.

    All balance mutations MUST go through this service.
    Direct database writes to journal_entry are forbidden.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ------------------------------------------------------------------
    # Account management
    # ------------------------------------------------------------------

    async def get_or_create_account(
        self,
        node_id: str,
        account_type: AccountType,
        currency: str = "LIFEPP",
    ) -> WalletAccountORM:
        """Return an existing account or create a new one."""
        result = await self._session.execute(
            select(WalletAccountORM).where(
                WalletAccountORM.node_id == node_id,
                WalletAccountORM.account_type == account_type.value,
                WalletAccountORM.currency == currency,
            )
        )
        account = result.scalar_one_or_none()
        if account is None:
            account = WalletAccountORM(
                account_id=new_id(),
                node_id=node_id,
                account_type=account_type.value,
                currency=currency,
            )
            self._session.add(account)
            await self._session.flush()
            logger.info(
                "Wallet account created",
                extra={
                    "node_id": node_id,
                    "account_type": account_type.value,
                    "currency": currency,
                },
            )
        return account

    # ------------------------------------------------------------------
    # Balance queries
    # ------------------------------------------------------------------

    async def get_balance(
        self,
        node_id: str,
        account_type: AccountType,
        currency: str = "LIFEPP",
    ) -> float:
        """
        Compute the current balance by summing journal entries.

        NEVER reads a balance column — always derived from entries.
        """
        account = await self.get_or_create_account(node_id, account_type, currency)
        result = await self._session.execute(
            select(func.coalesce(func.sum(JournalEntryORM.amount), 0.0)).where(
                JournalEntryORM.account_id == account.account_id
            )
        )
        balance: float = result.scalar_one()
        return balance

    async def get_all_balances(
        self, node_id: str, currency: str = "LIFEPP"
    ) -> Dict[str, float]:
        """Return all account balances for a node."""
        balances = {}
        for account_type in AccountType:
            balance = await self.get_balance(node_id, account_type, currency)
            balances[account_type.value] = balance
        return balances

    # ------------------------------------------------------------------
    # Ledger entries
    # ------------------------------------------------------------------

    async def record_entry(
        self,
        node_id: str,
        account_type: AccountType,
        event_type: str,
        amount: float,
        idempotency_key: str,
        time_order_dict: dict,
        memo: Optional[str] = None,
        related_artifact_id: Optional[str] = None,
        related_poc_id: Optional[str] = None,
        related_event_id: Optional[str] = None,
        currency: str = "LIFEPP",
    ) -> JournalEntryORM:
        """
        Append a journal entry to the ledger.

        Idempotency: if idempotency_key already exists, the existing entry
        is returned without creating a duplicate (no double-spend).
        """
        # Idempotency check
        existing = await self._session.execute(
            select(JournalEntryORM).where(
                JournalEntryORM.idempotency_key == idempotency_key
            )
        )
        existing_entry = existing.scalar_one_or_none()
        if existing_entry is not None:
            logger.warning(
                "Duplicate ledger entry suppressed",
                extra={"idempotency_key": idempotency_key},
            )
            return existing_entry

        account = await self.get_or_create_account(node_id, account_type, currency)

        entry = JournalEntryORM(
            entry_id=new_id(),
            account_id=account.account_id,
            node_id=node_id,
            event_type=event_type,
            amount=amount,
            related_artifact_id=related_artifact_id,
            related_poc_id=related_poc_id,
            related_event_id=related_event_id,
            memo=memo,
            idempotency_key=idempotency_key,
            spontaneous_time_order=time_order_dict,
            created_at=now_utc(),
        )
        self._session.add(entry)
        await self._session.flush()
        logger.info(
            "Ledger entry recorded",
            extra={
                "node_id": node_id,
                "account_type": account_type.value,
                "amount": amount,
                "event_type": event_type,
            },
        )
        return entry

    async def apply_value_flow_event(
        self,
        event: ValueFlowEvent,
        time_order_dict: dict,
    ) -> None:
        """
        Apply a ValueFlowEvent to the ledger as a double-entry pair.

        Debit the sender, credit the receiver.
        """
        if event.from_node_id:
            await self.record_entry(
                node_id=event.from_node_id,
                account_type=AccountType.PAYMENT_BALANCE,
                event_type=event.flow_type,
                amount=-event.amount_lifepp,  # debit = negative
                idempotency_key=f"{event.idempotency_key}:debit",
                time_order_dict=time_order_dict,
                related_event_id=event.event_id,
                related_artifact_id=event.related_artifact_id,
                related_poc_id=event.related_poc_id,
            )

        if event.to_node_id:
            await self.record_entry(
                node_id=event.to_node_id,
                account_type=AccountType.PAYMENT_BALANCE,
                event_type=event.flow_type,
                amount=event.amount_lifepp,  # credit = positive
                idempotency_key=f"{event.idempotency_key}:credit",
                time_order_dict=time_order_dict,
                related_event_id=event.event_id,
                related_artifact_id=event.related_artifact_id,
                related_poc_id=event.related_poc_id,
            )
