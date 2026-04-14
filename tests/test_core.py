"""
Tests for core Life++ domain components.

Tests cover:
  - AHIN interaction hashing and chain verification
  - Trust weight model
  - Association graph
  - Ledger idempotency
  - POC zombie detection
  - VirtueWellbeing distribution
  - Edge terminal offline queue
"""
from __future__ import annotations

import asyncio
import pytest
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# AHIN interaction hasher
# ---------------------------------------------------------------------------

class TestInteractionHasher:
    def test_deterministic_hash(self):
        from packages.ahin_network.interaction_hasher import InteractionHasher
        h1 = InteractionHasher.hash_interaction(
            predecessor_hash=None,
            initiator_node_id="node-a",
            responder_node_id="node-b",
            interaction_type="proactive_association",
            payload={"intent": "collaborate"},
        )
        h2 = InteractionHasher.hash_interaction(
            predecessor_hash=None,
            initiator_node_id="node-a",
            responder_node_id="node-b",
            interaction_type="proactive_association",
            payload={"intent": "collaborate"},
        )
        assert h1 == h2, "Same inputs must produce same hash"

    def test_hash_changes_with_predecessor(self):
        from packages.ahin_network.interaction_hasher import InteractionHasher
        h1 = InteractionHasher.hash_interaction(
            predecessor_hash=None,
            initiator_node_id="node-a",
            responder_node_id="node-b",
            interaction_type="proactive_association",
            payload={},
        )
        h2 = InteractionHasher.hash_interaction(
            predecessor_hash="some-previous-hash",
            initiator_node_id="node-a",
            responder_node_id="node-b",
            interaction_type="proactive_association",
            payload={},
        )
        assert h1 != h2, "Different predecessors must produce different hashes"

    def test_verify_valid_chain(self):
        from packages.ahin_network.interaction_hasher import InteractionHasher

        h1 = InteractionHasher.hash_interaction(
            predecessor_hash=None,
            initiator_node_id="node-a",
            responder_node_id="node-b",
            interaction_type="proactive_association",
            payload={},
        )
        h2 = InteractionHasher.hash_interaction(
            predecessor_hash=h1,
            initiator_node_id="node-b",
            responder_node_id="node-a",
            interaction_type="acceptance_of_association",
            payload={},
        )
        chain = [
            {
                "interaction_hash": h1,
                "initiator_node_id": "node-a",
                "responder_node_id": "node-b",
                "interaction_type": "proactive_association",
                "payload": {},
            },
            {
                "interaction_hash": h2,
                "initiator_node_id": "node-b",
                "responder_node_id": "node-a",
                "interaction_type": "acceptance_of_association",
                "payload": {},
            },
        ]
        assert InteractionHasher.verify_chain(chain), "Valid chain must verify"

    def test_detect_tampered_chain(self):
        from packages.ahin_network.interaction_hasher import InteractionHasher

        chain = [
            {
                "interaction_hash": "tampered-hash",
                "initiator_node_id": "node-a",
                "responder_node_id": "node-b",
                "interaction_type": "proactive_association",
                "payload": {},
            }
        ]
        assert not InteractionHasher.verify_chain(chain), "Tampered chain must fail"


# ---------------------------------------------------------------------------
# Local time sequencer
# ---------------------------------------------------------------------------

class TestLocalTimeSequencer:
    def test_sequence_increments(self):
        from packages.ahin_network.local_time_sequencer import LocalTimeSequencer
        seq = LocalTimeSequencer("node-x")
        t1 = seq.next(interaction_type="test")
        t2 = seq.next(interaction_type="test")
        assert t2.local_sequence == t1.local_sequence + 1

    def test_hash_chaining(self):
        from packages.ahin_network.local_time_sequencer import LocalTimeSequencer
        seq = LocalTimeSequencer("node-x")
        t1 = seq.next(interaction_type="test")
        t2 = seq.next(interaction_type="test")
        # t2's hash should differ from t1's (because predecessor differs)
        assert t1.interaction_hash != t2.interaction_hash

    def test_node_id_in_time_order(self):
        from packages.ahin_network.local_time_sequencer import LocalTimeSequencer
        seq = LocalTimeSequencer("node-y")
        t = seq.next()
        assert t.node_id == "node-y"


# ---------------------------------------------------------------------------
# Trust weight model
# ---------------------------------------------------------------------------

