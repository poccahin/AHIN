"""
Tests for the LIFE++ Cognitive Value Flow System.

Covers:
  - PriceOracle (LIFE++/USDT price feed)
  - AdmissionGate (AHIN admission eligibility)
  - CollaborationCostEngine (micro-usage cost computation)
  - MerchantSettlementService (payment, acquiring, settlement loop)
  - TreasuryService (public goods treasury)
  - CognitiveValueFlowSystem (unified facade)
"""
import pytest

from packages.value_flow.price_oracle import PriceOracle
from packages.value_flow.admission_gate import AdmissionGate
from packages.value_flow.collaboration_cost_engine import CollaborationCostEngine
from packages.value_flow.merchant_settlement_service import MerchantSettlementService
from packages.value_flow.treasury_service import TreasuryService
from packages.value_flow.cognitive_value_flow_system import CognitiveValueFlowSystem


# ---------------------------------------------------------------------------
# PriceOracle tests
# ---------------------------------------------------------------------------

class TestPriceOracle:

    def test_initial_price(self):
        oracle = PriceOracle(initial_price=0.05)
        assert oracle.lifepp_usdt_price == 0.05

    def test_update_price(self):
        oracle = PriceOracle(initial_price=0.01)
        oracle.update_price(0.02)
        assert oracle.lifepp_usdt_price == 0.02

    def test_invalid_price_rejected(self):
        with pytest.raises(ValueError):
            PriceOracle(initial_price=0)
        with pytest.raises(ValueError):
            PriceOracle(initial_price=-1)

    def test_invalid_update_rejected(self):
        oracle = PriceOracle(initial_price=0.01)
        with pytest.raises(ValueError):
            oracle.update_price(0)

    def test_lifepp_to_usdt(self):
        oracle = PriceOracle(initial_price=0.01)
        assert oracle.lifepp_to_usdt(1000) == 10.0

    def test_usdt_to_lifepp(self):
        oracle = PriceOracle(initial_price=0.01)
        assert oracle.usdt_to_lifepp(10.0) == 1000.0

    def test_stale_detection(self):
        oracle = PriceOracle(initial_price=0.01, stale_threshold_seconds=0)
        import time
        time.sleep(0.01)
        assert oracle.is_stale

    def test_not_stale_initially(self):
        oracle = PriceOracle(initial_price=0.01, stale_threshold_seconds=3600)
        assert not oracle.is_stale


# ---------------------------------------------------------------------------
# AdmissionGate tests
# ---------------------------------------------------------------------------

class TestAdmissionGate:

    def test_sufficient_stake_admitted(self):
        gate = AdmissionGate(threshold_usdt=10.0)
        result = gate.evaluate("node-1", stake_lifepp=1000, lifepp_usdt_price=0.01)
        assert result.is_admitted
        assert result.usdt_equivalent == 10.0

    def test_insufficient_stake_rejected(self):
        gate = AdmissionGate(threshold_usdt=10.0)
        result = gate.evaluate("node-2", stake_lifepp=500, lifepp_usdt_price=0.01)
        assert not result.is_admitted
        assert result.rejection_reason is not None
        assert "insufficient_stake" in result.rejection_reason

    def test_already_admitted_rejected(self):
        gate = AdmissionGate()
        result = gate.evaluate(
            "node-3", stake_lifepp=2000, lifepp_usdt_price=0.01,
            is_already_admitted=True,
        )
        assert not result.is_admitted
        assert result.rejection_reason == "already_admitted"

    def test_blocked_node_rejected(self):
        gate = AdmissionGate()
        result = gate.evaluate(
            "node-4", stake_lifepp=2000, lifepp_usdt_price=0.01,
            is_blocked=True,
        )
        assert not result.is_admitted
        assert result.rejection_reason == "node_blocked_by_policy"

    def test_boundary_stake_admitted(self):
        gate = AdmissionGate(threshold_usdt=10.0)
        # Exactly at threshold
        result = gate.evaluate("node-5", stake_lifepp=100, lifepp_usdt_price=0.1)
        assert result.is_admitted
        assert result.usdt_equivalent == 10.0


# ---------------------------------------------------------------------------
# CollaborationCostEngine tests
# ---------------------------------------------------------------------------

