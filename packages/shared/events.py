"""
Event schemas for the Life++ Agent OS event bus.

All system actions MUST be events — this is the cognitive-economic audit trail.
Every event carries:
  - idempotency_key: safe retry
  - spontaneous_time_order: AHIN-style temporal ordering
  - schema_version: forward compatibility

Event hierarchy:
  BaseEvent
    ├── CognitiveEvent        (task lifecycle)
    ├── AssociationEvent      (AHIN proactive/acceptance)
    ├── ValueFlowEvent        (economic energy transfer)
    ├── SettlementEvent       (VirtueWellbeing settlement)
    └── ReconciliationEvent   (edge/day-close reconciliation)
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from pydantic import Field

from packages.shared.domain import (
    AssociationEventType,
    CanxianArtifactStatus,
    CognitiveTaskStatus,
    LifePPBaseModel,
    SpontaneousTimeOrder,
    ValueFlowEventType,
    new_id,
    now_utc,
)


# ---------------------------------------------------------------------------
# Base event
# ---------------------------------------------------------------------------

class BaseEvent(LifePPBaseModel):
    """
    Immutable base for all Life++ events.

    Every event is a cognitive objectification of a system state transition.
    """
    event_id: str = Field(default_factory=new_id)
    event_name: str
    schema_version: str = "1.0"
    idempotency_key: str = Field(
        default_factory=new_id,
        description="Stable key for at-least-once delivery deduplication",
    )
    time_order: SpontaneousTimeOrder
    emitted_at: datetime = Field(default_factory=now_utc)
    payload: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# CognitiveEvent
# ---------------------------------------------------------------------------

class CognitiveEvent(BaseEvent):
    """
    Records a CognitiveTask lifecycle transition.

    Examples:
      - task submitted (PENDING)
      - execution started (EXECUTING)
      - artifact produced (OBJECTIFIED)
      - POC validated (VALIDATING → OBJECTIFIED)
      - settled (SETTLED)
    """
    event_name: str = "cognitive_event"
    task_id: str
    initiator_node_id: str
    task_status: CognitiveTaskStatus
    artifact_id: Optional[str] = None
    poc_id: Optional[str] = None
    error_detail: Optional[str] = None


# ---------------------------------------------------------------------------
# AssociationEvent
# ---------------------------------------------------------------------------

class AssociationEvent(BaseEvent):
    """
    Records an AHIN directional interaction.

    Proactive Association: initiator proposes collaboration.
    Acceptance of Association: responder confirms.

    These events are the primary building blocks of the AHIN trust graph.
    They are NOT generic workflow signals.
    """
    event_name: str = "association_event"
    association_type: AssociationEventType
    initiator_node_id: str
    responder_node_id: Optional[str] = None
    task_id: Optional[str] = None
    interaction_hash: str = Field(
        ...,
        description="Hash chaining this event to its predecessor for Spontaneous Time Order",
    )
    trust_delta: float = Field(
        default=0.0,
        description="How much this interaction adjusts the trust weight",
    )


# ---------------------------------------------------------------------------
# ValueFlowEvent  (formerly: PaymentEvent)
# ---------------------------------------------------------------------------

class ValueFlowEvent(BaseEvent):
    """
    Records a movement of cognitive-economic value between nodes.

    This is NOT a generic payment event.
    It represents the directed flow of LIFE++ aligned with Virtue and Well-being.
    """
    event_name: str = "value_flow_event"
    flow_type: ValueFlowEventType
    from_node_id: Optional[str] = None
    to_node_id: Optional[str] = None
    amount_lifepp: float
    amount_usdt_equivalent: Optional[float] = None
    related_task_id: Optional[str] = None
    related_artifact_id: Optional[str] = None
    related_poc_id: Optional[str] = None
    on_chain_tx_id: Optional[str] = None


# ---------------------------------------------------------------------------
# ArtifactValidationEvent
# ---------------------------------------------------------------------------

class ArtifactValidationEvent(BaseEvent):
    """
    Records the transition of a CanxianArtifact through validation levels.

    The four levels distinguish:
      1. mere model output (RAW_OUTPUT)
      2. operationally grounded cognitive output (GROUNDED)
      3. validated Cognitive Canxian (VALIDATED_CANXIAN)
      4. payable / governable / auditable contribution (PAYABLE)
    """
    event_name: str = "artifact_validation_event"
    artifact_id: str
    producer_node_id: str
    from_status: CanxianArtifactStatus
    to_status: CanxianArtifactStatus
    validator_node_id: Optional[str] = None
    poc_id: Optional[str] = None
    is_zombie_flagged: bool = False
    validation_evidence: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# SettlementEvent
# ---------------------------------------------------------------------------

class SettlementEvent(BaseEvent):
    """
    Records a VirtueWellbeing settlement action.

    Settlement must be interpretable as a cognitive objectification event —
    the system acknowledges meaningful contribution and distributes aligned value.
    """
    event_name: str = "settlement_event"
    batch_id: str
    recipient_node_id: str
    contribution_credit: float
    lifepp_awarded: float
    poc_ids: list[str] = Field(default_factory=list)
    period_start: datetime
    period_end: datetime


# ---------------------------------------------------------------------------
# ReconciliationEvent
# ---------------------------------------------------------------------------

class ReconciliationEvent(BaseEvent):
    """
    Records a reconciliation action — typically from an edge terminal sync
    or a day-close operation.
    """
    event_name: str = "reconciliation_event"
    reconciliation_type: str  # "edge_sync" | "day_close" | "conflict_resolution"
    terminal_node_id: Optional[str] = None
    batch_id: Optional[str] = None
    total_receipts: int = 0
    total_lifepp: float = 0.0
    discrepancy_count: int = 0
    resolution_notes: Optional[str] = None


# ---------------------------------------------------------------------------
# TrustEvent
# ---------------------------------------------------------------------------

class TrustEvent(BaseEvent):
    """
    Records a trust state change in the AHIN trust graph.

    Trust is emergent — it is NOT assigned by a central authority.
    It changes as a result of directional interactions.
    """
    event_name: str = "trust_event"
    subject_node_id: str
    trust_event_type: str  # TrustEventType enum value
    delta: float
    new_trust_weight: float
    triggering_association_event_id: Optional[str] = None
    evidence: Dict[str, Any] = Field(default_factory=dict)
