"""
Tests for the Life++ Lite Edge Terminal.

Covers:
  - DeviceContextManager (Tactile Brain grounding)
  - AuditLog (hash-chained audit trail)
  - Edge terminal router imports
"""
import hashlib
import json

import pytest

from apps.edge_terminal.main import AuditLog, DeviceContextManager


# ---------------------------------------------------------------------------
# DeviceContextManager tests
# ---------------------------------------------------------------------------

class TestDeviceContextManager:

    def test_initialisation(self):
        ctx = DeviceContextManager("terminal-001")
        assert ctx.terminal_id == "terminal-001"
        assert not ctx.is_initialised

    def test_initialise_with_metadata(self):
        ctx = DeviceContextManager("terminal-002")
        ctx.initialise({"type": "edge", "version": "1.0"})
        assert ctx.is_initialised
        assert ctx.device_metadata["type"] == "edge"

    def test_grounding_context(self):
        ctx = DeviceContextManager("terminal-003")
        ctx.initialise({"sensor": "touch"})
        context = ctx.get_grounding_context()
        assert context["terminal_id"] == "terminal-003"
        assert context["is_initialised"] is True
        assert context["device_metadata"]["sensor"] == "touch"

    def test_uninitialised_grounding_context(self):
        ctx = DeviceContextManager("terminal-004")
        context = ctx.get_grounding_context()
        assert context["is_initialised"] is False


# ---------------------------------------------------------------------------
# AuditLog tests
# ---------------------------------------------------------------------------

class TestAuditLog:

    def test_append_creates_entry(self):
        log = AuditLog()
        entry = log.append("test_op", {"key": "value"})
        assert entry["sequence"] == 0
        assert entry["operation"] == "test_op"
        assert entry["predecessor_hash"] == "genesis"
        assert "entry_hash" in entry
        assert log.size == 1

    def test_hash_chaining(self):
        log = AuditLog()
        entry1 = log.append("op1", {"a": 1})
        entry2 = log.append("op2", {"b": 2})
        assert entry2["predecessor_hash"] == entry1["entry_hash"]
        assert entry1["predecessor_hash"] == "genesis"

    def test_hash_is_deterministic(self):
        log = AuditLog()
        entry = log.append("op", {"key": "value"})
        # Recompute hash
        verify_data = {
            "sequence": 0,
            "operation": "op",
            "payload": {"key": "value"},
            "predecessor_hash": "genesis",
        }
        expected_hash = hashlib.sha256(
            json.dumps(verify_data, sort_keys=True, default=str).encode()
        ).hexdigest()
        assert entry["entry_hash"] == expected_hash

    def test_chain_integrity(self):
        log = AuditLog()
        for i in range(10):
            log.append(f"op_{i}", {"index": i})
        entries = log.entries
        for i in range(1, len(entries)):
            assert entries[i]["predecessor_hash"] == entries[i - 1]["entry_hash"]

    def test_entries_are_copies(self):
        log = AuditLog()
        log.append("op", {"data": "test"})
        entries = log.entries
        entries.clear()
        assert log.size == 1  # Original not affected

    def test_multiple_operations(self):
        log = AuditLog()
        log.append("payment_accepted", {"amount": 100})
        log.append("interaction_recorded", {"type": "proactive"})
        log.append("sync_triggered", {"total": 5})
        assert log.size == 3
        ops = [e["operation"] for e in log.entries]
        assert ops == ["payment_accepted", "interaction_recorded", "sync_triggered"]
