"""
CognitiveValueFlowSystem — the top-level facade for the LIFE++ value layer.

This is the machine-native Cognitive Value Flow System of Life++, aligned
with Prof. Cai Hengjin's framework.

It is NOT a generic payment system.
It is a cognitive-economic accounting and settlement architecture that
unifies all value-flow components into a single coherent interface:

  1. Admission threshold into AHIN (AdmissionGate)
  2. Collaboration activation cost (CollaborationCostEngine)
  3. Agent-to-agent micro-payment (TransferEngine)
  4. Cognitive contribution accounting (POCService + LedgerService)
  5. POC-linked value attribution (SettlementService)
  6. Merchant/service settlement (MerchantSettlementService)
  7. Treasury and public-good allocation (TreasuryService)
  8. Anti-spam and anti-zombie constraints (AntiSpamPolicy)

Design principles:
  - LIFE++ is a scarce coordination asset on Solana (fixed supply, no inflation)
  - Distinct account types: capital_stake, payment_balance, contribution_credit,
    trust_weight, settlement_claim, locked_participation
  - NOT Proof of Work or Proof of Stake — hybrid operational ledger supporting
    Proof of Cognitive Canxian and meaningful collaboration records
  - All mutations are append-only journal entries (never UPDATE/DELETE)
  - All actions emit events for audit replay
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from packages.policy_engine.anti_spam_policy import AntiSpamPolicy
from packages.shared.domain import AccountType, ValueFlowEventType, new_id
from packages.shared.events import ValueFlowEvent
from packages.value_flow.admission_gate import AdmissionGate, AdmissionResult
from packages.value_flow.collaboration_cost_engine import (
    CollaborationCostEngine,
    CollaborationCostResult,
)
from packages.value_flow.merchant_settlement_service import (
    MerchantSettlementResult,
    MerchantSettlementService,
)
from packages.value_flow.price_oracle import PriceOracle
from packages.value_flow.treasury_service import TreasuryService

logger = logging.getLogger(__name__)


class CognitiveValueFlowSystem:
    """
    Unified facade for the LIFE++ Cognitive Value Flow System.

    Provides a single entry point for all value-flow operations while
    maintaining the conceptual separation of the underlying components.

    Account type distinctions enforced by this system:
      - capital_stake: AHIN admission deposit (locked, not spendable)
      - payment_balance: operational spendable LIFE++
      - contribution_credit: POC-earned credits (settled by VirtueWellbeing)
      - trust_weight: directional trust metric (dimensionless, not currency)
      - settlement_claim: pending settlement obligations
      - locked_participation: locked during active task execution
    """

    def __init__(
        self,
        wallet_service: Any,
        price_oracle: PriceOracle,
        event_bus: Optional[Any] = None,
        transfer_engine: Optional[Any] = None,
        anti_spam_policy: Optional[AntiSpamPolicy] = None,
    ) -> None:
        self._wallet = wallet_service
        self._oracle = price_oracle
        self._event_bus = event_bus
        self._transfer_engine = transfer_engine

        # Sub-systems
        self._admission = AdmissionGate(
            wallet_service=wallet_service,
            price_oracle=price_oracle,
            event_bus=event_bus,
        )
        self._collaboration = CollaborationCostEngine(
            wallet_service=wallet_service,
            price_oracle=price_oracle,
            event_bus=event_bus,
        )
        self._merchant = MerchantSettlementService(
            wallet_service=wallet_service,
            event_bus=event_bus,
        )
        self._treasury = TreasuryService(
            wallet_service=wallet_service,
            event_bus=event_bus,
        )
        self._anti_spam = anti_spam_policy or AntiSpamPolicy()

        logger.info("CognitiveValueFlowSystem initialised")

    # ------------------------------------------------------------------
    # Component accessors (for direct sub-system interaction)
    # ------------------------------------------------------------------

    @property
    def admission_gate(self) -> AdmissionGate:
        """Return the AdmissionGate sub-system."""
        return self._admission

    @property
    def collaboration_engine(self) -> CollaborationCostEngine:
        """Return the CollaborationCostEngine sub-system."""
        return self._collaboration

    @property
    def merchant_settlement(self) -> MerchantSettlementService:
        """Return the MerchantSettlementService sub-system."""
        return self._merchant

    @property
    def treasury(self) -> TreasuryService:
        """Return the TreasuryService sub-system."""
        return self._treasury

    @property
    def anti_spam(self) -> AntiSpamPolicy:
        """Return the AntiSpamPolicy sub-system."""
        return self._anti_spam

    @property
    def price_oracle(self) -> PriceOracle:
        """Return the PriceOracle."""
        return self._oracle

    # ------------------------------------------------------------------
    # 1. Admission
    # ------------------------------------------------------------------

    async def admit_to_ahin(
        self,
        node_id: str,
        stake_lifepp: float,
        time_order_dict: dict,
        idempotency_key: Optional[str] = None,
    ) -> AdmissionResult:
        """
        Attempt to admit a node to AHIN.

        Requires stake ≥ 10 USDT equivalent in LIFE++.
        """
        return await self._admission.attempt_admission(
            node_id=node_id,
            stake_lifepp=stake_lifepp,
            time_order_dict=time_order_dict,
            idempotency_key=idempotency_key,
        )

    # ------------------------------------------------------------------
    # 2. Collaboration cost
    # ------------------------------------------------------------------

    async def charge_collaboration(
        self,
        from_node_id: str,
        to_node_id: Optional[str],
        task_id: Optional[str],
        time_order_dict: dict,
        idempotency_key: Optional[str] = None,
    ) -> CollaborationCostResult:
        """
        Charge the micro-usage cost for a collaboration interaction.

        Anti-spam policy is evaluated before the charge.
        """
        # Anti-spam check
        balance = await self._wallet.get_balance(
            from_node_id, AccountType.PAYMENT_BALANCE
        )
        verdict = self._anti_spam.evaluate_interaction(
            node_id=from_node_id, balance=balance
        )
        if not verdict.allowed:
            return CollaborationCostResult(
                success=False,
                cost_lifepp=0.0,
                cost_usdt_equivalent=0.0,
                from_node_id=from_node_id,
                to_node_id=to_node_id,
                reason=f"Anti-spam policy: {verdict.reason}",
            )

        return await self._collaboration.charge_collaboration(
            from_node_id=from_node_id,
            to_node_id=to_node_id,
            task_id=task_id,
            time_order_dict=time_order_dict,
            idempotency_key=idempotency_key,
        )

    # ------------------------------------------------------------------
    # 3. Agent-to-agent micro-payment
    # ------------------------------------------------------------------

    async def transfer(
        self,
        from_node_id: str,
        to_node_id: str,
        amount_lifepp: float,
        time_order_dict: dict,
        memo: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> bool:
        """
        Transfer LIFE++ between two agent nodes.

        Uses the TransferEngine if available, otherwise falls back to
        direct wallet debit/credit.
        """
        idem_key = idempotency_key or new_id()

        if self._transfer_engine:
            event = ValueFlowEvent(
                flow_type=ValueFlowEventType.TRANSFER,
                from_node_id=from_node_id,
                to_node_id=to_node_id,
                amount_lifepp=amount_lifepp,
                amount_usdt_equivalent=self._oracle.lifepp_to_usdt(amount_lifepp),
                idempotency_key=idem_key,
                time_order=time_order_dict,  # type: ignore[arg-type]
            )
            result = await self._transfer_engine.execute(event, time_order_dict)
            return result is not None

        # Fallback: direct wallet operations
        balance = await self._wallet.get_balance(
            from_node_id, AccountType.PAYMENT_BALANCE
        )
        if balance < amount_lifepp:
            logger.warning(
                "Transfer denied — insufficient balance",
                extra={
                    "from": from_node_id,
                    "balance": balance,
                    "requested": amount_lifepp,
                },
            )
            return False

        await self._wallet.debit(
            node_id=from_node_id,
            amount_lifepp=amount_lifepp,
            account_type=AccountType.PAYMENT_BALANCE,
            event_type=ValueFlowEventType.TRANSFER,
            idempotency_key=f"{idem_key}:debit",
            time_order_dict=time_order_dict,
            memo=memo or "Agent-to-agent transfer",
        )
        await self._wallet.credit(
            node_id=to_node_id,
            amount_lifepp=amount_lifepp,
            account_type=AccountType.PAYMENT_BALANCE,
            event_type=ValueFlowEventType.TRANSFER,
            idempotency_key=f"{idem_key}:credit",
            time_order_dict=time_order_dict,
            memo=memo or "Agent-to-agent transfer",
        )
        return True

    # ------------------------------------------------------------------
    # 4. Cognitive contribution accounting (query)
    # ------------------------------------------------------------------

    async def get_contribution_credit(self, node_id: str) -> float:
        """Return the POC-earned contribution credit balance for a node."""
        return await self._wallet.get_balance(
            node_id, AccountType.CONTRIBUTION_CREDIT
        )

    # ------------------------------------------------------------------
    # 5. Full account snapshot
    # ------------------------------------------------------------------

    async def get_account_snapshot(self, node_id: str) -> Dict[str, float]:
        """
        Return all account balances for a node.

        Returns a dict with keys matching AccountType values:
          capital_stake, payment_balance, contribution_credit,
          trust_weight, settlement_claim, locked_participation
        """
        return await self._wallet.get_all_balances(node_id)

    # ------------------------------------------------------------------
    # 6. Merchant settlement
    # ------------------------------------------------------------------

    async def settle_merchant(
        self,
        merchant_node_id: str,
        receipts: List[Dict[str, Any]],
        time_order_dict: dict,
    ) -> MerchantSettlementResult:
        """Settle edge terminal receipts for a merchant."""
        return await self._merchant.settle_merchant_receipts(
            merchant_node_id=merchant_node_id,
            receipts=receipts,
            time_order_dict=time_order_dict,
        )

    # ------------------------------------------------------------------
    # 7. Treasury
    # ------------------------------------------------------------------

    async def fund_treasury(
        self,
        amount_lifepp: float,
        batch_id: str,
        time_order_dict: dict,
    ) -> None:
        """Credit the public-good treasury (from settlement allocations)."""
        await self._treasury.receive_settlement_allocation(
            amount_lifepp=amount_lifepp,
            batch_id=batch_id,
            time_order_dict=time_order_dict,
        )

    async def disburse_from_treasury(
        self,
        recipient_node_id: str,
        amount_lifepp: float,
        reason: str,
        time_order_dict: dict,
    ) -> bool:
        """Disburse LIFE++ from treasury to a recipient."""
        result = await self._treasury.disburse(
            recipient_node_id=recipient_node_id,
            amount_lifepp=amount_lifepp,
            reason=reason,
            time_order_dict=time_order_dict,
        )
        return result.success

    # ------------------------------------------------------------------
    # 8. Anti-spam / anti-zombie
    # ------------------------------------------------------------------

    def record_zombie_strike(self, node_id: str) -> None:
        """Record a zombie output strike for a node."""
        self._anti_spam.record_zombie_strike(node_id)

    def is_node_allowed(self, node_id: str) -> bool:
        """Check if a node is allowed to interact (not blocked or revoked)."""
        return not (
            self._anti_spam.is_blocked(node_id)
            or self._anti_spam.is_revoked(node_id)
        )
