"""
Tests for the Life++ Lite Edge Terminal.

Tests cover:
  - CognitiveInteractionHandler: local contextual interaction capture
  - TrustAnchorService: AHIN trust-anchored interaction events
  - AgentParticipationTracker: agent collaboration auditability
  - DayCloseHandler: day-end reconciliation
  - EdgeRuntime: integrated terminal lifecycle
  - EdgeTerminalEvent: new event type
  - LifePlusLiteEdgeTerminal theory mapping
  - FastAPI edge terminal app endpoints
"""
from __future__ import annotations

import pytest
from typing import Any, Dict, List


# ---------------------------------------------------------------------------
# CognitiveInteractionHandler
# ---------------------------------------------------------------------------

class TestCognitiveInteractionHandler:
    def _make_handler(self):
        from packages.ahin_network.local_time_sequencer import LocalTimeSequencer
        from packages.edge_runtime.cognitive_interaction_handler import CognitiveInteractionHandler
        seq = LocalTimeSequencer("terminal-test")
        return CognitiveInteractionHandler(
            terminal_node_id="terminal-test", sequencer=seq
        )

    def test_capture_interaction_with_device_context(self):
        handler = self._make_handler()
        record = handler.capture_interaction(
            interaction_type="purchase",
            user_intent={"item": "coffee", "quantity": 1},
            device_context={"location": "shop-001", "modality": "nfc"},
        )
        assert record["terminal_node_id"] == "terminal-test"
        assert record["interaction_type"] == "purchase"
        assert record["artifact_status"] == "grounded"
        assert "content_hash" in record
        assert len(record["content_hash"]) == 64  # SHA-256 hex

    def test_capture_interaction_without_device_context_still_grounded(self):
        """User intent alone provides grounding per Tactile Brain Hypothesis."""
        handler = self._make_handler()
        record = handler.capture_interaction(
            interaction_type="query",
            user_intent={"question": "What is the balance?"},
        )
        # Has user_interaction in grounding_context → GROUNDED
        assert record["artifact_status"] == "grounded"

    def test_capture_interaction_with_agents(self):
        handler = self._make_handler()
        record = handler.capture_interaction(
            interaction_type="agent_request",
            user_intent={"task": "translate document"},
            agent_node_ids=["agent-a", "agent-b"],
        )
        assert record["agent_node_ids"] == ["agent-a", "agent-b"]
        gc = record["grounding_context"]
        assert "agent_collaboration" in gc
        assert gc["agent_collaboration"]["collaboration_count"] == 2

    def test_interaction_log_accumulates(self):
        handler = self._make_handler()
        handler.capture_interaction("purchase", {"item": "tea"})
        handler.capture_interaction("query", {"q": "price?"})
        assert handler.interaction_count == 2
        log = handler.get_interaction_log()
        assert len(log) == 2

    def test_spontaneous_time_order_present(self):
        handler = self._make_handler()
        record = handler.capture_interaction("test", {"key": "val"})
        sto = record["spontaneous_time_order"]
        assert sto["node_id"] == "terminal-test"
        assert sto["local_sequence"] >= 1
        assert sto["interaction_hash"] is not None

    def test_sequential_interactions_have_increasing_sequence(self):
        handler = self._make_handler()
        r1 = handler.capture_interaction("a", {"k": "1"})
        r2 = handler.capture_interaction("b", {"k": "2"})
        s1 = r1["spontaneous_time_order"]["local_sequence"]
        s2 = r2["spontaneous_time_order"]["local_sequence"]
        assert s2 > s1


# ---------------------------------------------------------------------------
# TrustAnchorService
# ---------------------------------------------------------------------------

