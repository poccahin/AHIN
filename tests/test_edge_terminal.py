"""
Tests for the Life++ Lite Edge Terminal.

Covers:
  - DeviceContextManager (Tactile Brain grounding)
  - CognitiveInteractionHandler (local objectification)
  - AuditLog (hash-chained audit trail)
  - EdgeRuntime integration (payment acceptance)
  - FastAPI endpoint tests (payment, interaction, sync, audit)
  - Theoretical alignment verification
"""
from __future__ import annotations

import pytest
from typing import Any, Dict, List
from httpx import AsyncClient, ASGITransport


# ---------------------------------------------------------------------------
# DeviceContextManager
# ---------------------------------------------------------------------------

class TestDeviceContextManager:
    def test_capture_returns_device_context(self):
        from apps.edge_terminal.context import DeviceContextManager

        mgr = DeviceContextManager(
            terminal_id="t-001",
            location_label="Beijing Store #42",
            geo_lat=39.9042,
            geo_lon=116.4074,
            operator_node_id="op-001",
        )
        ctx = mgr.capture()
        assert ctx.terminal_id == "t-001"
        assert ctx.location_label == "Beijing Store #42"
        assert ctx.geo_lat == 39.9042
        assert ctx.captured_at != ""

    def test_has_grounding_when_location_set(self):
        from apps.edge_terminal.context import DeviceContextManager

        mgr = DeviceContextManager(terminal_id="t-002", location_label="Shop A")
        assert mgr.has_grounding is True

    def test_no_grounding_when_location_unknown(self):
        from apps.edge_terminal.context import DeviceContextManager

        mgr = DeviceContextManager(terminal_id="t-003", location_label="unknown")
        assert mgr.has_grounding is False

    def test_to_grounding_dict_non_empty(self):
        from apps.edge_terminal.context import DeviceContextManager

        mgr = DeviceContextManager(
            terminal_id="t-004",
            location_label="Café",
            operator_node_id="barista-01",
        )
        gd = mgr.to_grounding_dict()
        assert "terminal_id" in gd
        assert "location_label" in gd
        assert gd["location_label"] == "Café"

    def test_update_location(self):
        from apps.edge_terminal.context import DeviceContextManager

        mgr = DeviceContextManager(terminal_id="t-005", location_label="Old Place")
        mgr.update_location("New Place", geo_lat=40.0, geo_lon=117.0)
        ctx = mgr.capture()
        assert ctx.location_label == "New Place"
        assert ctx.geo_lat == 40.0

    def test_update_operator(self):
        from apps.edge_terminal.context import DeviceContextManager

        mgr = DeviceContextManager(terminal_id="t-006")
        mgr.update_operator("new-operator")
        ctx = mgr.capture()
        assert ctx.operator_node_id == "new-operator"


# ---------------------------------------------------------------------------
# CognitiveInteractionHandler
# ---------------------------------------------------------------------------

class TestCognitiveInteractionHandler:
    def _make_handler(self, location_label: str = "Test Location"):
        from apps.edge_terminal.cognitive_interaction_handler import (
            CognitiveInteractionHandler,
        )
        from apps.edge_terminal.context import DeviceContextManager
        from packages.ahin_network.ahin_node import AhinNode
        from packages.ahin_network.local_time_sequencer import LocalTimeSequencer
        from packages.shared.domain import NodeType

        ctx = DeviceContextManager(
            terminal_id="t-cih", location_label=location_label
        )
        seq = LocalTimeSequencer("t-cih")
        node = AhinNode(node_id="t-cih", node_type=NodeType.EDGE_TERMINAL)
        return CognitiveInteractionHandler(
            terminal_id="t-cih",
            context_manager=ctx,
            sequencer=seq,
            ahin_node=node,
        )

    def test_handle_grounded_interaction(self):
        handler = self._make_handler(location_label="Grounded Place")
        record = handler.handle_cognitive_interaction(
            intent_description="Order coffee",
            input_payload={"item": "latte", "size": "large"},
        )
        assert record["artifact_status"] == "grounded"
        assert record["grounding_context"]["location_label"] == "Grounded Place"
        assert len(record["content_hash"]) == 64  # SHA-256

    def test_handle_ungrounded_interaction(self):
        handler = self._make_handler(location_label="unknown")
        record = handler.handle_cognitive_interaction(
            intent_description="Abstract query",
            input_payload={"query": "meaning of life"},
        )
        assert record["artifact_status"] == "raw_output"

    def test_interaction_log_grows(self):
        handler = self._make_handler()
        assert handler.interaction_count == 0
        handler.handle_cognitive_interaction(
            intent_description="First", input_payload={}
        )
        handler.handle_cognitive_interaction(
            intent_description="Second", input_payload={}
        )
        assert handler.interaction_count == 2
        assert len(handler.interaction_log) == 2

    def test_interaction_includes_spontaneous_time_order(self):
        handler = self._make_handler()
        record = handler.handle_cognitive_interaction(
            intent_description="Time test", input_payload={}
        )
        sto = record["spontaneous_time_order"]
        assert "local_sequence" in sto
        assert "node_id" in sto
        assert sto["node_id"] == "t-cih"

    def test_association_event_requires_admission(self):
        from packages.shared.domain import AssociationEventType

        handler = self._make_handler()
        # Node is not admitted — should return None
        event = handler.record_association_event(
            responder_node_id="peer-1",
            event_type=AssociationEventType.PROACTIVE,
        )
        assert event is None

    def test_association_event_after_admission(self):
        from packages.shared.domain import AssociationEventType

        handler = self._make_handler()
        handler._ahin_node.set_admitted(stake_lifepp=500.0)
        event = handler.record_association_event(
            responder_node_id="peer-1",
            event_type=AssociationEventType.PROACTIVE,
            payload={"intent": "collaborate on order"},
        )
        assert event is not None
        assert event.initiator_node_id == "t-cih"
        assert event.interaction_hash  # Non-empty hash