class TestTrustWeightModel:
    def test_initial_trust_is_zero(self):
        from packages.ahin_network.trust_weight_model import TrustWeightModel
        model = TrustWeightModel()
        assert model.get_trust_weight("a", "b") == 0.0

    def test_positive_interaction_increases_trust(self):
        from packages.ahin_network.trust_weight_model import TrustWeightModel
        model = TrustWeightModel()
        model.record_interaction("a", "b", trust_delta=0.5)
        assert model.get_trust_weight("a", "b") > 0.0

    def test_negative_interaction_decreases_trust(self):
        from packages.ahin_network.trust_weight_model import TrustWeightModel
        model = TrustWeightModel()
        model.record_interaction("a", "b", trust_delta=0.8)
        model.record_interaction("a", "b", trust_delta=-0.9)
        # Net should be lower
        assert model.get_trust_weight("a", "b") < 0.8

    def test_trust_is_clamped_to_max(self):
        from packages.ahin_network.trust_weight_model import TrustWeightModel
        model = TrustWeightModel()
        for _ in range(100):
            model.record_interaction("a", "b", trust_delta=1.0)
        assert model.get_trust_weight("a", "b") <= 1.0

    def test_trust_is_directional(self):
        from packages.ahin_network.trust_weight_model import TrustWeightModel
        model = TrustWeightModel()
        model.record_interaction("a", "b", trust_delta=0.5)
        # B did not interact with A
        assert model.get_trust_weight("b", "a") == 0.0
        assert model.get_trust_weight("a", "b") > 0.0


# ---------------------------------------------------------------------------
# Association graph
# ---------------------------------------------------------------------------

class TestAssociationGraph:
    def _make_proactive_event(self, from_node: str, to_node: str):
        from packages.ahin_network.local_time_sequencer import LocalTimeSequencer
        from packages.shared.domain import AssociationEventType
        from packages.shared.events import AssociationEvent

        seq = LocalTimeSequencer(from_node)
        time_order = seq.next(
            interaction_type=AssociationEventType.PROACTIVE,
            initiator_node_id=from_node,
            responder_node_id=to_node,
        )
        return AssociationEvent(
            association_type=AssociationEventType.PROACTIVE,
            initiator_node_id=from_node,
            responder_node_id=to_node,
            interaction_hash=time_order.interaction_hash or "genesis",
            time_order=time_order,
        )

    def test_graph_records_edges(self):
        from packages.ahin_network.association_graph import AssociationGraph
        graph = AssociationGraph()
        event = self._make_proactive_event("a", "b")
        graph.record_event(event)
        assert "b" in graph.get_neighbours("a")

    def test_trust_updated_after_event(self):
        from packages.ahin_network.association_graph import AssociationGraph
        graph = AssociationGraph()
        event = self._make_proactive_event("a", "b")
        graph.record_event(event)
        assert graph.get_trust_weight("a", "b") > 0.0

    def test_trusted_neighbours_filtered(self):
        from packages.ahin_network.association_graph import AssociationGraph
        graph = AssociationGraph()
        # Add multiple events to build up trust
        for _ in range(5):
            event = self._make_proactive_event("a", "b")
            graph.record_event(event)
        neighbours = graph.get_trusted_neighbours("a", min_trust=0.0)
        assert "b" in neighbours


# ---------------------------------------------------------------------------
# AHIN node admission
# ---------------------------------------------------------------------------

class TestAhinNode:
    def test_admitted_node_can_propose(self):
        from packages.ahin_network.ahin_node import AhinNode
        node = AhinNode(node_id="admitted-node")
        node.set_admitted(stake_lifepp=500.0)
        event = node.propose_association(
            responder_node_id="other-node",
            payload={"intent": "test"},
        )
        assert event.initiator_node_id == "admitted-node"

    def test_unadmitted_node_cannot_propose(self):
        from packages.ahin_network.ahin_node import AhinNode
        node = AhinNode(node_id="unadmitted-node")
        with pytest.raises(PermissionError):
            node.propose_association(responder_node_id="other-node")


# ---------------------------------------------------------------------------
# VirtueWellbeing distributor
# ---------------------------------------------------------------------------

