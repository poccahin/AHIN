"""
Audit router — provides audit trail access for the edge terminal.

Supports:
  - Querying the hash-chained audit log
  - Verifying audit chain integrity
  - Exporting audit data for reconciliation
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter()


class AuditLogResponse(BaseModel):
    """Response containing audit log entries."""

    terminal_id: str
    total_entries: int
    entries: List[Dict[str, Any]]


class AuditVerificationResponse(BaseModel):
    """Response from audit chain verification."""

    terminal_id: str
    total_entries: int
    is_valid: bool
    first_invalid_sequence: Optional[int] = None


@router.get("/log", response_model=AuditLogResponse)
async def get_audit_log(
    request: Request,
    limit: int = 100,
    offset: int = 0,
):
    """
    Return the hash-chained audit log for this edge terminal.

    Each entry is linked to its predecessor via hash chaining,
    implementing Spontaneous Time Order at the device level.
    """
    audit_log = request.app.state.audit_log
    entries = audit_log.entries[offset : offset + limit]
    return AuditLogResponse(
        terminal_id=request.app.state.terminal_id,
        total_entries=audit_log.size,
        entries=entries,
    )


@router.get("/verify", response_model=AuditVerificationResponse)
async def verify_audit_chain(request: Request):
    """
    Verify the integrity of the hash-chained audit trail.

    Recomputes each entry's hash and verifies predecessor linkage.
    """
    audit_log = request.app.state.audit_log
    entries = audit_log.entries

    is_valid = True
    first_invalid: Optional[int] = None

    for i, entry in enumerate(entries):
        expected_predecessor = "genesis" if i == 0 else entries[i - 1]["entry_hash"]
        if entry["predecessor_hash"] != expected_predecessor:
            is_valid = False
            first_invalid = i
            break

        # Recompute hash
        verify_data = {
            "sequence": entry["sequence"],
            "operation": entry["operation"],
            "payload": entry["payload"],
            "predecessor_hash": entry["predecessor_hash"],
        }
        computed_hash = hashlib.sha256(
            json.dumps(verify_data, sort_keys=True, default=str).encode()
        ).hexdigest()
        if computed_hash != entry["entry_hash"]:
            is_valid = False
            first_invalid = i
            break

    return AuditVerificationResponse(
        terminal_id=request.app.state.terminal_id,
        total_entries=audit_log.size,
        is_valid=is_valid,
        first_invalid_sequence=first_invalid,
    )


@router.get("/summary")
async def get_audit_summary(request: Request):
    """Return a summary of audit log operations."""
    audit_log = request.app.state.audit_log
    operations: Dict[str, int] = {}
    for entry in audit_log.entries:
        op = entry["operation"]
        operations[op] = operations.get(op, 0) + 1

    return {
        "terminal_id": request.app.state.terminal_id,
        "total_entries": audit_log.size,
        "operations": operations,
    }