class TestTrustAnchorService:
    def _make_service(self, admitted: bool = True):
        from packages.ahin_network.ahin_node import AhinNode
        from packages.ahin_network.local_time_sequencer import LocalTimeSequencer
        from packages.edge_runtime.trust_anchor_service import TrustAnchorService
        from packages.shared.domain import NodeType

        node = AhinNode(node_id="terminal-trust", node_type=NodeType.EDGE_TERMINAL)
        if admitted:
            node.set_admitted(stake_lifepp=100.0)
        seq = LocalTimeSequencer("terminal-trust")
        return TrustAnchorService(
            terminal_node_id="terminal-trust",
            ahin_node=node,
            sequencer=seq,
        )

    def test_anchor_interaction_when_admitted(self):
        service = self._make_service(admitted=True)
        anchor = service.anchor_interaction(
            responder_node_id="customer-1",
            interaction_context={"type": "payment"},
            trust_delta=0.1,
        )
        assert anchor["initiator_node_id"] == "terminal-trust"
        assert anchor["responder_node_id"] == "customer-1"
        assert anchor["trust_delta"] == 0.1
        assert anchor["event_id"] is not None
        assert anchor["interaction_hash"] is not None
        assert anchor["current_trust_weight"] > 0.0

    def test_anchor_when_unadmitted_returns_degraded(self):
        service = self._make_service(admitted=False)
        anchor = service.anchor_interaction(
            responder_node_id="customer-2",
            interaction_context={"type": "test"},
        )
        assert anchor.get("is_degraded") is True
        assert anchor["trust_delta"] == 0.0
        assert anchor["event_id"] is None

    def test_multiple_anchors_increase_trust(self):
        service = self._make_service(admitted=True)
        service.anchor_interaction("node-x", {"a": 1}, trust_delta=0.2)
        service.anchor_interaction("node-x", {"b": 2}, trust_delta=0.3)
        weight = service.get_trust_weight("node-x")
        assert weight > 0.0

    def test_anchor_log_accumulates(self):
        service = self._make_service(admitted=True)
        service.anchor_interaction("n1", {})
        service.anchor_interaction("n2", {})
        assert service.anchor_count == 2
        log = service.get_anchor_log()
        assert len(log) == 2


# ---------------------------------------------------------------------------
# AgentParticipationTracker
# ---------------------------------------------------------------------------

class TestAgentParticipationTracker:
    def _make_tracker(self):
        from packages.edge_runtime.agent_participation_tracker import AgentParticipationTracker
        return AgentParticipationTracker(terminal_node_id="terminal-part")

    def test_record_participation(self):
        tracker = self._make_tracker()
        record = tracker.record_participation(
            agent_node_id="agent-1",
            interaction_id="int-001",
            role="executor",
            contribution_summary="Translated document from EN to ZH",
            grounding_evidence={"source_doc": "doc-123"},
        )
        assert record.agent_node_id == "agent-1"
        assert record.role == "executor"
        assert tracker.total_records == 1

    def test_query_by_interaction(self):
        tracker = self._make_tracker()
        tracker.record_participation("a1", "int-1", "executor", "Did X")
        tracker.record_participation("a2", "int-1", "validator", "Checked X")
        tracker.record_participation("a3", "int-2", "advisor", "Suggested Y")
        records = tracker.get_participation_for_interaction("int-1")
        assert len(records) == 2

    def test_query_by_agent(self):
        tracker = self._make_tracker()
        tracker.record_participation("agent-1", "int-1", "executor", "A")
        tracker.record_participation("agent-1", "int-2", "advisor", "B")
        tracker.record_participation("agent-2", "int-1", "validator", "C")
        records = tracker.get_participation_for_agent("agent-1")
        assert len(records) == 2

    def test_contribution_summary(self):
        tracker = self._make_tracker()
        tracker.record_participation("a1", "int-1", "executor",
                                     "Translated purchase request from EN to ZH",
                                     grounding_evidence={"source_doc": "invoice-42"})
        tracker.record_participation("a1", "int-2", "advisor",
                                     "Recommended optimal payment routing")
        tracker.record_participation("a2", "int-1", "validator",
                                     "Verified translation accuracy against source")
        summary = tracker.get_contribution_summary()
        assert summary["a1"]["participation_count"] == 2
        assert "executor" in summary["a1"]["roles"]
        assert "advisor" in summary["a1"]["roles"]
        assert summary["a1"]["has_grounding_evidence"] is True
        assert summary["a2"]["participation_count"] == 1

    def test_audit_hash_deterministic(self):
        tracker = self._make_tracker()
        tracker.record_participation("a1", "int-1", "executor", "X")
        h1 = tracker.generate_audit_hash()
        h2 = tracker.generate_audit_hash()
        assert h1 == h2
        assert len(h1) == 64  # SHA-256

    def test_zombie_participation_detection(self):
        tracker = self._make_tracker()
        # Agent with no grounding evidence → suspicious
        tracker.record_participation("zombie-agent", "int-1", "executor", "generic output")
        assert tracker.detect_zombie_participation("zombie-agent") is True

        # Agent with grounding evidence → not suspicious
        tracker.record_participation("good-agent", "int-2", "executor", "grounded",
                                     grounding_evidence={"source": "real-data"})
        assert tracker.detect_zombie_participation("good-agent") is False

    def test_nonexistent_agent_not_zombie(self):
        tracker = self._make_tracker()
        assert tracker.detect_zombie_participation("nobody") is False


