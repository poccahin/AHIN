"""
SQLAlchemy async ORM models for Life++ Agent OS.

All table names use the Life++ domain vocabulary.
We use async SQLAlchemy 2.x with declarative mapping.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, relationship


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Declarative base
# ---------------------------------------------------------------------------

class Base(DeclarativeBase):
    """Shared declarative base for all Life++ ORM models."""


# ---------------------------------------------------------------------------
# DigitalAvatarNode  (formerly: User / AgentNode)
# ---------------------------------------------------------------------------

class DigitalAvatarNodeORM(Base):
    """
    Persistent identity for every AHIN participant.
    Replaces the generic 'User' or 'AgentNode' concept.
    """
    __tablename__ = "digital_avatar_node"

    node_id: str = Column(String(36), primary_key=True, default=_uuid)
    node_type: str = Column(String(32), nullable=False, index=True)
    display_name: str = Column(String(256), nullable=True)
    public_key: str = Column(String(256), nullable=True, unique=True)
    trust_weight: float = Column(Float, nullable=False, default=0.0)
    admission_stake_lifepp: float = Column(Float, nullable=False, default=0.0)
    is_admitted_to_ahin: bool = Column(Boolean, nullable=False, default=False)
    created_at: datetime = Column(DateTime(timezone=True), nullable=False, default=_now)
    metadata_json: dict = Column(JSONB, nullable=False, default=dict)

    cognitive_tasks = relationship("CognitiveTaskORM", back_populates="initiator")
    wallet_accounts = relationship("WalletAccountORM", back_populates="node")
    ledger_entries = relationship("JournalEntryORM", back_populates="node")


# ---------------------------------------------------------------------------
# CognitiveTask  (formerly: Task)
# ---------------------------------------------------------------------------

class CognitiveTaskORM(Base):
    """
    Unit of subjective intentionality submitted for cognitive processing.
    Replaces the generic 'Task' concept.
    """
    __tablename__ = "cognitive_task"

    task_id: str = Column(String(36), primary_key=True, default=_uuid)
    initiator_node_id: str = Column(
        String(36), ForeignKey("digital_avatar_node.node_id"), nullable=False, index=True
    )
    status: str = Column(String(32), nullable=False, default="pending", index=True)
    task_type: str = Column(String(128), nullable=False)
    input_payload: dict = Column(JSONB, nullable=False, default=dict)
    policy_constraints: dict = Column(JSONB, nullable=False, default=dict)
    spontaneous_time_order: dict = Column(JSONB, nullable=False, default=dict)
    created_at: datetime = Column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at: datetime = Column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )
    idempotency_key: str = Column(String(128), nullable=False, unique=True)

    initiator = relationship("DigitalAvatarNodeORM", back_populates="cognitive_tasks")
    artifacts = relationship("CanxianArtifactORM", back_populates="task")

    __table_args__ = (
        Index("ix_cognitive_task_status_created", "status", "created_at"),
    )


# ---------------------------------------------------------------------------
# CanxianArtifact  (formerly: OutputArtifact)
# ---------------------------------------------------------------------------

class CanxianArtifactORM(Base):
    """
    The objectification / solidification of cognitive effort.
    Replaces the generic 'OutputArtifact' concept.

    An artifact moves through four levels of validation:
      RAW_OUTPUT → OPERATIONALLY_GROUNDED → VALIDATED_CANXIAN → PAYABLE
    """
    __tablename__ = "canxian_artifact"

    artifact_id: str = Column(String(36), primary_key=True, default=_uuid)
    task_id: str = Column(
        String(36), ForeignKey("cognitive_task.task_id"), nullable=False, index=True
    )
    producer_node_id: str = Column(String(36), nullable=False, index=True)
    status: str = Column(
        String(32), nullable=False, default="raw_output", index=True
    )
    artifact_type: str = Column(String(128), nullable=False)
    content_hash: str = Column(
        String(256), nullable=False, comment="BLAKE3/SHA256 of artifact content"
    )
    content_ref: str = Column(
        Text,
        nullable=True,
        comment="Storage URI (IPFS CID, S3 key, etc.) for large artifacts",
    )
    grounding_context: dict = Column(
        JSONB,
        nullable=False,
        default=dict,
        comment=(
            "Operational context that anchors this output (Tactile Brain Hypothesis). "
            "Empty dict = raw model output only."
        ),
    )
    poc_record_id: str = Column(
        String(36),
        ForeignKey("poc_record.poc_id"),
        nullable=True,
        comment="Link to POC validation record",
    )
    spontaneous_time_order: dict = Column(JSONB, nullable=False, default=dict)
    created_at: datetime = Column(DateTime(timezone=True), nullable=False, default=_now)
    validated_at: datetime = Column(DateTime(timezone=True), nullable=True)

    task = relationship("CognitiveTaskORM", back_populates="artifacts")
    poc_record = relationship("POCRecordORM", back_populates="artifact")


# ---------------------------------------------------------------------------
# AssociationEvent  (formerly: WorkflowEvent)
# ---------------------------------------------------------------------------

class AssociationEventORM(Base):
    """
    Records directional AHIN interactions: Proactive and Acceptance.

    These events are the primary trust anchors in AHIN.
    They are NOT generic 'workflow events' — they carry the philosophical
    weight of spontaneous association and mutual recognition.
    """
    __tablename__ = "association_event"

    event_id: str = Column(String(36), primary_key=True, default=_uuid)
    event_type: str = Column(String(64), nullable=False, index=True)
    initiator_node_id: str = Column(String(36), nullable=False, index=True)
    responder_node_id: str = Column(String(36), nullable=True, index=True)
    task_id: str = Column(
        String(36), ForeignKey("cognitive_task.task_id"), nullable=True
    )
    interaction_hash: str = Column(
        String(256),
        nullable=False,
        comment="Hash chaining this event to predecessor — implements Spontaneous Time Order",
    )
    trust_delta: float = Column(
        Float,
        nullable=False,
        default=0.0,
        comment="How much this interaction shifts trust weight",
    )
    payload: dict = Column(JSONB, nullable=False, default=dict)
    spontaneous_time_order: dict = Column(JSONB, nullable=False, default=dict)
    created_at: datetime = Column(DateTime(timezone=True), nullable=False, default=_now)
    idempotency_key: str = Column(String(128), nullable=False, unique=True)


# ---------------------------------------------------------------------------
# POCRecord  (formerly: ContributionRecord)
# ---------------------------------------------------------------------------

class POCRecordORM(Base):
    """
    Proof of Cognitive Canxian record.

    Documents that a CanxianArtifact was produced through meaningful cognitive
    work — NOT brute-force compute, NOT pure capital stake.
    This is the basis for value attribution and VirtueWellbeing settlement.
    """
    __tablename__ = "poc_record"

    poc_id: str = Column(String(36), primary_key=True, default=_uuid)
    producer_node_id: str = Column(String(36), nullable=False, index=True)
    validator_node_id: str = Column(
        String(36),
        nullable=True,
        comment="Node that validated this POC (can be a policy engine or peer)",
    )
    validation_method: str = Column(String(128), nullable=False)
    cognitive_score: float = Column(
        Float,
        nullable=False,
        default=0.0,
        comment="Dimensionless cognitive contribution weight (0–1 scale per task class)",
    )
    is_zombie_output: bool = Column(
        Boolean,
        nullable=False,
        default=False,
        comment=(
            "True if heuristics flagged this as philosophically-zombie-like output "
            "(statistically plausible but causally ungrounded)"
        ),
    )
    evidence: dict = Column(JSONB, nullable=False, default=dict)
    spontaneous_time_order: dict = Column(JSONB, nullable=False, default=dict)
    created_at: datetime = Column(DateTime(timezone=True), nullable=False, default=_now)

    artifact = relationship("CanxianArtifactORM", back_populates="poc_record")


# ---------------------------------------------------------------------------
# WalletAccount
# ---------------------------------------------------------------------------

class WalletAccountORM(Base):
    """
    Sub-account ledger for a DigitalAvatarNode.

    Each account type is kept separate (capital_stake, payment_balance,
    contribution_credit, trust_weight, settlement_claim, locked_participation).
    Balances are DERIVED from JournalEntries — never mutated directly.
    """
    __tablename__ = "wallet_account"

    account_id: str = Column(String(36), primary_key=True, default=_uuid)
    node_id: str = Column(
        String(36), ForeignKey("digital_avatar_node.node_id"), nullable=False, index=True
    )
    account_type: str = Column(String(64), nullable=False)
    currency: str = Column(String(16), nullable=False, default="LIFEPP")
    created_at: datetime = Column(DateTime(timezone=True), nullable=False, default=_now)

    node = relationship("DigitalAvatarNodeORM", back_populates="wallet_accounts")
    entries = relationship("JournalEntryORM", back_populates="account")

    __table_args__ = (
        UniqueConstraint("node_id", "account_type", "currency", name="uq_wallet_account"),
    )


# ---------------------------------------------------------------------------
# JournalEntry  (Cognitive Value Ledger — append-only)
# ---------------------------------------------------------------------------

class JournalEntryORM(Base):
    """
    Append-only journal entry for the Cognitive Value Ledger.

    Rules:
    - NEVER update or delete rows
    - Balances MUST be derived by summing entries
    - Every action in the system maps to one or more journal entries
    - Idempotency key ensures retry-safety and no double-spend
    """
    __tablename__ = "journal_entry"

    entry_id: str = Column(String(36), primary_key=True, default=_uuid)
    account_id: str = Column(
        String(36), ForeignKey("wallet_account.account_id"), nullable=False, index=True
    )
    node_id: str = Column(
        String(36), ForeignKey("digital_avatar_node.node_id"), nullable=False, index=True
    )
    event_type: str = Column(String(64), nullable=False, index=True)
    amount: float = Column(
        Float,
        nullable=False,
        comment="Positive = credit, Negative = debit",
    )
    related_artifact_id: str = Column(String(36), nullable=True, index=True)
    related_poc_id: str = Column(String(36), nullable=True, index=True)
    related_event_id: str = Column(String(36), nullable=True, index=True)
    memo: str = Column(Text, nullable=True)
    idempotency_key: str = Column(String(128), nullable=False, unique=True)
    spontaneous_time_order: dict = Column(JSONB, nullable=False, default=dict)
    created_at: datetime = Column(DateTime(timezone=True), nullable=False, default=_now)

    account = relationship("WalletAccountORM", back_populates="entries")
    node = relationship("DigitalAvatarNodeORM", back_populates="ledger_entries")

    __table_args__ = (
        Index("ix_journal_entry_node_event", "node_id", "event_type", "created_at"),
    )


# ---------------------------------------------------------------------------
# ValueFlowEvent  (formerly: PaymentEvent)
# ---------------------------------------------------------------------------

class ValueFlowEventORM(Base):
    """
    Records every value movement in the system.

    This transcends fiat/crypto payment: it represents the flow of cognitive-
    economic energy between nodes aligned with Virtue and Well-being.
    """
    __tablename__ = "value_flow_event"

    flow_id: str = Column(String(36), primary_key=True, default=_uuid)
    flow_type: str = Column(String(64), nullable=False, index=True)
    from_node_id: str = Column(String(36), nullable=True, index=True)
    to_node_id: str = Column(String(36), nullable=True, index=True)
    amount_lifepp: float = Column(Float, nullable=False)
    amount_usdt_equivalent: float = Column(Float, nullable=True)
    related_task_id: str = Column(String(36), nullable=True, index=True)
    related_artifact_id: str = Column(String(36), nullable=True)
    related_poc_id: str = Column(String(36), nullable=True)
    status: str = Column(String(32), nullable=False, default="pending", index=True)
    on_chain_tx_id: str = Column(
        String(256), nullable=True, comment="Solana transaction signature"
    )
    idempotency_key: str = Column(String(128), nullable=False, unique=True)
    spontaneous_time_order: dict = Column(JSONB, nullable=False, default=dict)
    created_at: datetime = Column(DateTime(timezone=True), nullable=False, default=_now)
    settled_at: datetime = Column(DateTime(timezone=True), nullable=True)


# ---------------------------------------------------------------------------
# VirtueWellbeingSettlementBatch  (formerly: SettlementBatch)
# ---------------------------------------------------------------------------

class VirtueWellbeingSettlementBatchORM(Base):
    """
    A batch of VirtueWellbeing settlements — structurally aligning moral
    contribution with welfare outcomes (德福一致).

    Each batch covers a settlement period (typically a day-close cycle).
    """
    __tablename__ = "virtue_wellbeing_settlement_batch"

    batch_id: str = Column(String(36), primary_key=True, default=_uuid)
    period_start: datetime = Column(DateTime(timezone=True), nullable=False)
    period_end: datetime = Column(DateTime(timezone=True), nullable=False)
    status: str = Column(String(32), nullable=False, default="open", index=True)
    total_contribution_credits: float = Column(Float, nullable=False, default=0.0)
    total_lifepp_distributed: float = Column(Float, nullable=False, default=0.0)
    treasury_allocation_lifepp: float = Column(Float, nullable=False, default=0.0)
    participant_count: int = Column(Integer, nullable=False, default=0)
    settlement_entries: dict = Column(JSONB, nullable=False, default=dict)
    audit_hash: str = Column(
        String(256),
        nullable=True,
        comment="Hash of all journal entries included in this batch",
    )
    created_at: datetime = Column(DateTime(timezone=True), nullable=False, default=_now)
    closed_at: datetime = Column(DateTime(timezone=True), nullable=True)


# ---------------------------------------------------------------------------
# ObjectificationReceipt  (formerly: LocalReceipt)
# ---------------------------------------------------------------------------

class ObjectificationReceiptORM(Base):
    """
    Proof of Life+ externalization to media — produced at the edge terminal.

    This receipt proves that intelligence was externalized into a durable action,
    record, or tool-mediated coordination event at a physical node.
    """
    __tablename__ = "objectification_receipt"

    receipt_id: str = Column(String(36), primary_key=True, default=_uuid)
    terminal_node_id: str = Column(String(36), nullable=False, index=True)
    artifact_id: str = Column(String(36), nullable=True, index=True)
    flow_id: str = Column(String(36), nullable=True, index=True)
    merchant_node_id: str = Column(String(36), nullable=True)
    amount_lifepp: float = Column(Float, nullable=True)
    amount_fiat: float = Column(Float, nullable=True)
    fiat_currency: str = Column(String(8), nullable=True)
    is_offline: bool = Column(Boolean, nullable=False, default=False)
    sync_status: str = Column(String(32), nullable=False, default="pending")
    receipt_hash: str = Column(String(256), nullable=False)
    payload: dict = Column(JSONB, nullable=False, default=dict)
    spontaneous_time_order: dict = Column(JSONB, nullable=False, default=dict)
    created_at: datetime = Column(DateTime(timezone=True), nullable=False, default=_now)
    synced_at: datetime = Column(DateTime(timezone=True), nullable=True)