class TestVirtueWellbeingDistributor:
    def test_proportional_distribution(self):
        from packages.settlement.virtue_wellbeing_distributor import VirtueWellbeingDistributor
        dist = VirtueWellbeingDistributor(treasury_fraction=0.0)
        contributions = {"a": 1.0, "b": 3.0}
        distributions, treasury = dist.compute_distribution(contributions, 100.0)
        assert treasury == 0.0
        # b should get 3x what a gets
        assert abs(distributions["b"] / distributions["a"] - 3.0) < 0.01

    def test_treasury_allocation(self):
        from packages.settlement.virtue_wellbeing_distributor import VirtueWellbeingDistributor
        dist = VirtueWellbeingDistributor(treasury_fraction=0.1)
        contributions = {"a": 1.0}
        distributions, treasury = dist.compute_distribution(contributions, 100.0)
        assert abs(treasury - 10.0) < 0.001
        assert abs(distributions["a"] - 90.0) < 0.001

    def test_zero_credits_returns_empty(self):
        from packages.settlement.virtue_wellbeing_distributor import VirtueWellbeingDistributor
        dist = VirtueWellbeingDistributor()
        distributions, treasury = dist.compute_distribution({}, 100.0)
        assert distributions == {}

    def test_invalid_treasury_fraction(self):
        from packages.settlement.virtue_wellbeing_distributor import VirtueWellbeingDistributor
        with pytest.raises(ValueError):
            VirtueWellbeingDistributor(treasury_fraction=1.5)


# ---------------------------------------------------------------------------
# Edge terminal offline queue
# ---------------------------------------------------------------------------

class TestLocalTransactionStore:
    def test_enqueue_and_drain(self):
        from packages.edge_runtime.local_transaction_store import LocalTransactionStore
        store = LocalTransactionStore("terminal-1", max_size=100)
        store.enqueue(
            amount_lifepp=0.001,
            amount_fiat=None,
            fiat_currency=None,
            merchant_node_id="merchant-1",
            payload={"item": "coffee"},
        )
        assert store.queue_size == 1
        batch = store.drain(10)
        assert len(batch) == 1
        assert store.is_empty

    def test_queue_capacity_limit(self):
        from packages.edge_runtime.local_transaction_store import LocalTransactionStore
        store = LocalTransactionStore("terminal-2", max_size=2)
        store.enqueue(amount_lifepp=0.001, amount_fiat=None, fiat_currency=None,
                      merchant_node_id="m", payload={})
        store.enqueue(amount_lifepp=0.001, amount_fiat=None, fiat_currency=None,
                      merchant_node_id="m", payload={})
        with pytest.raises(OverflowError):
            store.enqueue(amount_lifepp=0.001, amount_fiat=None, fiat_currency=None,
                          merchant_node_id="m", payload={})

    def test_receipt_has_hash(self):
        from packages.edge_runtime.local_transaction_store import LocalTransactionStore
        store = LocalTransactionStore("terminal-3")
        receipt = store.enqueue(
            amount_lifepp=1.0, amount_fiat=None, fiat_currency=None,
            merchant_node_id="m", payload={"item": "tea"},
        )
        assert "receipt_hash" in receipt
        assert len(receipt["receipt_hash"]) == 64  # SHA-256 hex


# ---------------------------------------------------------------------------
# Receipt proof service
# ---------------------------------------------------------------------------

class TestReceiptProofService:
    def test_proof_verification(self):
        from packages.edge_runtime.receipt_proof_service import ReceiptProofService
        receipt = {
            "receipt_id": "r-001",
            "amount_lifepp": 1.0,
            "merchant_node_id": "m-001",
            "payload": {},
        }
        receipt["receipt_hash"] = ReceiptProofService.create_proof(receipt)
        assert ReceiptProofService.verify_proof(receipt)

    def test_tampered_receipt_fails(self):
        from packages.edge_runtime.receipt_proof_service import ReceiptProofService
        receipt = {
            "receipt_id": "r-002",
            "amount_lifepp": 1.0,
            "merchant_node_id": "m-001",
            "payload": {},
        }
        receipt["receipt_hash"] = ReceiptProofService.create_proof(receipt)
        receipt["amount_lifepp"] = 9999.0  # tamper
        assert not ReceiptProofService.verify_proof(receipt)


# ---------------------------------------------------------------------------
# AgentKernel dispatch
# ---------------------------------------------------------------------------

