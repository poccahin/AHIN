"""
Life++ Lite Edge Terminal — FastAPI application.

This is the HTTP interface for the Life++ Lite Edge Terminal,
an embodied cognition, payment, and settlement node.

Endpoints:
  POST /interaction     — Capture a local contextual interaction
  POST /payment         — Accept a LIFE++ or hybrid payment
  POST /trust/anchor    — Create a trust-anchored interaction event
  POST /agent/participate — Record agent collaboration participation
  POST /sync            — Sync the offline transaction queue
  POST /day-close       — Execute day-end reconciliation
  GET  /status          — Terminal device status

Per Tactile Brain Hypothesis:
  Every request to this API is an operational interaction
  grounded in the terminal's physical context.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import Field

from packages.edge_runtime.edge_runtime import EdgeRuntime
from packages.shared.domain import LifePPBaseModel

# ---------------------------------------------------------------------------
# Request/Response schemas
# ---------------------------------------------------------------------------


class InteractionRequest(LifePPBaseModel):
    """Request to capture a local contextual interaction."""
    interaction_type: str = Field(
        ..., description="Type: purchase, query, agent_request, service_activation"
    )
    user_intent: Dict[str, Any] = Field(
        ..., description="The user's expressed intention"
    )
    device_context: Optional[Dict[str, Any]] = Field(
        None, description="Physical/operational context from the device"
    )
    agent_node_ids: Optional[List[str]] = Field(
        None, description="IDs of agents collaborating on this interaction"
    )


class PaymentRequest(LifePPBaseModel):
    """Request to accept a payment at the edge terminal."""
    amount_lifepp: Optional[float] = None
    amount_fiat: Optional[float] = None
    fiat_currency: Optional[str] = None
    customer_node_id: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    artifact_id: Optional[str] = None
    device_context: Optional[Dict[str, Any]] = None


class TrustAnchorRequest(LifePPBaseModel):
    """Request to create a trust-anchored interaction event."""
    responder_node_id: str
    interaction_context: Dict[str, Any] = Field(default_factory=dict)
    trust_delta: float = 0.05
    task_id: Optional[str] = None


class AgentParticipationRequest(LifePPBaseModel):
    """Request to record agent collaboration at the edge."""
    agent_node_id: str
    interaction_id: str
    role: str = Field(
        ..., description="Agent role: executor, validator, advisor, translator"
    )
    contribution_summary: str
    grounding_evidence: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------

def create_edge_terminal_app(
    terminal_id: Optional[str] = None,
    merchant_node_id: Optional[str] = None,
) -> FastAPI:
    """
    Create a FastAPI application for the Life++ Lite Edge Terminal.

    Args:
        terminal_id: Override terminal ID (default: env or generated).
        merchant_node_id: The merchant this terminal serves.

    Returns:
        A configured FastAPI application.
    """
    app = FastAPI(
        title="Life++ Lite Edge Terminal",
        description=(
            "Embodied cognition, payment, and settlement node. "
            "Not merely a payment terminal — this is a cognitive objectification "
            "interface aligned with Prof. Cai Hengjin's theoretical framework."
        ),
        version="0.1.0",
    )

    runtime = EdgeRuntime(
        terminal_id=terminal_id or os.getenv("EDGE_TERMINAL_ID"),
        merchant_node_id=merchant_node_id or os.getenv("EDGE_MERCHANT_NODE_ID"),
    )

    # Store runtime on app state for access in route handlers
    app.state.runtime = runtime

    # ------------------------------------------------------------------
    # Routes
    # ------------------------------------------------------------------

    @app.post("/interaction")
    async def capture_interaction(req: InteractionRequest) -> Dict[str, Any]:
        """
        Capture a local contextual interaction.

        This is a cognitive objectification event:
        user intention → grounding_context → durable interaction record.
        """
        return runtime.capture_interaction(
            interaction_type=req.interaction_type,
            user_intent=req.user_intent,
            device_context=req.device_context,
            agent_node_ids=req.agent_node_ids,
        )

    @app.post("/payment")
    async def accept_payment(req: PaymentRequest) -> Dict[str, Any]:
        """
        Accept a LIFE++ or hybrid payment.

        Supports online and offline modes.  In offline mode the payment
        is queued locally for deferred sync.
        """
        try:
            return await runtime.accept_payment(
                amount_lifepp=req.amount_lifepp,
                customer_node_id=req.customer_node_id,
                payload=req.payload,
                amount_fiat=req.amount_fiat,
                fiat_currency=req.fiat_currency,
                artifact_id=req.artifact_id,
                device_context=req.device_context,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except OverflowError as exc:
            raise HTTPException(status_code=503, detail=str(exc))

    @app.post("/trust/anchor")
    async def anchor_trust(req: TrustAnchorRequest) -> Dict[str, Any]:
        """
        Create a trust-anchored interaction event.

        This produces an AHIN AssociationEvent anchoring the interaction
        in the directional trust graph.
        """
        return runtime.anchor_trust(
            responder_node_id=req.responder_node_id,
            interaction_context=req.interaction_context,
            trust_delta=req.trust_delta,
            task_id=req.task_id,
        )

    @app.post("/agent/participate")
    async def record_agent_participation(
        req: AgentParticipationRequest,
    ) -> Dict[str, Any]:
        """
        Record an agent's participation in an edge terminal interaction.

        This creates an auditable record linking the agent's contribution
        to a specific interaction for POC evidence.
        """
        return runtime.record_agent_participation(
            agent_node_id=req.agent_node_id,
            interaction_id=req.interaction_id,
            role=req.role,
            contribution_summary=req.contribution_summary,
            grounding_evidence=req.grounding_evidence,
        )

    @app.post("/sync")
    async def sync_offline_queue() -> Dict[str, Any]:
        """Sync all pending offline transactions to the central system."""
        synced = await runtime.sync_offline_queue()
        return {
            "synced_count": synced,
            "remaining_queue_size": runtime.device_status()["queue_size"],
        }

    @app.post("/day-close")
    async def execute_day_close() -> Dict[str, Any]:
        """
        Execute end-of-day reconciliation.

        Drains the offline queue, aggregates participation records,
        and produces a reconciliation audit record.
        """
        return await runtime.execute_day_close()

    @app.get("/status")
    async def get_status() -> Dict[str, Any]:
        """Return a comprehensive status snapshot of this terminal."""
        return runtime.device_status()

    return app


# ---------------------------------------------------------------------------
# Standalone execution
# ---------------------------------------------------------------------------

app = create_edge_terminal_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "apps.edge_terminal.main:app",
        host=os.getenv("EDGE_HOST", "0.0.0.0"),
        port=int(os.getenv("EDGE_PORT", "8001")),
        reload=True,
    )