# ---------------------------------------------------------------------------
# DayCloseHandler
# ---------------------------------------------------------------------------

class TestDayCloseHandler:
    @pytest.mark.asyncio
    async def test_day_close_produces_reconciliation(self):
        from packages.ahin_network.ahin_node import AhinNode
        from packages.ahin_network.local_time_sequencer import LocalTimeSequencer
        from packages.edge_runtime.agent_participation_tracker import AgentParticipationTracker
        from packages.edge_runtime.cognitive_interaction_handler import CognitiveInteractionHandler
        from packages.edge_runtime.day_close_handler import DayCloseHandler
        from packages.edge_runtime.local_transaction_store import LocalTransactionStore
        from packages.edge_runtime.trust_anchor_service import TrustAnchorService
        from packages.shared.domain import NodeType

        seq = LocalTimeSequencer("terminal-dc")
        store = LocalTransactionStore("terminal-dc", max_size=100, sequencer=seq)
        node = AhinNode(node_id="terminal-dc", node_type=NodeType.EDGE_TERMINAL)
        node.set_admitted(100.0)

        handler = CognitiveInteractionHandler("terminal-dc", seq)
        trust_svc = TrustAnchorService("terminal-dc", node, seq)
        tracker = AgentParticipationTracker("terminal-dc")

        # Simulate some activity
        interaction = handler.capture_interaction("purchase", {"item": "tea"})
        trust_svc.anchor_interaction("customer-1", {"type": "payment"})
        tracker.record_participation(
            "agent-1", interaction["interaction_id"], "executor", "Processed payment"
        )

        day_close = DayCloseHandler(
            terminal_node_id="terminal-dc",
            store=store,
            sync_manager=None,
            interaction_handler=handler,
            trust_anchor_service=trust_svc,
            participation_tracker=tracker,
        )

        result = await day_close.execute_day_close()
        assert result["terminal_node_id"] == "terminal-dc"
        assert result["interaction_count"] == 1
        assert result["trust_anchor_count"] == 1
        assert "audit_hash" in result
        assert len(result["audit_hash"]) == 64
        assert "agent-1" in result["participation_summary"]


# ---------------------------------------------------------------------------
# EdgeRuntime integrated tests
# ---------------------------------------------------------------------------

