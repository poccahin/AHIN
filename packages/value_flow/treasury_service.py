"""
TreasuryService — manages the LIFE++ public-good treasury.

The treasury receives a fraction of each VirtueWellbeing settlement batch
(default 5%) and can disburse funds for public goods, infrastructure,
and community governance purposes.

This service tracks:
  - Total treasury balance (from settlement allocations)
  - Disbursement proposals and execution
  - Audit trail of all treasury movements

The treasury is NOT a discretionary fund.
It is a governed pool whose allocations are transparent and auditable,
structurally aligning community well-being with protocol sustainability.
"""
from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Dict, List, Optional

from packages.shared.domain import (
    AccountType,
    ValueFlowEventType,
    new_id,
    now_utc,
)
from packages.shared.events import ValueFlowEvent

logger = logging.getLogger(__name__)

# Reserved node_id for the treasury (system-level, not a real agent)
TREASURY_NODE_ID = "treasury:public-good"


class DisbursementResult:
    """Outcome of a treasury disbursement."""

    __slots__ = ("disbursement_id", "recipient_node_id", "amount_lifepp", "reason", "success")

    def __init__(
        self,
        disbursement_id: str,
        recipient_node_id: str,
        amount_lifepp: float,
        reason: str,
        success: bool,
    ) -> None:
        self.disbursement_id = disbursement_id
        self.recipient_node_id = recipient_node_id
        self.amount_lifepp = amount_lifepp
        self.reason = reason
        self.success = success


class TreasuryService:
    """
    Manages the LIFE++ public-good treasury account.

    Responsibilities:
      - Receive settlement allocations (from VirtueWellbeingDistributor)
      - Track cumulative treasury balance
      - Execute governed disbursements to recipient nodes
      - Maintain a full audit trail
    """

    def __init__(
        self,
        wallet_service: Any,
        event_bus: Optional[Any] = None,
        treasury_node_id: str = TREASURY_NODE_ID,
    ) -> None:
        self._wallet = wallet_service
        self._event_bus = event_bus
        self._treasury_node_id = treasury_node_id
        self._disbursement_log: List[Dict[str, Any]] = []

    @property
    def treasury_node_id(self) -> str:
        """Return the treasury system node_id."""
        return self._treasury_node_id

    # ------------------------------------------------------------------
    # Receive allocation
    # ------------------------------------------------------------------

    async def receive_settlement_allocation(
        self,
        amount_lifepp: float,
        batch_id: str,
        time_order_dict: dict,
    ) -> None:
        """
        Credit the treasury with the settlement allocation.

        Called by SettlementService after each VirtueWellbeing batch.
        """
        if amount_lifepp <= 0:
            return

        await self._wallet.credit(
            node_id=self._treasury_node_id,
            amount_lifepp=amount_lifepp,
            account_type=AccountType.PAYMENT_BALANCE,
            event_type=ValueFlowEventType.TREASURY_ALLOCATION,
            idempotency_key=f"treasury_alloc:{batch_id}",
            time_order_dict=time_order_dict,
            memo=f"Treasury allocation from settlement batch {batch_id}",
        )

        if self._event_bus:
            event = ValueFlowEvent(
                flow_type=ValueFlowEventType.TREASURY_ALLOCATION,
                from_node_id=None,
                to_node_id=self._treasury_node_id,
                amount_lifepp=amount_lifepp,
                idempotency_key=f"treasury_alloc:{batch_id}:event",
                time_order=time_order_dict,  # type: ignore[arg-type]
            )
            await self._event_bus.publish(event)

        logger.info(
            "Treasury received settlement allocation",
            extra={
                "amount_lifepp": amount_lifepp,
                "batch_id": batch_id,
            },
        )

    # ------------------------------------------------------------------
    # Disbursement
    # ------------------------------------------------------------------

    async def disburse(
        self,
        recipient_node_id: str,
        amount_lifepp: float,
        reason: str,
        time_order_dict: dict,
        authorized_by: Optional[str] = None,
    ) -> DisbursementResult:
        """
        Disburse LIFE++ from the treasury to a recipient node.

        Requires:
          - Sufficient treasury balance
          - A documented reason (governance transparency)
          - Optional authorized_by for multi-sig governance
        """
        disbursement_id = new_id()

        # Balance check
        balance = await self._wallet.get_balance(
            self._treasury_node_id, AccountType.PAYMENT_BALANCE
        )
        if balance < amount_lifepp:
            logger.warning(
                "Treasury disbursement denied — insufficient funds",
                extra={
                    "balance": balance,
                    "requested": amount_lifepp,
                    "recipient": recipient_node_id,
                },
            )
            return DisbursementResult(
                disbursement_id=disbursement_id,
                recipient_node_id=recipient_node_id,
                amount_lifepp=amount_lifepp,
                reason=f"Insufficient treasury balance: {balance:.8f} available",
                success=False,
            )

        # Debit treasury
        await self._wallet.debit(
            node_id=self._treasury_node_id,
            amount_lifepp=amount_lifepp,
            account_type=AccountType.PAYMENT_BALANCE,
            event_type=ValueFlowEventType.TREASURY_ALLOCATION,
            idempotency_key=f"treasury_disburse:{disbursement_id}:debit",
            time_order_dict=time_order_dict,
            memo=f"Treasury disbursement: {reason}",
        )

        # Credit recipient
        await self._wallet.credit(
            node_id=recipient_node_id,
            amount_lifepp=amount_lifepp,
            account_type=AccountType.PAYMENT_BALANCE,
            event_type=ValueFlowEventType.TREASURY_ALLOCATION,
            idempotency_key=f"treasury_disburse:{disbursement_id}:credit",
            time_order_dict=time_order_dict,
            memo=f"Treasury disbursement from public goods",
        )

        # Emit event
        if self._event_bus:
            event = ValueFlowEvent(
                flow_type=ValueFlowEventType.TREASURY_ALLOCATION,
                from_node_id=self._treasury_node_id,
                to_node_id=recipient_node_id,
                amount_lifepp=amount_lifepp,
                idempotency_key=f"treasury_disburse:{disbursement_id}:event",
                time_order=time_order_dict,  # type: ignore[arg-type]
            )
            await self._event_bus.publish(event)

        # Audit log
        entry = {
            "disbursement_id": disbursement_id,
            "recipient_node_id": recipient_node_id,
            "amount_lifepp": amount_lifepp,
            "reason": reason,
            "authorized_by": authorized_by,
            "timestamp": now_utc().isoformat(),
        }
        self._disbursement_log.append(entry)

        logger.info(
            "Treasury disbursement executed",
            extra={
                "disbursement_id": disbursement_id,
                "recipient": recipient_node_id,
                "amount_lifepp": amount_lifepp,
            },
        )

        return DisbursementResult(
            disbursement_id=disbursement_id,
            recipient_node_id=recipient_node_id,
            amount_lifepp=amount_lifepp,
            reason=reason,
            success=True,
        )

    # ------------------------------------------------------------------
    # Query
    # ------------------------------------------------------------------

    async def get_balance(self) -> float:
        """Return the current treasury balance."""
        return await self._wallet.get_balance(
            self._treasury_node_id, AccountType.PAYMENT_BALANCE
        )

    @property
    def disbursement_history(self) -> List[Dict[str, Any]]:
        """Return a copy of the disbursement audit log."""
        return list(self._disbursement_log)

    def compute_audit_hash(self) -> str:
        """Compute a hash of the full disbursement log for tamper-evidence."""
        data = json.dumps(self._disbursement_log, sort_keys=True, default=str)
        return hashlib.sha256(data.encode()).hexdigest()