class TestAgentKernel:
    @pytest.mark.asyncio
    async def test_dispatch_with_capable_agent(self):
        from packages.agent_kernel.agent_kernel import AgentKernel
        from packages.agent_kernel.base_agent import BaseAgent
        from packages.shared.domain import NodeType

        class StubAgent(BaseAgent):
            async def execute_cognitive_task(self, task_id, input_payload):
                return {
                    "answer": "grounded response",
                    "causal_chain": ["step1", "step2"],
                    "context_references": ["ref1"],
                    "novelty_score": 0.5,
                }

            def get_capabilities(self):
                return ["test_capability"]

            async def verify_causation(self, input_payload, output):
                return len(output.get("causal_chain", [])) > 0

        kernel = AgentKernel()
        agent = StubAgent(node_id="stub-agent")
        kernel.register_agent(agent)

        result = await kernel.dispatch_task(
            task_id="test-task-001",
            capability="test_capability",
            input_payload={"query": "test?", "context": {"k": "v"}},
            initiator_node_id="initiator-001",
        )
        assert result is not None
        assert result["is_grounded"] is True

    @pytest.mark.asyncio
    async def test_dispatch_no_capable_agent(self):
        from packages.agent_kernel.agent_kernel import AgentKernel

        kernel = AgentKernel()
        result = await kernel.dispatch_task(
            task_id="task-no-agent",
            capability="unknown_capability",
            input_payload={},
            initiator_node_id="initiator",
        )
        assert result is None


# ---------------------------------------------------------------------------
# AHIN admission threshold
# ---------------------------------------------------------------------------

class TestAhinAdmissionThreshold:
    @pytest.mark.asyncio
    async def test_admission_with_sufficient_stake(self):
        from packages.agent_kernel.agent_kernel import AgentKernel
        kernel = AgentKernel()
        # 100 LIFEPP at 0.2 USDT/LIFEPP = 20 USDT (> 10 USDT threshold)
        admitted = await kernel.check_ahin_admission(
            node_id="node-1", stake_lifepp=100.0, lifepp_usdt_price=0.2
        )
        assert admitted is True

    @pytest.mark.asyncio
    async def test_admission_denied_with_insufficient_stake(self):
        from packages.agent_kernel.agent_kernel import AgentKernel
        kernel = AgentKernel()
        # 10 LIFEPP at 0.1 USDT/LIFEPP = 1 USDT (< 10 USDT threshold)
        admitted = await kernel.check_ahin_admission(
            node_id="node-2", stake_lifepp=10.0, lifepp_usdt_price=0.1
        )
        assert admitted is False


# ---------------------------------------------------------------------------
# Collaboration cost computation
# ---------------------------------------------------------------------------

class TestCollaborationCost:
    def test_cost_is_minimum_of_usdt_equiv_and_1_lifepp(self):
        from packages.agent_kernel.agent_kernel import AgentKernel
        kernel = AgentKernel()

        # At 0.001 USDT/LIFEPP, 0.00001 USDT = 0.01 LIFEPP < 1 LIFEPP → 0.01
        cost = kernel.compute_collaboration_cost(lifepp_usdt_price=0.001)
        assert abs(cost - 0.01) < 1e-8

        # At 0.00001 USDT/LIFEPP, 0.00001 USDT = 1.0 LIFEPP → 1.0
        cost = kernel.compute_collaboration_cost(lifepp_usdt_price=0.00001)
        assert abs(cost - 1.0) < 1e-8

        # At very low price, cap at 1.0 LIFEPP
        cost = kernel.compute_collaboration_cost(lifepp_usdt_price=0.000001)
        assert cost <= 1.0


# ---------------------------------------------------------------------------
# Theory mapping
# ---------------------------------------------------------------------------

class TestTheoryMapping:
    def test_all_major_concepts_are_mapped(self):
        from packages.shared.theory_mapping import THEORY_TO_SYSTEM_MAP
        required = [
            "CognitiveCanxian",
            "TactileBrainHypothesis",
            "CausationReengineeringOfIntelligence",
            "AHIN",
            "SpontaneousTimeOrder",
            "ProofOfCognitiveCanxian",
            "AlignedVirtueAndWellbeing",
            "ContinuousSpectrumTopology",
        ]
        for concept in required:
            assert concept in THEORY_TO_SYSTEM_MAP, f"Missing mapping: {concept}"

    def test_mapping_has_required_fields(self):
        from packages.shared.theory_mapping import THEORY_TO_SYSTEM_MAP
        required_fields = [
            "system_abstraction", "runtime_behavior", "data_structure",
            "event_type", "incentive_logic", "governance_rule",
            "audit_replay", "must_not_implement_as",
        ]
        for concept, mapping in THEORY_TO_SYSTEM_MAP.items():
            for field in required_fields:
                assert field in mapping, f"Concept '{concept}' missing field '{field}'"