class TestEdgeRuntimeIntegrated:
    def test_device_status_includes_new_fields(self):
        from packages.edge_runtime.edge_runtime import EdgeRuntime
        rt = EdgeRuntime(terminal_id="t-int", merchant_node_id="m-int")
        status = rt.device_status()
        assert "interaction_count" in status
        assert "trust_anchor_count" in status
        assert "agent_participation_count" in status
        assert status["interaction_count"] == 0
        assert status["trust_anchor_count"] == 0

    def test_capture_interaction(self):
        from packages.edge_runtime.edge_runtime import EdgeRuntime
        rt = EdgeRuntime(terminal_id="t-cap", merchant_node_id="m-cap")
        record = rt.capture_interaction(
            interaction_type="query",
            user_intent={"q": "What is AHIN?"},
            device_context={"screen": "touch"},
        )
        assert record["artifact_status"] == "grounded"
        assert rt.device_status()["interaction_count"] == 1

    @pytest.mark.asyncio
    async def test_accept_payment_with_trust_anchor(self):
        from packages.edge_runtime.edge_runtime import EdgeRuntime
        rt = EdgeRuntime(terminal_id="t-pay", merchant_node_id="m-pay")
        rt.set_admitted(stake_lifepp=100.0)

        receipt = await rt.accept_payment(
            amount_lifepp=0.5,
            customer_node_id="cust-1",
            payload={"item": "book"},
            device_context={"location": "bookstore"},
        )
        assert receipt["is_offline"] is True  # No transfer engine
        assert "trust_anchor" in receipt
        assert receipt["interaction_id"] is not None

    @pytest.mark.asyncio
    async def test_accept_payment_without_admission(self):
        from packages.edge_runtime.edge_runtime import EdgeRuntime
        rt = EdgeRuntime(terminal_id="t-noadm", merchant_node_id="m-noadm")
        # Not admitted — payment should still work, but no trust anchor
        receipt = await rt.accept_payment(
            amount_lifepp=1.0,
            customer_node_id="cust-2",
            payload={"item": "pen"},
        )
        assert "trust_anchor" not in receipt

    def test_anchor_trust(self):
        from packages.edge_runtime.edge_runtime import EdgeRuntime
        rt = EdgeRuntime(terminal_id="t-trust", merchant_node_id="m-trust")
        rt.set_admitted(stake_lifepp=100.0)
        anchor = rt.anchor_trust(
            responder_node_id="collaborator-1",
            interaction_context={"type": "service"},
            trust_delta=0.15,
        )
        assert anchor["trust_delta"] == 0.15
        assert anchor["event_id"] is not None

    def test_record_agent_participation(self):
        from packages.edge_runtime.edge_runtime import EdgeRuntime
        rt = EdgeRuntime(terminal_id="t-agent", merchant_node_id="m-agent")
        result = rt.record_agent_participation(
            agent_node_id="agent-1",
            interaction_id="int-001",
            role="executor",
            contribution_summary="Processed request",
            grounding_evidence={"source": "document-x"},
        )
        assert result["agent_node_id"] == "agent-1"
        assert rt.device_status()["agent_participation_count"] == 1

    @pytest.mark.asyncio
    async def test_day_close(self):
        from packages.edge_runtime.edge_runtime import EdgeRuntime
        rt = EdgeRuntime(terminal_id="t-dc", merchant_node_id="m-dc")
        rt.capture_interaction("test", {"k": "v"})
        result = await rt.execute_day_close()
        assert result["terminal_node_id"] == "t-dc"
        assert result["interaction_count"] == 1

    def test_is_admitted_property(self):
        from packages.edge_runtime.edge_runtime import EdgeRuntime
        rt = EdgeRuntime(terminal_id="t-adm")
        assert rt.is_admitted is False
        rt.set_admitted(50.0)
        assert rt.is_admitted is True


# ---------------------------------------------------------------------------
# EdgeTerminalEvent
# ---------------------------------------------------------------------------

class TestEdgeTerminalEvent:
    def test_edge_terminal_event_creation(self):
        from packages.shared.domain import SpontaneousTimeOrder, now_utc
        from packages.shared.events import EdgeTerminalEvent

        event = EdgeTerminalEvent(
            terminal_node_id="terminal-evt",
            interaction_type="payment_acceptance",
            customer_node_id="cust-1",
            merchant_node_id="merch-1",
            amount_lifepp=1.5,
            grounding_context={"device": "nfc-reader", "location": "shop-01"},
            time_order=SpontaneousTimeOrder(
                local_sequence=1,
                node_id="terminal-evt",
            ),
        )
        assert event.event_name == "edge_terminal_event"
        assert event.terminal_node_id == "terminal-evt"
        assert event.interaction_type == "payment_acceptance"
        assert event.grounding_context["device"] == "nfc-reader"
        assert event.is_offline is False

    def test_edge_terminal_event_with_agent_participation(self):
        from packages.shared.domain import SpontaneousTimeOrder
        from packages.shared.events import EdgeTerminalEvent

        event = EdgeTerminalEvent(
            terminal_node_id="terminal-ap",
            interaction_type="agent_collaboration",
            agent_participation={
                "agent-1": {"role": "executor", "contribution": "translated"},
                "agent-2": {"role": "validator", "contribution": "verified"},
            },
            time_order=SpontaneousTimeOrder(
                local_sequence=2,
                node_id="terminal-ap",
            ),
        )
        assert len(event.agent_participation) == 2
        assert "agent-1" in event.agent_participation

    def test_edge_terminal_event_offline(self):
        from packages.shared.domain import SpontaneousTimeOrder
        from packages.shared.events import EdgeTerminalEvent

        event = EdgeTerminalEvent(
            terminal_node_id="terminal-off",
            interaction_type="payment_acceptance",
            is_offline=True,
            time_order=SpontaneousTimeOrder(
                local_sequence=3,
                node_id="terminal-off",
            ),
        )
        assert event.is_offline is True


# ---------------------------------------------------------------------------
# Theory mapping — LifePlusLiteEdgeTerminal
# ---------------------------------------------------------------------------