# ---------------------------------------------------------------------------
# AuditLog
# ---------------------------------------------------------------------------

class TestAuditLog:
    def test_append_and_retrieve(self):
        from apps.edge_terminal.audit_log import AuditLog

        log = AuditLog(terminal_id="t-audit")
        log.append("payment", {"amount": 1.0})
        entries = log.get_entries()
        assert len(entries) == 1
        assert entries[0]["entry_type"] == "payment"

    def test_hash_chain_integrity(self):
        from apps.edge_terminal.audit_log import AuditLog

        log = AuditLog(terminal_id="t-chain")
        log.append("payment", {"amount": 1.0})
        log.append("cognitive_interaction", {"intent": "test"})
        log.append("sync", {"count": 5})
        assert log.verify_chain() is True

    def test_entries_are_chained(self):
        from apps.edge_terminal.audit_log import AuditLog

        log = AuditLog(terminal_id="t-chained")
        e1 = log.append("a", {})
        e2 = log.append("b", {})
        assert e2.predecessor_hash == e1.entry_hash

    def test_filter_by_type(self):
        from apps.edge_terminal.audit_log import AuditLog

        log = AuditLog(terminal_id="t-filter")
        log.append("payment", {"amount": 1.0})
        log.append("sync", {"count": 2})
        log.append("payment", {"amount": 3.0})

        payments = log.get_entries(entry_type="payment")
        assert len(payments) == 2
        syncs = log.get_entries(entry_type="sync")
        assert len(syncs) == 1

    def test_capacity_limit(self):
        from apps.edge_terminal.audit_log import AuditLog

        log = AuditLog(terminal_id="t-cap", max_entries=5)
        for i in range(10):
            log.append("test", {"i": i})
        assert log.entry_count == 5

    def test_genesis_entry_has_no_predecessor(self):
        from apps.edge_terminal.audit_log import AuditLog

        log = AuditLog(terminal_id="t-genesis")
        e = log.append("first", {})
        assert e.predecessor_hash is None


# ---------------------------------------------------------------------------
# EdgeRuntime integration
# ---------------------------------------------------------------------------

class TestEdgeRuntimeIntegration:
    @pytest.mark.asyncio
    async def test_accept_payment_offline(self):
        from packages.edge_runtime.edge_runtime import EdgeRuntime

        runtime = EdgeRuntime(
            terminal_id="t-rt-001",
            merchant_node_id="merchant-1",
        )
        receipt = await runtime.accept_payment(
            amount_lifepp=0.5,
            customer_node_id="cust-1",
            payload={"item": "espresso"},
        )
        assert receipt["is_offline"] is True
        assert "receipt_hash" in receipt
        assert len(receipt["receipt_hash"]) == 64

    @pytest.mark.asyncio
    async def test_device_status(self):
        from packages.edge_runtime.edge_runtime import EdgeRuntime

        runtime = EdgeRuntime(
            terminal_id="t-rt-002",
            merchant_node_id="merchant-2",
        )
        status = runtime.device_status()
        assert status["terminal_id"] == "t-rt-002"
        assert status["merchant_node_id"] == "merchant-2"
        assert status["is_online"] is False  # No transfer engine


# ---------------------------------------------------------------------------
# FastAPI endpoint tests
# ---------------------------------------------------------------------------