class TestCollaborationCostEngine:

    def test_cost_is_min_of_usdt_equiv_and_cap(self):
        engine = CollaborationCostEngine()
        # At price 0.01, 0.00001 USDT = 0.001 LIFEPP < 1 LIFEPP
        cost = engine.compute_cost(0.01)
        assert cost == pytest.approx(0.001, rel=1e-3)

    def test_cost_capped_at_1_lifepp(self):
        engine = CollaborationCostEngine()
        # At very low price, equivalent would exceed 1 LIFEPP
        cost = engine.compute_cost(0.000001)
        assert cost == 1.0

    def test_zero_price_returns_cap(self):
        engine = CollaborationCostEngine()
        cost = engine.compute_cost(0.0)
        assert cost == 1.0

    def test_record_and_query_costs(self):
        engine = CollaborationCostEngine()
        engine.record_cost("task-1", "node-1", 0.001)
        engine.record_cost("task-1", "node-1", 0.001)
        assert engine.get_task_cumulative_cost("task-1") == pytest.approx(0.002)
        assert engine.get_node_cumulative_cost("node-1") == pytest.approx(0.002)

    def test_missing_task_returns_zero(self):
        engine = CollaborationCostEngine()
        assert engine.get_task_cumulative_cost("unknown") == 0.0

    def test_custom_parameters(self):
        engine = CollaborationCostEngine(cost_usdt=0.001, max_lifepp=5.0)
        cost = engine.compute_cost(0.001)
        assert cost == 1.0  # 0.001 / 0.001 = 1.0 < 5.0


# ---------------------------------------------------------------------------
# MerchantSettlementService tests
# ---------------------------------------------------------------------------

class TestMerchantSettlementService:

    def test_create_payment(self):
        svc = MerchantSettlementService()
        req = svc.create_payment(
            merchant_node_id="merchant-1",
            payer_node_id="payer-1",
            amount_lifepp=100.0,
        )
        assert req.merchant_node_id == "merchant-1"
        assert req.payer_node_id == "payer-1"
        assert req.amount_lifepp == 100.0
        assert svc.pending_count == 1

    def test_authorise_sufficient_balance(self):
        svc = MerchantSettlementService()
        req = svc.create_payment("merchant-1", "payer-1", 100.0)
        assert svc.authorise_payment(req.request_id, payer_balance=200.0)

    def test_authorise_insufficient_balance(self):
        svc = MerchantSettlementService()
        req = svc.create_payment("merchant-1", "payer-1", 100.0)
        assert not svc.authorise_payment(req.request_id, payer_balance=50.0)

    def test_authorise_nonexistent_request(self):
        svc = MerchantSettlementService()
        assert not svc.authorise_payment("nonexistent", payer_balance=100.0)

    def test_capture_payment(self):
        svc = MerchantSettlementService()
        req = svc.create_payment("merchant-1", "payer-1", 100.0)
        record = svc.capture_payment(req.request_id)
        assert record is not None
        assert record.status == "completed"
        assert record.amount_lifepp == 100.0
        assert svc.pending_count == 0

    def test_capture_nonexistent_returns_none(self):
        svc = MerchantSettlementService()
        assert svc.capture_payment("nonexistent") is None

    def test_batch_settlements(self):
        svc = MerchantSettlementService()
        for i in range(3):
            req = svc.create_payment("merchant-1", f"payer-{i}", 50.0)
            svc.capture_payment(req.request_id)

        batch = svc.batch_settlements()
        assert batch["record_count"] == 3
        assert batch["total_lifepp"] == 150.0
        assert batch["audit_hash"] is not None

    def test_empty_batch(self):
        svc = MerchantSettlementService()
        batch = svc.batch_settlements()
        assert batch["batch_id"] is None
        assert batch["record_count"] == 0

    def test_full_payment_lifecycle(self):
        svc = MerchantSettlementService()
        # 1. Create
        req = svc.create_payment("merchant-1", "payer-1", 75.0, description="Coffee")
        # 2. Authorise
        assert svc.authorise_payment(req.request_id, payer_balance=100.0)
        # 3. Capture
        record = svc.capture_payment(req.request_id)
        assert record is not None
        assert record.status == "completed"
        # 4. Batch
        batch = svc.batch_settlements()
        assert batch["record_count"] == 1
        assert batch["total_lifepp"] == 75.0


