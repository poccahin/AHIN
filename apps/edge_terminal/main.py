"""
Life++ Lite Edge Terminal — embodied local cognition-and-settlement node.

The Edge Terminal is NOT a thin client.
It is an embodied cognitive node that:
  - Accepts payments (online or offline)
  - Records local cognitive interactions
  - Maintains local Spontaneous Time Order
  - Generates ObjectificationReceipts (proof of Life+ externalisation)
  - Syncs with the control plane on reconnection
  - Supports hash-chained audit trail

Theoretical grounding:
  - Tactile Brain Hypothesis: the edge is the point of physical interaction
  - Spontaneous Time Order: local time sequencing without central authority
  - Life+ Objectification: durably externalising intelligence to media
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any, Dict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apps.edge_terminal.routers import (
    audit_router,
    interaction_router,
    payment_router,
    sync_router,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Device context manager (Tactile Brain grounding)
# ---------------------------------------------------------------------------

class DeviceContextManager:
    """
    Manages device-level context for Tactile Brain grounding.

    Captures physical/operational context that anchors cognitive
    output to real-world interaction at this edge node.
    """

    def __init__(self, terminal_id: str) -> None:
        self.terminal_id = terminal_id
        self.device_metadata: Dict[str, Any] = {}
        self._initialised = False

    def initialise(self, metadata: Dict[str, Any]) -> None:
        self.device_metadata = metadata
        self._initialised = True
        logger.info(
            "Device context initialised",
            extra={"terminal_id": self.terminal_id},
        )

    @property
    def is_initialised(self) -> bool:
        return self._initialised

    def get_grounding_context(self) -> Dict[str, Any]:
        """Return the current device grounding context."""
        return {
            "terminal_id": self.terminal_id,
            "device_metadata": self.device_metadata,
            "is_initialised": self._initialised,
        }


# ---------------------------------------------------------------------------
# Audit log (hash-chained)
# ---------------------------------------------------------------------------

class AuditLog:
    """
    Hash-chained audit trail for edge terminal operations.

    Every operation is recorded with a hash linking to the previous entry,
    implementing Spontaneous Time Order at the device level.
    """

    def __init__(self) -> None:
        self._entries: list = []
        self._last_hash: str = "genesis"

    def append(self, operation: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        import hashlib
        import json

        entry_data = {
            "sequence": len(self._entries),
            "operation": operation,
            "payload": payload,
            "predecessor_hash": self._last_hash,
        }
        entry_hash = hashlib.sha256(
            json.dumps(entry_data, sort_keys=True, default=str).encode()
        ).hexdigest()
        entry_data["entry_hash"] = entry_hash
        self._entries.append(entry_data)
        self._last_hash = entry_hash
        return entry_data

    @property
    def entries(self) -> list:
        return list(self._entries)

    @property
    def size(self) -> int:
        return len(self._entries)


# ---------------------------------------------------------------------------
# App state (shared across routers via app.state)
# ---------------------------------------------------------------------------

_TERMINAL_ID = "edge-terminal-001"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialise edge terminal resources on startup."""
    from packages.edge_runtime import EdgeRuntime
    from packages.ahin_network import AhinNode

    logger.info("Edge terminal starting up", extra={"terminal_id": _TERMINAL_ID})

    # Initialise core components
    app.state.terminal_id = _TERMINAL_ID
    app.state.device_context = DeviceContextManager(_TERMINAL_ID)
    app.state.audit_log = AuditLog()

    ahin_node = AhinNode(node_id=_TERMINAL_ID)
    app.state.ahin_node = ahin_node

    edge_runtime = EdgeRuntime(
        terminal_id=_TERMINAL_ID,
        merchant_node_id="merchant-default",
    )
    app.state.edge_runtime = edge_runtime

    app.state.device_context.initialise({
        "type": "edge_terminal",
        "version": "0.1.0",
    })

    logger.info("Edge terminal initialised", extra={"terminal_id": _TERMINAL_ID})
    yield
    logger.info("Edge terminal shutting down", extra={"terminal_id": _TERMINAL_ID})


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Life++ Lite Edge Terminal",
    description=(
        "Embodied local cognition-and-settlement node. "
        "NOT a thin client — this is a tactile brain endpoint."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(payment_router.router, prefix="/v1/payment", tags=["payment"])
app.include_router(
    interaction_router.router, prefix="/v1/interaction", tags=["interaction"]
)
app.include_router(sync_router.router, prefix="/v1/sync", tags=["sync"])
app.include_router(audit_router.router, prefix="/v1/audit", tags=["audit"])


@app.get("/health")
async def health():
    return {"status": "ok", "terminal_id": _TERMINAL_ID, "service": "edge_terminal"}