class TestLifePlusLiteEdgeTerminalMapping:
    def test_mapping_exists(self):
        from packages.shared.theory_mapping import THEORY_TO_SYSTEM_MAP
        assert "LifePlusLiteEdgeTerminal" in THEORY_TO_SYSTEM_MAP

    def test_mapping_has_all_required_fields(self):
        from packages.shared.theory_mapping import THEORY_TO_SYSTEM_MAP
        mapping = THEORY_TO_SYSTEM_MAP["LifePlusLiteEdgeTerminal"]
        required = [
            "theoretical_meaning", "system_abstraction", "runtime_behavior",
            "data_structure", "event_type", "incentive_logic",
            "governance_rule", "audit_replay", "must_not_implement_as",
        ]
        for field in required:
            assert field in mapping, f"Missing field: {field}"

    def test_mapping_mentions_key_concepts(self):
        from packages.shared.theory_mapping import THEORY_TO_SYSTEM_MAP
        mapping = THEORY_TO_SYSTEM_MAP["LifePlusLiteEdgeTerminal"]
        text = str(mapping)
        assert "EdgeRuntime" in text
        assert "CognitiveInteractionHandler" in text
        assert "TrustAnchorService" in text
        assert "AgentParticipationTracker" in text
        assert "DayCloseHandler" in text
        assert "global consensus" in text.lower()


# ---------------------------------------------------------------------------
# FastAPI edge terminal app
# ---------------------------------------------------------------------------

class TestEdgeTerminalApp:
    @pytest.fixture
    def client(self):
        from httpx import ASGITransport, AsyncClient
        from apps.edge_terminal.main import create_edge_terminal_app

        app = create_edge_terminal_app(
            terminal_id="test-terminal",
            merchant_node_id="test-merchant",
        )
        # Admit the terminal for trust anchoring tests
        app.state.runtime.set_admitted(stake_lifepp=100.0)

        transport = ASGITransport(app=app)
        return AsyncClient(transport=transport, base_url="http://test")

    @pytest.mark.asyncio
    async def test_get_status(self, client):
        async with client as c:
            resp = await c.get("/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["terminal_id"] == "test-terminal"
        assert data["merchant_node_id"] == "test-merchant"

    @pytest.mark.asyncio
    async def test_capture_interaction(self, client):
        async with client as c:
            resp = await c.post("/interaction", json={
                "interaction_type": "purchase",
                "user_intent": {"item": "coffee"},
                "device_context": {"location": "cafe"},
            })
        assert resp.status_code == 200
        data = resp.json()
        assert data["artifact_status"] == "grounded"

    @pytest.mark.asyncio
    async def test_accept_payment(self, client):
        async with client as c:
            resp = await c.post("/payment", json={
                "amount_lifepp": 0.5,
                "customer_node_id": "cust-1",
                "payload": {"item": "book"},
            })
        assert resp.status_code == 200
        data = resp.json()
        assert "receipt_id" in data

    @pytest.mark.asyncio
    async def test_anchor_trust(self, client):
        async with client as c:
            resp = await c.post("/trust/anchor", json={
                "responder_node_id": "partner-1",
                "interaction_context": {"type": "collaboration"},
                "trust_delta": 0.1,
            })
        assert resp.status_code == 200
        data = resp.json()
        assert data["trust_delta"] == 0.1
        assert data["event_id"] is not None

    @pytest.mark.asyncio
    async def test_record_agent_participation(self, client):
        async with client as c:
            resp = await c.post("/agent/participate", json={
                "agent_node_id": "agent-1",
                "interaction_id": "int-001",
                "role": "executor",
                "contribution_summary": "Processed payment",
            })
        assert resp.status_code == 200
        data = resp.json()
        assert data["agent_node_id"] == "agent-1"

    @pytest.mark.asyncio
    async def test_sync_offline_queue(self, client):
        async with client as c:
            resp = await c.post("/sync")
        assert resp.status_code == 200
        data = resp.json()
        assert "synced_count" in data

    @pytest.mark.asyncio
    async def test_day_close(self, client):
        async with client as c:
            # First capture an interaction
            await c.post("/interaction", json={
                "interaction_type": "test",
                "user_intent": {"k": "v"},
            })
            resp = await c.post("/day-close")
        assert resp.status_code == 200
        data = resp.json()
        assert data["terminal_node_id"] == "test-terminal"
        assert "audit_hash" in data