# ---------------------------------------------------------------------------
# TreasuryService tests
# ---------------------------------------------------------------------------

class TestTreasuryService:

    def test_compute_treasury_amount(self):
        svc = TreasuryService(treasury_fraction=0.05)
        assert svc.compute_treasury_amount(1000.0) == 50.0

    def test_record_allocation(self):
        svc = TreasuryService(treasury_fraction=0.05)
        allocation = svc.record_allocation("batch-1", 50.0)
        assert allocation["batch_id"] == "batch-1"
        assert allocation["amount_lifepp"] == 50.0
        assert svc.total_allocated == 50.0
        assert svc.allocation_count == 1

    def test_multiple_allocations(self):
        svc = TreasuryService()
        svc.record_allocation("batch-1", 50.0)
        svc.record_allocation("batch-2", 30.0)
        assert svc.total_allocated == 80.0
        assert svc.allocation_count == 2

    def test_invalid_fraction_rejected(self):
        with pytest.raises(ValueError):
            TreasuryService(treasury_fraction=1.5)
        with pytest.raises(ValueError):
            TreasuryService(treasury_fraction=-0.1)

    def test_zero_fraction_allowed(self):
        svc = TreasuryService(treasury_fraction=0.0)
        assert svc.compute_treasury_amount(1000.0) == 0.0

    def test_treasury_node_id(self):
        svc = TreasuryService()
        assert svc.treasury_node_id == "treasury:system"


# ---------------------------------------------------------------------------
# CognitiveValueFlowSystem (facade) tests
# ---------------------------------------------------------------------------

class TestCognitiveValueFlowSystem:

    def test_default_construction(self):
        cvfs = CognitiveValueFlowSystem()
        assert cvfs.current_price > 0

    def test_price_conversion(self):
        oracle = PriceOracle(initial_price=0.05)
        cvfs = CognitiveValueFlowSystem(price_oracle=oracle)
        assert cvfs.lifepp_to_usdt(200) == 10.0
        assert cvfs.usdt_to_lifepp(10.0) == 200.0

    def test_evaluate_admission(self):
        oracle = PriceOracle(initial_price=0.01)
        cvfs = CognitiveValueFlowSystem(price_oracle=oracle)
        result = cvfs.evaluate_admission("node-1", stake_lifepp=1000)
        assert result.is_admitted

    def test_evaluate_admission_insufficient(self):
        oracle = PriceOracle(initial_price=0.01)
        cvfs = CognitiveValueFlowSystem(price_oracle=oracle)
        result = cvfs.evaluate_admission("node-2", stake_lifepp=500)
        assert not result.is_admitted

    def test_compute_collaboration_cost(self):
        oracle = PriceOracle(initial_price=0.01)
        cvfs = CognitiveValueFlowSystem(price_oracle=oracle)
        cost = cvfs.compute_collaboration_cost()
        assert cost == pytest.approx(0.001, rel=1e-3)

    def test_record_collaboration_cost(self):
        cvfs = CognitiveValueFlowSystem()
        cvfs.record_collaboration_cost("task-1", "node-1", 0.5)
        assert cvfs.cost_engine.get_task_cumulative_cost("task-1") == 0.5

    def test_merchant_payment_flow(self):
        cvfs = CognitiveValueFlowSystem()
        req = cvfs.create_merchant_payment(
            merchant_node_id="merchant-1",
            payer_node_id="payer-1",
            amount_lifepp=100.0,
        )
        assert cvfs.authorise_merchant_payment(req.request_id, 200.0)
        record = cvfs.capture_merchant_payment(req.request_id)
        assert record is not None
        batch = cvfs.batch_merchant_settlements()
        assert batch["record_count"] == 1

    def test_treasury_operations(self):
        cvfs = CognitiveValueFlowSystem()
        amount = cvfs.compute_treasury_amount(1000.0)
        assert amount == 50.0  # default 5%
        alloc = cvfs.record_treasury_allocation("batch-1", amount)
        assert alloc["amount_lifepp"] == 50.0
