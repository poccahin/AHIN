"""
Tests for the LIFE++ Cognitive Value Flow System.

Tests cover:
  - PriceOracle: price setting, conversion, staleness
  - AdmissionGate: threshold checks, balance requirements
  - CollaborationCostEngine: cost computation, balance enforcement
  - MerchantSettlementService: receipt validation, batch settlement
  - TreasuryService: allocation, disbursement, audit
  - AntiSpamPolicy: rate limiting, zombie escalation, cooldown
  - CognitiveValueFlowSystem: integrated facade operations
  - Theory mapping: CognitiveValueFlowSystem concept included
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import time
from typing import Any, Dict, Optional
from unittest.mock import AsyncMock

import pytest


# ---------------------------------------------------------------------------
# Helpers — in-memory WalletService mock
# ---------------------------------------------------------------------------

class InMemoryWalletService:
    """
    Minimal in-memory wallet for testing value-flow components.

    Maintains separate account-type balances per node, matching
    the real WalletService contract.
    """

    def __init__(self):
        # {(node_id, account_type_value): balance}
        self._balances: Dict[tuple, float] = {}

    async def get_balance(self, node_id: str, account_type: Any = None) -> float:
        from packages.shared.domain import AccountType
        at = account_type or AccountType.PAYMENT_BALANCE
        key = (node_id, at.value if hasattr(at, "value") else str(at))
        return self._balances.get(key, 0.0)

    async def get_all_balances(self, node_id: str, currency: str = "LIFEPP") -> Dict[str, float]:
        from packages.shared.domain import AccountType
        result = {}
        for at in AccountType:
            result[at.value] = await self.get_balance(node_id, at)
        return result

    async def credit(self, node_id: str, amount_lifepp: float, account_type: Any, event_type: str,
                     idempotency_key: str, time_order_dict: dict, memo: str = None,
                     related_artifact_id: str = None, related_poc_id: str = None) -> None:
        if amount_lifepp <= 0:
            raise ValueError(f"Credit amount must be positive, got {amount_lifepp}")
        key = (node_id, account_type.value if hasattr(account_type, "value") else str(account_type))
        self._balances[key] = self._balances.get(key, 0.0) + amount_lifepp

    async def debit(self, node_id: str, amount_lifepp: float, account_type: Any, event_type: str,
                    idempotency_key: str, time_order_dict: dict, memo: str = None) -> None:
        if amount_lifepp <= 0:
            raise ValueError(f"Debit amount must be positive, got {amount_lifepp}")
        key = (node_id, account_type.value if hasattr(account_type, "value") else str(account_type))
        balance = self._balances.get(key, 0.0)
        if balance < amount_lifepp:
            raise ValueError(f"Insufficient balance: {balance}, requested {amount_lifepp}")
        self._balances[key] = balance - amount_lifepp

    async def stake_for_ahin_admission(self, node_id: str, amount_lifepp: float,
                                        lifepp_usdt_price: float, idempotency_key: str,
                                        time_order_dict: dict) -> bool:
        from packages.shared.domain import AccountType
        usdt_value = amount_lifepp * lifepp_usdt_price
        if usdt_value < 10.0:
            return False
        try:
            await self.debit(node_id, amount_lifepp, AccountType.PAYMENT_BALANCE,
                           "admission_stake_debit", f"{idempotency_key}:debit", time_order_dict)
            await self.credit(node_id, amount_lifepp, AccountType.CAPITAL_STAKE,
                            "admission_stake_credit", f"{idempotency_key}:credit", time_order_dict)
            return True
        except ValueError:
            return False

    def set_balance(self, node_id: str, account_type: Any, amount: float) -> None:
        """Test helper to pre-set a balance."""
        key = (node_id, account_type.value if hasattr(account_type, "value") else str(account_type))
        self._balances[key] = amount


def _time_order_dict() -> dict:
    """Helper to create a minimal time_order_dict for tests."""
    return {"local_sequence": 1, "node_id": "test-node", "wall_clock_utc": "2025-01-01T00:00:00Z"}


# ---------------------------------------------------------------------------
# PriceOracle
# ---------------------------------------------------------------------------

class TestPriceOracle:
    def test_initial_price(self):
        from packages.value_flow.price_oracle import PriceOracle
        oracle = PriceOracle(initial_price=0.15)
        assert oracle.lifepp_usdt == 0.15

    def test_default_price_from_env(self):
        from packages.value_flow.price_oracle import PriceOracle
        oracle = PriceOracle()
        assert oracle.lifepp_usdt > 0

    def test_set_price(self):
        from packages.value_flow.price_oracle import PriceOracle
        oracle = PriceOracle(initial_price=0.10)
        oracle.set_price(0.25, source="test")
        assert oracle.lifepp_usdt == 0.25

    def test_invalid_price_rejected(self):
        from packages.value_flow.price_oracle import PriceOracle
        with pytest.raises(ValueError):
            PriceOracle(initial_price=0.0)
        with pytest.raises(ValueError):
            PriceOracle(initial_price=-1.0)

    def test_invalid_set_price_rejected(self):
        from packages.value_flow.price_oracle import PriceOracle
        oracle = PriceOracle(initial_price=0.10)
        with pytest.raises(ValueError):
            oracle.set_price(0.0)

    def test_usdt_to_lifepp_conversion(self):
        from packages.value_flow.price_oracle import PriceOracle
        oracle = PriceOracle(initial_price=0.10)
        # 10 USDT / 0.10 = 100 LIFE++
        assert abs(oracle.usdt_to_lifepp(10.0) - 100.0) < 1e-8

    def test_lifepp_to_usdt_conversion(self):
        from packages.value_flow.price_oracle import PriceOracle
        oracle = PriceOracle(initial_price=0.10)
        # 100 LIFE++ * 0.10 = 10 USDT
        assert abs(oracle.lifepp_to_usdt(100.0) - 10.0) < 1e-8

    def test_snapshot_returns_copy(self):
        from packages.value_flow.price_oracle import PriceOracle
        oracle = PriceOracle(initial_price=0.10)
        snap1 = oracle.snapshot
        oracle.set_price(0.20)
        snap2 = oracle.snapshot
        assert snap1.lifepp_usdt == 0.10
        assert snap2.lifepp_usdt == 0.20


# ---------------------------------------------------------------------------
# AdmissionGate
# ---------------------------------------------------------------------------

class TestAdmissionGate:
    @pytest.mark.asyncio
    async def test_successful_admission(self):
        from packages.shared.domain import AccountType
        from packages.value_flow.admission_gate import AdmissionGate
        from packages.value_flow.price_oracle import PriceOracle

        wallet = InMemoryWalletService()
        oracle = PriceOracle(initial_price=0.10)
        gate = AdmissionGate(wallet_service=wallet, price_oracle=oracle)

        # Fund the node with 200 LIFE++ (20 USDT at 0.10)
        wallet.set_balance("node-1", AccountType.PAYMENT_BALANCE, 200.0)

        result = await gate.attempt_admission(
            node_id="node-1", stake_lifepp=150.0, time_order_dict=_time_order_dict()
        )
        assert result.admitted is True
        assert result.usdt_value == 15.0

        # Capital stake should have 150, payment should have 50
        cap_balance = await wallet.get_balance("node-1", AccountType.CAPITAL_STAKE)
        pay_balance = await wallet.get_balance("node-1", AccountType.PAYMENT_BALANCE)
        assert abs(cap_balance - 150.0) < 1e-8
        assert abs(pay_balance - 50.0) < 1e-8

    @pytest.mark.asyncio
    async def test_admission_denied_low_stake_value(self):
        from packages.shared.domain import AccountType
        from packages.value_flow.admission_gate import AdmissionGate
        from packages.value_flow.price_oracle import PriceOracle

        wallet = InMemoryWalletService()
        oracle = PriceOracle(initial_price=0.10)
        gate = AdmissionGate(wallet_service=wallet, price_oracle=oracle)

        wallet.set_balance("node-2", AccountType.PAYMENT_BALANCE, 500.0)

        # 50 LIFE++ * 0.10 = 5 USDT < 10 USDT threshold
        result = await gate.attempt_admission(
            node_id="node-2", stake_lifepp=50.0, time_order_dict=_time_order_dict()
        )
        assert result.admitted is False
        assert "below" in result.reason.lower()

    @pytest.mark.asyncio
    async def test_admission_denied_insufficient_balance(self):
        from packages.shared.domain import AccountType
        from packages.value_flow.admission_gate import AdmissionGate
        from packages.value_flow.price_oracle import PriceOracle

        wallet = InMemoryWalletService()
        oracle = PriceOracle(initial_price=0.10)
        gate = AdmissionGate(wallet_service=wallet, price_oracle=oracle)

        wallet.set_balance("node-3", AccountType.PAYMENT_BALANCE, 50.0)

        # 200 LIFE++ needed but only 50 available
        result = await gate.attempt_admission(
            node_id="node-3", stake_lifepp=200.0, time_order_dict=_time_order_dict()
        )
        assert result.admitted is False
        assert "insufficient" in result.reason.lower()

    def test_minimum_stake_lifepp(self):
        from packages.value_flow.admission_gate import AdmissionGate
        from packages.value_flow.price_oracle import PriceOracle

        oracle = PriceOracle(initial_price=0.10)
        gate = AdmissionGate(wallet_service=None, price_oracle=oracle)

        # 10 USDT / 0.10 = 100 LIFE++
        assert abs(gate.minimum_stake_lifepp() - 100.0) < 1e-8


# ---------------------------------------------------------------------------
# CollaborationCostEngine
# ---------------------------------------------------------------------------

class TestCollaborationCostEngine:
    def test_cost_computation_at_high_price(self):
        from packages.value_flow.collaboration_cost_engine import CollaborationCostEngine
        from packages.value_flow.price_oracle import PriceOracle

        oracle = PriceOracle(initial_price=0.001)
        engine = CollaborationCostEngine(wallet_service=None, price_oracle=oracle)

        # 0.00001 USDT / 0.001 = 0.01 LIFE++ (< 1 LIFE++)
        cost = engine.compute_cost()
        assert abs(cost - 0.01) < 1e-8

    def test_cost_computation_at_low_price(self):
        from packages.value_flow.collaboration_cost_engine import CollaborationCostEngine
        from packages.value_flow.price_oracle import PriceOracle

        oracle = PriceOracle(initial_price=0.000001)
        engine = CollaborationCostEngine(wallet_service=None, price_oracle=oracle)

        # 0.00001 / 0.000001 = 10 LIFE++ but capped at 1 LIFE++
        cost = engine.compute_cost()
        assert cost <= 1.0

    def test_cost_capped_at_max_lifepp(self):
        from packages.value_flow.collaboration_cost_engine import CollaborationCostEngine
        from packages.value_flow.price_oracle import PriceOracle

        oracle = PriceOracle(initial_price=0.00001)
        engine = CollaborationCostEngine(wallet_service=None, price_oracle=oracle)

        # 0.00001 / 0.00001 = 1.0 LIFE++ exactly
        cost = engine.compute_cost()
        assert abs(cost - 1.0) < 1e-8

    @pytest.mark.asyncio
    async def test_charge_collaboration_success(self):
        from packages.shared.domain import AccountType
        from packages.value_flow.collaboration_cost_engine import CollaborationCostEngine
        from packages.value_flow.price_oracle import PriceOracle

        wallet = InMemoryWalletService()
        oracle = PriceOracle(initial_price=0.10)
        engine = CollaborationCostEngine(wallet_service=wallet, price_oracle=oracle)

        wallet.set_balance("payer", AccountType.PAYMENT_BALANCE, 100.0)

        result = await engine.charge_collaboration(
            from_node_id="payer",
            to_node_id="receiver",
            task_id="task-1",
            time_order_dict=_time_order_dict(),
        )
        assert result.success is True
        assert result.cost_lifepp > 0

    @pytest.mark.asyncio
    async def test_charge_collaboration_insufficient_balance(self):
        from packages.shared.domain import AccountType
        from packages.value_flow.collaboration_cost_engine import CollaborationCostEngine
        from packages.value_flow.price_oracle import PriceOracle

        wallet = InMemoryWalletService()
        oracle = PriceOracle(initial_price=0.10)
        engine = CollaborationCostEngine(wallet_service=wallet, price_oracle=oracle)

        # Zero balance
        result = await engine.charge_collaboration(
            from_node_id="broke-node",
            to_node_id="receiver",
            task_id="task-2",
            time_order_dict=_time_order_dict(),
        )
        assert result.success is False
        assert "insufficient" in result.reason.lower()


# ---------------------------------------------------------------------------
# MerchantSettlementService
# ---------------------------------------------------------------------------

class TestMerchantSettlementService:
    def _make_receipt(self, receipt_id: str, amount: float) -> dict:
        """Create a receipt with a valid proof hash."""
        receipt = {
            "receipt_id": receipt_id,
            "amount_lifepp": amount,
            "merchant_node_id": "merchant-1",
            "payload": {"item": "coffee"},
        }
        receipt["receipt_hash"] = hashlib.sha256(
            json.dumps(receipt, sort_keys=True, default=str).encode()
        ).hexdigest()
        return receipt

    @pytest.mark.asyncio
    async def test_settle_valid_receipts(self):
        from packages.shared.domain import AccountType
        from packages.value_flow.merchant_settlement_service import MerchantSettlementService

        wallet = InMemoryWalletService()
        service = MerchantSettlementService(wallet_service=wallet)

        receipts = [
            self._make_receipt("r-001", 1.5),
            self._make_receipt("r-002", 2.5),
        ]

        result = await service.settle_merchant_receipts(
            merchant_node_id="merchant-1",
            receipts=receipts,
            time_order_dict=_time_order_dict(),
        )

        assert result.receipt_count == 2
        assert result.rejected_count == 0
        assert abs(result.total_lifepp - 4.0) < 1e-8

        balance = await wallet.get_balance("merchant-1", AccountType.PAYMENT_BALANCE)
        assert abs(balance - 4.0) < 1e-8

    @pytest.mark.asyncio
    async def test_reject_tampered_receipt(self):
        from packages.value_flow.merchant_settlement_service import MerchantSettlementService

        wallet = InMemoryWalletService()
        service = MerchantSettlementService(wallet_service=wallet)

        receipt = self._make_receipt("r-003", 5.0)
        receipt["amount_lifepp"] = 9999.0  # tamper!

        result = await service.settle_merchant_receipts(
            merchant_node_id="merchant-1",
            receipts=[receipt],
            time_order_dict=_time_order_dict(),
        )

        assert result.receipt_count == 0
        assert result.rejected_count == 1
        assert result.total_lifepp == 0.0

    @pytest.mark.asyncio
    async def test_dedup_receipts(self):
        from packages.value_flow.merchant_settlement_service import MerchantSettlementService

        wallet = InMemoryWalletService()
        service = MerchantSettlementService(wallet_service=wallet)

        receipt = self._make_receipt("r-004", 3.0)

        # Settle same receipt twice
        await service.settle_merchant_receipts(
            merchant_node_id="merchant-1",
            receipts=[receipt],
            time_order_dict=_time_order_dict(),
        )
        result = await service.settle_merchant_receipts(
            merchant_node_id="merchant-1",
            receipts=[receipt],
            time_order_dict=_time_order_dict(),
        )

        # Second batch should reject duplicate
        assert result.receipt_count == 0
        assert result.rejected_count == 1

    @pytest.mark.asyncio
    async def test_audit_hash_produced(self):
        from packages.value_flow.merchant_settlement_service import MerchantSettlementService

        wallet = InMemoryWalletService()
        service = MerchantSettlementService(wallet_service=wallet)

        result = await service.settle_merchant_receipts(
            merchant_node_id="merchant-1",
            receipts=[self._make_receipt("r-005", 1.0)],
            time_order_dict=_time_order_dict(),
        )
        assert len(result.audit_hash) == 64  # SHA-256 hex


# ---------------------------------------------------------------------------
# TreasuryService
# ---------------------------------------------------------------------------

class TestTreasuryService:
    @pytest.mark.asyncio
    async def test_receive_allocation(self):
        from packages.shared.domain import AccountType
        from packages.value_flow.treasury_service import TreasuryService, TREASURY_NODE_ID

        wallet = InMemoryWalletService()
        treasury = TreasuryService(wallet_service=wallet)

        await treasury.receive_settlement_allocation(
            amount_lifepp=50.0,
            batch_id="batch-001",
            time_order_dict=_time_order_dict(),
        )

        balance = await treasury.get_balance()
        assert abs(balance - 50.0) < 1e-8

    @pytest.mark.asyncio
    async def test_disburse_success(self):
        from packages.shared.domain import AccountType
        from packages.value_flow.treasury_service import TreasuryService, TREASURY_NODE_ID

        wallet = InMemoryWalletService()
        treasury = TreasuryService(wallet_service=wallet)

        # Fund treasury
        wallet.set_balance(TREASURY_NODE_ID, AccountType.PAYMENT_BALANCE, 100.0)

        result = await treasury.disburse(
            recipient_node_id="dev-fund",
            amount_lifepp=30.0,
            reason="Developer grant for AHIN tooling",
            time_order_dict=_time_order_dict(),
        )

        assert result.success is True
        assert abs(result.amount_lifepp - 30.0) < 1e-8

        remaining = await treasury.get_balance()
        assert abs(remaining - 70.0) < 1e-8

        recipient_bal = await wallet.get_balance("dev-fund", AccountType.PAYMENT_BALANCE)
        assert abs(recipient_bal - 30.0) < 1e-8

    @pytest.mark.asyncio
    async def test_disburse_insufficient_funds(self):
        from packages.value_flow.treasury_service import TreasuryService

        wallet = InMemoryWalletService()
        treasury = TreasuryService(wallet_service=wallet)

        # Treasury has 0 balance
        result = await treasury.disburse(
            recipient_node_id="dev-fund",
            amount_lifepp=100.0,
            reason="Overdrawn attempt",
            time_order_dict=_time_order_dict(),
        )

        assert result.success is False
        assert "insufficient" in result.reason.lower()

    @pytest.mark.asyncio
    async def test_disbursement_audit_trail(self):
        from packages.shared.domain import AccountType
        from packages.value_flow.treasury_service import TreasuryService, TREASURY_NODE_ID

        wallet = InMemoryWalletService()
        treasury = TreasuryService(wallet_service=wallet)

        wallet.set_balance(TREASURY_NODE_ID, AccountType.PAYMENT_BALANCE, 200.0)

        await treasury.disburse("r1", 10.0, "grant-1", _time_order_dict())
        await treasury.disburse("r2", 20.0, "grant-2", _time_order_dict())

        history = treasury.disbursement_history
        assert len(history) == 2
        assert history[0]["recipient_node_id"] == "r1"
        assert history[1]["amount_lifepp"] == 20.0

        audit_hash = treasury.compute_audit_hash()
        assert len(audit_hash) == 64

    @pytest.mark.asyncio
    async def test_zero_allocation_ignored(self):
        from packages.value_flow.treasury_service import TreasuryService

        wallet = InMemoryWalletService()
        treasury = TreasuryService(wallet_service=wallet)

        await treasury.receive_settlement_allocation(
            amount_lifepp=0.0, batch_id="empty", time_order_dict=_time_order_dict()
        )
        balance = await treasury.get_balance()
        assert balance == 0.0


# ---------------------------------------------------------------------------
# AntiSpamPolicy
# ---------------------------------------------------------------------------

class TestAntiSpamPolicy:
    def test_allows_normal_interaction(self):
        from packages.policy_engine.anti_spam_policy import AntiSpamPolicy
        policy = AntiSpamPolicy()
        verdict = policy.evaluate_interaction("node-a", balance=100.0)
        assert verdict.allowed is True

    def test_rate_limit_enforcement(self):
        from packages.policy_engine.anti_spam_policy import AntiSpamPolicy
        policy = AntiSpamPolicy(rate_limit_per_minute=3)

        for _ in range(3):
            v = policy.evaluate_interaction("flood-node", balance=100.0)
            assert v.allowed is True

        # 4th should be rejected
        v = policy.evaluate_interaction("flood-node", balance=100.0)
        assert v.allowed is False
        assert "rate limit" in v.reason.lower()

    def test_zombie_block_escalation(self):
        from packages.policy_engine.anti_spam_policy import AntiSpamPolicy
        policy = AntiSpamPolicy(zombie_block_threshold=2)

        # 1 strike — warning
        v = policy.record_zombie_strike("zombie-node")
        assert v.penalty_applied == "warning"

        # 2 strikes — blocked
        v = policy.record_zombie_strike("zombie-node")
        assert v.penalty_applied == "block"
        assert policy.is_blocked("zombie-node")

        # Now interaction should be denied
        v = policy.evaluate_interaction("zombie-node", balance=100.0)
        assert v.allowed is False

    def test_zombie_revocation(self):
        from packages.policy_engine.anti_spam_policy import AntiSpamPolicy
        policy = AntiSpamPolicy(zombie_block_threshold=2, zombie_revoke_threshold=4)

        for _ in range(4):
            policy.record_zombie_strike("bad-node")

        assert policy.is_revoked("bad-node")

        v = policy.evaluate_interaction("bad-node", balance=100.0)
        assert v.allowed is False
        assert "revoked" in v.reason.lower()

    def test_admin_unblock(self):
        from packages.policy_engine.anti_spam_policy import AntiSpamPolicy
        policy = AntiSpamPolicy(zombie_block_threshold=1)

        policy.record_zombie_strike("node-x")
        assert policy.is_blocked("node-x")

        policy.unblock_node("node-x")
        assert not policy.is_blocked("node-x")
        assert policy.get_zombie_strikes("node-x") == 0

    def test_admin_reinstate_revoked(self):
        from packages.policy_engine.anti_spam_policy import AntiSpamPolicy
        policy = AntiSpamPolicy(zombie_block_threshold=1, zombie_revoke_threshold=2)

        policy.record_zombie_strike("revoked-node")
        policy.record_zombie_strike("revoked-node")
        assert policy.is_revoked("revoked-node")

        policy.reinstate_node("revoked-node")
        assert not policy.is_revoked("revoked-node")
        assert not policy.is_blocked("revoked-node")

    def test_min_balance_enforcement(self):
        from packages.policy_engine.anti_spam_policy import AntiSpamPolicy
        policy = AntiSpamPolicy()

        v = policy.evaluate_interaction("poor-node", balance=0.0, min_balance=1.0)
        assert v.allowed is False
        assert "balance" in v.reason.lower()


# ---------------------------------------------------------------------------
# CognitiveValueFlowSystem (integrated facade)
# ---------------------------------------------------------------------------

class TestCognitiveValueFlowSystem:
    def _make_system(self):
        from packages.value_flow.cognitive_value_flow_system import CognitiveValueFlowSystem
        from packages.value_flow.price_oracle import PriceOracle

        wallet = InMemoryWalletService()
        oracle = PriceOracle(initial_price=0.10)
        system = CognitiveValueFlowSystem(
            wallet_service=wallet,
            price_oracle=oracle,
        )
        return system, wallet

    @pytest.mark.asyncio
    async def test_full_admission_and_collaboration_flow(self):
        from packages.shared.domain import AccountType

        system, wallet = self._make_system()

        # Fund agent
        wallet.set_balance("agent-a", AccountType.PAYMENT_BALANCE, 500.0)

        # 1. Admit to AHIN
        admission = await system.admit_to_ahin(
            node_id="agent-a",
            stake_lifepp=150.0,
            time_order_dict=_time_order_dict(),
        )
        assert admission.admitted is True

        # Check capital stake locked
        snap = await system.get_account_snapshot("agent-a")
        assert snap["capital_stake"] == 150.0
        assert snap["payment_balance"] == 350.0

        # 2. Charge collaboration
        collab = await system.charge_collaboration(
            from_node_id="agent-a",
            to_node_id="agent-b",
            task_id="task-001",
            time_order_dict=_time_order_dict(),
        )
        assert collab.success is True

        # Agent-a balance should have decreased
        new_balance = await wallet.get_balance("agent-a", AccountType.PAYMENT_BALANCE)
        assert new_balance < 350.0

    @pytest.mark.asyncio
    async def test_transfer_between_agents(self):
        from packages.shared.domain import AccountType

        system, wallet = self._make_system()

        wallet.set_balance("sender", AccountType.PAYMENT_BALANCE, 100.0)

        success = await system.transfer(
            from_node_id="sender",
            to_node_id="receiver",
            amount_lifepp=25.0,
            time_order_dict=_time_order_dict(),
        )
        assert success is True

        sender_bal = await wallet.get_balance("sender", AccountType.PAYMENT_BALANCE)
        receiver_bal = await wallet.get_balance("receiver", AccountType.PAYMENT_BALANCE)
        assert abs(sender_bal - 75.0) < 1e-8
        assert abs(receiver_bal - 25.0) < 1e-8

    @pytest.mark.asyncio
    async def test_transfer_insufficient_balance(self):
        from packages.shared.domain import AccountType

        system, wallet = self._make_system()

        success = await system.transfer(
            from_node_id="empty-sender",
            to_node_id="receiver",
            amount_lifepp=10.0,
            time_order_dict=_time_order_dict(),
        )
        assert success is False

    @pytest.mark.asyncio
    async def test_anti_spam_blocks_collaboration(self):
        from packages.shared.domain import AccountType

        system, wallet = self._make_system()
        wallet.set_balance("spammer", AccountType.PAYMENT_BALANCE, 1000.0)

        # Block the node via zombie strikes
        system.record_zombie_strike("spammer")
        system.record_zombie_strike("spammer")
        system.record_zombie_strike("spammer")

        # Should be blocked
        assert system.is_node_allowed("spammer") is False

        collab = await system.charge_collaboration(
            from_node_id="spammer",
            to_node_id="victim",
            task_id="spam-task",
            time_order_dict=_time_order_dict(),
        )
        assert collab.success is False
        assert "anti-spam" in collab.reason.lower()

    @pytest.mark.asyncio
    async def test_treasury_integration(self):
        from packages.shared.domain import AccountType
        from packages.value_flow.treasury_service import TREASURY_NODE_ID

        system, wallet = self._make_system()

        # Fund treasury
        await system.fund_treasury(
            amount_lifepp=100.0,
            batch_id="batch-x",
            time_order_dict=_time_order_dict(),
        )

        treasury_bal = await wallet.get_balance(TREASURY_NODE_ID, AccountType.PAYMENT_BALANCE)
        assert abs(treasury_bal - 100.0) < 1e-8

        # Disburse
        success = await system.disburse_from_treasury(
            recipient_node_id="community-project",
            amount_lifepp=40.0,
            reason="Community infrastructure grant",
            time_order_dict=_time_order_dict(),
        )
        assert success is True

        remaining = await wallet.get_balance(TREASURY_NODE_ID, AccountType.PAYMENT_BALANCE)
        assert abs(remaining - 60.0) < 1e-8

    @pytest.mark.asyncio
    async def test_contribution_credit_query(self):
        from packages.shared.domain import AccountType

        system, wallet = self._make_system()
        wallet.set_balance("contributor", AccountType.CONTRIBUTION_CREDIT, 42.5)

        credit = await system.get_contribution_credit("contributor")
        assert abs(credit - 42.5) < 1e-8


# ---------------------------------------------------------------------------
# Theory mapping — CognitiveValueFlowSystem included
# ---------------------------------------------------------------------------

class TestCognitiveValueFlowSystemMapping:
    def test_cognitive_value_flow_system_mapped(self):
        from packages.shared.theory_mapping import THEORY_TO_SYSTEM_MAP
        assert "CognitiveValueFlowSystem" in THEORY_TO_SYSTEM_MAP

    def test_mapping_has_required_fields(self):
        from packages.shared.theory_mapping import THEORY_TO_SYSTEM_MAP
        mapping = THEORY_TO_SYSTEM_MAP["CognitiveValueFlowSystem"]
        required_fields = [
            "system_abstraction", "runtime_behavior", "data_structure",
            "event_type", "incentive_logic", "governance_rule",
            "audit_replay", "must_not_implement_as",
        ]
        for field in required_fields:
            assert field in mapping, f"CognitiveValueFlowSystem missing field '{field}'"

    def test_mapping_references_key_concepts(self):
        from packages.shared.theory_mapping import THEORY_TO_SYSTEM_MAP
        mapping = THEORY_TO_SYSTEM_MAP["CognitiveValueFlowSystem"]
        # Must reference the key design constraints
        assert "scarce" in mapping["theoretical_meaning"].lower()
        assert "admission" in mapping["runtime_behavior"].lower()
        assert "append-only" in mapping["data_structure"].lower() or "never collapsed" in mapping["data_structure"].lower()
        assert "not" in mapping["must_not_implement_as"].lower()


# ---------------------------------------------------------------------------
# Account type conceptual distinction
# ---------------------------------------------------------------------------

class TestAccountTypeDistinction:
    """
    Verify the required conceptual distinction between account types:
      - capital_stake
      - payment_balance
      - contribution_credit
      - trust_weight
      - settlement_claim
      - locked_participation
    """

    def test_all_six_account_types_exist(self):
        from packages.shared.domain import AccountType
        required = [
            "capital_stake", "payment_balance", "contribution_credit",
            "trust_weight", "settlement_claim", "locked_participation",
        ]
        existing = [at.value for at in AccountType]
        for at in required:
            assert at in existing, f"Missing AccountType: {at}"

    @pytest.mark.asyncio
    async def test_accounts_are_independent(self):
        """Crediting one account type must NOT affect another."""
        from packages.shared.domain import AccountType

        wallet = InMemoryWalletService()

        wallet.set_balance("test-node", AccountType.CAPITAL_STAKE, 100.0)
        wallet.set_balance("test-node", AccountType.PAYMENT_BALANCE, 50.0)
        wallet.set_balance("test-node", AccountType.CONTRIBUTION_CREDIT, 25.0)

        assert await wallet.get_balance("test-node", AccountType.CAPITAL_STAKE) == 100.0
        assert await wallet.get_balance("test-node", AccountType.PAYMENT_BALANCE) == 50.0
        assert await wallet.get_balance("test-node", AccountType.CONTRIBUTION_CREDIT) == 25.0
        assert await wallet.get_balance("test-node", AccountType.TRUST_WEIGHT) == 0.0
        assert await wallet.get_balance("test-node", AccountType.SETTLEMENT_CLAIM) == 0.0
        assert await wallet.get_balance("test-node", AccountType.LOCKED_PARTICIPATION) == 0.0
