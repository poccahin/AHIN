"""
Life++ Lite Edge Terminal — FastAPI application.

This is NOT a simple payment terminal.
It is an embodied cognition, payment, and settlement node where:
  - User intention is captured in real context (Tactile Brain Hypothesis)
  - Local interaction generates grounded cognitive events (Life+ Objectification)
  - Agent collaboration becomes operationally anchored (AHIN)
  - Payment and settlement become part of trust-confirmed action (POC)
  - Edge interaction contributes to AHIN's Spontaneous Time Order

Device mission:
  1. Local contextual interaction
  2. Durable transaction objectification
  3. Trust-anchored interaction events
  4. LIFE++ or hybrid payment acceptance
  5. Local buffering and delayed synchronization
  6. Day-end reconciliation and settlement
  7. Auditability of both payment and collaborative agent participation

Theoretical alignment:
  - Tactile Brain Hypothesis → DeviceContextManager provides grounding
  - Life+ Objectification → ObjectificationReceipts + CanxianArtifact metadata
  - AHIN → AhinNode + AssociationEvents at edge
  - POC → CognitiveInteractionHandler produces POC evidence
  - Spontaneous Time Order → LocalTimeSequencer chains all events
  - Aligned Virtue and Well-being → day-close settlement support
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import AsyncIterator, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apps.edge_terminal.audit_log import AuditLog
from apps.edge_terminal.cognitive_interaction_handler import CognitiveInteractionHandler
from apps.edge_terminal.context import DeviceContextManager
from apps.edge_terminal.routers import (
    audit_router,
    interaction_router,
    payment_router,
    sync_router,
)
from packages.ahin_network.ahin_node import AhinNode
from packages.ahin_network.local_time_sequencer import LocalTimeSequencer
from packages.edge_runtime.edge_runtime import EdgeRuntime
from packages.shared.domain import NodeType, new_id

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Terminal state container
# ---------------------------------------------------------------------------

@dataclass
class TerminalState:
    """
    Holds all runtime state for the edge terminal.

    This is the single source of truth for the terminal's operational state.
    All routers access this via get_terminal_state().
    """
    runtime: EdgeRuntime
    context_manager: DeviceContextManager
    interaction_handler: CognitiveInteractionHandler
    audit_log: AuditLog
    sequencer: LocalTimeSequencer
    ahin_node: AhinNode


# Module-level state — initialised on startup
_terminal_state: Optional[TerminalState] = None


def get_terminal_state() -> Optional[TerminalState]:
    """Return the current terminal state, or None if not initialised."""
    return _terminal_state


def init_terminal_state(
    terminal_id: Optional[str] = None,
    merchant_node_id: Optional[str] = None,
    location_label: Optional[str] = None,
    geo_lat: Optional[float] = None,
    geo_lon: Optional[float] = None,
    operator_node_id: Optional[str] = None,
    sync_fn: Optional[object] = None,
    transfer_engine: Optional[object] = None,
    admission_stake: Optional[float] = None,
) -> TerminalState:
    """
    Initialise the terminal state with the given configuration.

    Called during application startup.
    """
    global _terminal_state

    tid = terminal_id or os.getenv("EDGE_TERMINAL_ID") or new_id()
    mid = merchant_node_id or os.getenv("EDGE_MERCHANT_NODE_ID")
    loc = location_label or os.getenv("EDGE_TERMINAL_LOCATION", "unknown")

    sequencer = LocalTimeSequencer(tid)

    ahin_node = AhinNode(node_id=tid, node_type=NodeType.EDGE_TERMINAL)
    if admission_stake and admission_stake > 0:
        ahin_node.set_admitted(stake_lifepp=admission_stake)

    context_manager = DeviceContextManager(
        terminal_id=tid,
        location_label=loc,
        geo_lat=geo_lat,
        geo_lon=geo_lon,
        operator_node_id=operator_node_id,
    )

    runtime = EdgeRuntime(
        terminal_id=tid,
        merchant_node_id=mid,
        transfer_engine=transfer_engine,
        sync_fn=sync_fn,
    )

    # Synchronise AHIN admission state with EdgeRuntime's internal node
    if admission_stake and admission_stake > 0:
        runtime._ahin_node.set_admitted(stake_lifepp=admission_stake)

    interaction_handler = CognitiveInteractionHandler(
        terminal_id=tid,
        context_manager=context_manager,
        sequencer=sequencer,
        ahin_node=ahin_node,
    )

    audit_log = AuditLog(terminal_id=tid)

    _terminal_state = TerminalState(
        runtime=runtime,
        context_manager=context_manager,
        interaction_handler=interaction_handler,
        audit_log=audit_log,
        sequencer=sequencer,
        ahin_node=ahin_node,
    )

    logger.info(
        "Edge terminal state initialised",
        extra={
            "terminal_id": tid,
            "merchant_node_id": mid,
            "location": loc,
            "is_admitted": ahin_node.is_admitted,
        },
    )
    return _terminal_state


def reset_terminal_state() -> None:
    """Reset terminal state (for testing)."""
    global _terminal_state
    _terminal_state = None


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

def create_app(
    terminal_id: Optional[str] = None,
    merchant_node_id: Optional[str] = None,
    location_label: Optional[str] = None,
    admission_stake: Optional[float] = None,
) -> FastAPI:
    """
    Create and configure the Life++ Lite Edge Terminal FastAPI app.

    Args:
        terminal_id: Unique ID for this terminal (auto-generated if omitted)
        merchant_node_id: The merchant node this terminal belongs to
        location_label: Human-readable location for grounding context
        admission_stake: LIFE++ stake for AHIN admission (0 = not admitted)
    """
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        """Initialise terminal state on startup, clean up on shutdown."""
        init_terminal_state(
            terminal_id=terminal_id,
            merchant_node_id=merchant_node_id,
            location_label=location_label,
            admission_stake=admission_stake,
        )
        yield
        reset_terminal_state()

    terminal_app = FastAPI(
        title="Life++ Lite Edge Terminal",
        description=(
            "Embodied cognition, payment, and settlement node. "
            "Aligned with Prof. Cai Hengjin's theoretical framework. "
            "Not merely a payment terminal — an operational node where "
            "user intention meets grounded cognitive action."
        ),
        version="0.1.0",
        lifespan=lifespan,
    )

    terminal_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include routers
    terminal_app.include_router(
        payment_router.router,
        prefix="/v1/payment",
        tags=["Payment — ObjectificationReceipts"],
    )
    terminal_app.include_router(
        interaction_router.router,
        prefix="/v1/interaction",
        tags=["Cognitive Interaction — Canxian Events"],
    )
    terminal_app.include_router(
        sync_router.router,
        prefix="/v1/sync",
        tags=["Sync — Offline Queue & Day-Close"],
    )
    terminal_app.include_router(
        audit_router.router,
        prefix="/v1/audit",
        tags=["Audit — Status & Trail"],
    )

    @terminal_app.get("/health")
    async def health() -> dict:
        state = get_terminal_state()
        return {
            "status": "ok",
            "system": "Life++ Lite Edge Terminal",
            "terminal_id": state.runtime.terminal_id if state else "not_initialised",
            "is_online": state.runtime.device_status()["is_online"] if state else False,
        }

    return terminal_app


# Default app instance for uvicorn
app = create_app()