class TestEdgeTerminalAPI:
    """
    Integration tests for the edge terminal FastAPI endpoints.

    Uses httpx AsyncClient with ASGI transport to test without a running server.
    """

    @pytest.fixture
    def test_app(self):
        """Create a test app with known configuration."""
        from apps.edge_terminal.main import (
            create_app,
            init_terminal_state,
            reset_terminal_state,
        )

        reset_terminal_state()
        app = create_app(
            terminal_id="test-terminal",
            merchant_node_id="test-merchant",
            location_label="Test Location",
            admission_stake=500.0,
        )
        # Explicitly initialise state since ASGITransport doesn't trigger lifespan
        init_terminal_state(
            terminal_id="test-terminal",
            merchant_node_id="test-merchant",
            location_label="Test Location",
            admission_stake=500.0,
        )
        yield app
        reset_terminal_state()

    @pytest.mark.asyncio
    async def test_health(self, test_app):
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/health")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "ok"
            assert data["terminal_id"] == "test-terminal"

    @pytest.mark.asyncio
    async def test_accept_payment(self, test_app):
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/v1/payment/accept",
                json={
                    "amount_lifepp": 1.5,
                    "customer_node_id": "cust-test",
                    "payload": {"item": "matcha"},
                },
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["terminal_id"] == "test-terminal"
            assert data["merchant_node_id"] == "test-merchant"
            assert data["receipt_hash"] != ""
            assert data["is_offline"] is True  # No transfer engine

    @pytest.mark.asyncio
    async def test_cognitive_interaction(self, test_app):
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/v1/interaction/cognitive",
                json={
                    "intent_description": "Order a latte",
                    "input_payload": {"item": "latte", "size": "medium"},
                },
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["is_grounded"] is True  # "Test Location" is grounded
            assert data["artifact_status"] == "grounded"
            assert data["terminal_id"] == "test-terminal"
            assert len(data["content_hash"]) == 64

    @pytest.mark.asyncio
    async def test_association_event_proactive(self, test_app):
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/v1/interaction/association",
                json={
                    "responder_node_id": "peer-agent-1",
                    "event_type": "proactive_association",
                    "payload": {"intent": "collaborate on order"},
                },
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["initiator_node_id"] == "test-terminal"
            assert data["association_type"] == "proactive_association"
            assert data["interaction_hash"] != ""

    @pytest.mark.asyncio
    async def test_association_event_acceptance(self, test_app):
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/v1/interaction/association",
                json={
                    "responder_node_id": "peer-agent-2",
                    "event_type": "acceptance_of_association",
                    "payload": {"confirmation": True},
                },
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["association_type"] == "acceptance_of_association"

    @pytest.mark.asyncio
    async def test_sync_status(self, test_app):
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/v1/sync/status")
            assert resp.status_code == 200
            data = resp.json()
            assert data["terminal_id"] == "test-terminal"
            assert "queue_size" in data

    @pytest.mark.asyncio
    async def test_sync_trigger(self, test_app):
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/v1/sync/trigger")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "completed"
            assert data["synced_count"] == 0  # No sync_fn configured

    @pytest.mark.asyncio
    async def test_day_close(self, test_app):
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/v1/sync/day-close")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "completed"

    @pytest.mark.asyncio
    async def test_device_status(self, test_app):
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/v1/audit/status")
            assert resp.status_code == 200
            data = resp.json()
            assert data["terminal_id"] == "test-terminal"
            assert data["is_admitted_to_ahin"] is True
            assert data["has_grounding"] is True
            assert data["audit_chain_valid"] is True

    @pytest.mark.asyncio
    async def test_audit_trail(self, test_app):
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # First make a payment to create an audit entry
            await client.post(
                "/v1/payment/accept",
                json={"amount_lifepp": 0.1, "payload": {"item": "water"}},
            )
            # Then check audit trail
            resp = await client.get("/v1/audit/trail")
            assert resp.status_code == 200
            data = resp.json()
            assert data["total_count"] >= 1
            assert data["chain_valid"] is True
            assert len(data["entries"]) >= 1

    @pytest.mark.asyncio
    async def test_audit_trail_filter(self, test_app):
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # Create different event types
            await client.post(
                "/v1/payment/accept",
                json={"amount_lifepp": 0.1, "payload": {}},
            )
            await client.post(
                "/v1/interaction/cognitive",
                json={"intent_description": "test", "input_payload": {}},
            )
            # Filter by payment
            resp = await client.get("/v1/audit/trail?entry_type=payment")
            data = resp.json()
            for entry in data["entries"]:
                assert entry["entry_type"] == "payment"

    @pytest.mark.asyncio
    async def test_interaction_log(self, test_app):
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # Create a cognitive interaction
            await client.post(
                "/v1/interaction/cognitive",
                json={
                    "intent_description": "Test POC evidence",
                    "input_payload": {"key": "value"},
                },
            )
            # Check interaction log
            resp = await client.get("/v1/audit/interactions")
            assert resp.status_code == 200
            data = resp.json()
            assert data["total_count"] >= 1
            assert data["interactions"][0]["grounding_context"]["location_label"] == "Test Location"

    @pytest.mark.asyncio
    async def test_verify_chain(self, test_app):
        transport = ASGITransport(app=test_app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # Create some events
            await client.post(
                "/v1/payment/accept",
                json={"amount_lifepp": 1.0, "payload": {}},
            )
            await client.post(
                "/v1/interaction/cognitive",
                json={"intent_description": "chain test", "input_payload": {}},
            )
            # Verify chain
            resp = await client.get("/v1/audit/verify-chain")
            assert resp.status_code == 200
            data = resp.json()
            assert data["chain_valid"] is True
            assert data["entry_count"] >= 2


# ---------------------------------------------------------------------------
# Theoretical alignment verification
# ---------------------------------------------------------------------------

class TestTheoreticalAlignment:
    """
    Verify that the edge terminal implementation satisfies the
    theoretical hard constraints from Prof. Cai Hengjin's framework.
    """

    def test_tactile_brain_grounding_in_artifacts(self):
        """
        Tactile Brain Hypothesis: artifacts must carry grounding_context.
        Ungrounded artifacts should be classified as RAW_OUTPUT.
        """
        from apps.edge_terminal.cognitive_interaction_handler import (
            CognitiveInteractionHandler,
        )
        from apps.edge_terminal.context import DeviceContextManager
        from packages.ahin_network.ahin_node import AhinNode
        from packages.ahin_network.local_time_sequencer import LocalTimeSequencer
        from packages.shared.domain import NodeType

        # Grounded terminal
        grounded_ctx = DeviceContextManager(
            terminal_id="t-tb-1", location_label="Physical Store"
        )
        seq = LocalTimeSequencer("t-tb-1")
        node = AhinNode(node_id="t-tb-1", node_type=NodeType.EDGE_TERMINAL)
        handler = CognitiveInteractionHandler("t-tb-1", grounded_ctx, seq, node)
        record = handler.handle_cognitive_interaction("test", {})
        assert record["artifact_status"] == "grounded"
        assert record["grounding_context"]["location_label"] == "Physical Store"

        # Ungrounded terminal
        ungrounded_ctx = DeviceContextManager(
            terminal_id="t-tb-2", location_label="unknown"
        )
        seq2 = LocalTimeSequencer("t-tb-2")
        node2 = AhinNode(node_id="t-tb-2", node_type=NodeType.EDGE_TERMINAL)
        handler2 = CognitiveInteractionHandler("t-tb-2", ungrounded_ctx, seq2, node2)
        record2 = handler2.handle_cognitive_interaction("test", {})
        assert record2["artifact_status"] == "raw_output"

    def test_spontaneous_time_order_not_centralized(self):
        """
        Spontaneous Time Order: time must be locally sequenced,
        not depending on centralized timestamp authority.
        """
        from packages.ahin_network.local_time_sequencer import LocalTimeSequencer

        seq = LocalTimeSequencer("edge-node-1")
        t1 = seq.next(interaction_type="payment")
        t2 = seq.next(interaction_type="cognitive")
        # Local sequence is monotonically increasing
        assert t2.local_sequence > t1.local_sequence
        # Hash chain provides tamper evidence
        assert t1.interaction_hash != t2.interaction_hash
        # Node ID is local
        assert t1.node_id == "edge-node-1"

    def test_ahin_directional_interaction_at_edge(self):
        """
        AHIN: interactions must be directional and locally recorded.
        Trust is NOT centrally assigned.
        """
        from apps.edge_terminal.cognitive_interaction_handler import (
            CognitiveInteractionHandler,
        )
        from apps.edge_terminal.context import DeviceContextManager
        from packages.ahin_network.ahin_node import AhinNode
        from packages.ahin_network.local_time_sequencer import LocalTimeSequencer
        from packages.shared.domain import AssociationEventType, NodeType

        ctx = DeviceContextManager(terminal_id="t-ahin", location_label="Shop")
        seq = LocalTimeSequencer("t-ahin")
        node = AhinNode(node_id="t-ahin", node_type=NodeType.EDGE_TERMINAL)
        node.set_admitted(stake_lifepp=500.0)
        handler = CognitiveInteractionHandler("t-ahin", ctx, seq, node)

        # Proactive association — directional (terminal → peer)
        event = handler.record_association_event(
            responder_node_id="remote-agent",
            event_type=AssociationEventType.PROACTIVE,
        )
        assert event is not None
        assert event.initiator_node_id == "t-ahin"
        assert event.association_type == "proactive_association"

    def test_poc_evidence_from_edge_interaction(self):
        """
        POC: edge interactions must produce evidence for cognitive
        contribution validation — not brute-force or capital.
        """
        from apps.edge_terminal.cognitive_interaction_handler import (
            CognitiveInteractionHandler,
        )
        from apps.edge_terminal.context import DeviceContextManager
        from packages.ahin_network.ahin_node import AhinNode
        from packages.ahin_network.local_time_sequencer import LocalTimeSequencer
        from packages.shared.domain import NodeType

        ctx = DeviceContextManager(terminal_id="t-poc", location_label="Lab")
        seq = LocalTimeSequencer("t-poc")
        node = AhinNode(node_id="t-poc", node_type=NodeType.EDGE_TERMINAL)
        handler = CognitiveInteractionHandler("t-poc", ctx, seq, node)
        record = handler.handle_cognitive_interaction(
            intent_description="Analyse sensor data",
            input_payload={"sensor": "temperature", "value": 22.5},
            agent_node_id="analysis-agent",
        )
        # Record includes all required POC evidence fields
        assert "content_hash" in record
        assert "grounding_context" in record
        assert "spontaneous_time_order" in record
        assert record["agent_node_id"] == "analysis-agent"
        assert record["artifact_status"] == "grounded"

    def test_audit_chain_implements_tamper_evidence(self):
        """
        Auditability: the audit log must be hash-chained for tamper evidence.
        This supports Spontaneous Time Order verification.
        """
        from apps.edge_terminal.audit_log import AuditLog

        log = AuditLog(terminal_id="t-audit-theory")
        log.append("payment", {"amount": 1.0})
        log.append("cognitive_interaction", {"intent": "test"})
        log.append("association_event", {"peer": "node-x"})
        assert log.verify_chain() is True
        assert log.entry_count == 3

    def test_offline_payment_preserves_local_time_order(self):
        """
        Offline transactions must preserve their local Spontaneous Time Order
        for later reconciliation.
        """
        from packages.edge_runtime.local_transaction_store import (
            LocalTransactionStore,
        )

        store = LocalTransactionStore("t-offline", max_size=100)
        r1 = store.enqueue(
            amount_lifepp=1.0,
            amount_fiat=None,
            fiat_currency=None,
            merchant_node_id="m",
            payload={"item": "first"},
        )
        r2 = store.enqueue(
            amount_lifepp=2.0,
            amount_fiat=None,
            fiat_currency=None,
            merchant_node_id="m",
            payload={"item": "second"},
        )
        # Each receipt has a Spontaneous Time Order
        sto1 = r1["spontaneous_time_order"]
        sto2 = r2["spontaneous_time_order"]
        assert sto2["local_sequence"] > sto1["local_sequence"]
        assert sto1["interaction_hash"] != sto2["interaction_hash"]

    def test_no_global_consensus_required(self):
        """
        AHIN: coordination must NOT rely solely on global consensus.
        Local time sequencing and hash chaining provide ordering.
        """
        from packages.ahin_network.local_time_sequencer import LocalTimeSequencer

        # Two independent terminals produce independent sequences
        seq_a = LocalTimeSequencer("terminal-a")
        seq_b = LocalTimeSequencer("terminal-b")
        ta = seq_a.next(interaction_type="payment")
        tb = seq_b.next(interaction_type="payment")
        # Each has its own node_id — no shared clock needed
        assert ta.node_id == "terminal-a"
        assert tb.node_id == "terminal-b"
        # Sequences are independent
        assert ta.local_sequence == 1
        assert tb.local_sequence == 1

    def test_receipt_proof_tamper_detection(self):
        """
        ObjectificationReceipts must be tamper-evident.
        """
        from packages.edge_runtime.receipt_proof_service import ReceiptProofService

        receipt = {
            "receipt_id": "r-proof",
            "amount_lifepp": 5.0,
            "merchant_node_id": "m-proof",
            "payload": {"item": "verification"},
        }
        receipt["receipt_hash"] = ReceiptProofService.create_proof(receipt)
        assert ReceiptProofService.verify_proof(receipt)
        # Tamper
        receipt["amount_lifepp"] = 999.0
        assert not ReceiptProofService.verify_proof(receipt)
