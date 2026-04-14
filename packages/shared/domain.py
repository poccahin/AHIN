"""
Domain enumerations and primitive types for the Life++ Agent OS.

All names are derived from Prof. Cai Hengjin's theoretical framework.
Do NOT rename these to generic Web2/Web3 terminology.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Primitive helpers
# ---------------------------------------------------------------------------

def now_utc() -> datetime:
    """Return timezone-aware UTC datetime (used as SpontaneousTimeOrder seed)."""
    return datetime.now(tz=timezone.utc)


def new_id() -> str:
    """Generate a new UUID4 string identifier."""
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class CognitiveTaskStatus(str, Enum):
    """Lifecycle states of a CognitiveTask."""
    PENDING = "pending"
    SCHEDULED = "scheduled"
    EXECUTING = "executing"
    VALIDATING = "validating"          # POC validation underway
    OBJECTIFIED = "objectified"        # CanxianArtifact produced
    SETTLED = "settled"                # VirtueWellbeing settlement complete
    FAILED = "failed"
    CANCELLED = "cancelled"


class AssociationEventType(str, Enum):
    """
    AHIN interaction types.

    Proactive Association: an agent initiates a collaboration request.
    Acceptance of Association: a peer acknowledges and joins.
    """
    PROACTIVE = "proactive_association"
    ACCEPTANCE = "acceptance_of_association"
    DISSOLUTION = "dissolution"


class ValueFlowEventType(str, Enum):
    """Types of value movements in the Cognitive Value Ledger."""
    ADMISSION_STAKE = "admission_stake"          # joining AHIN
    COLLABORATION_COST = "collaboration_cost"    # micro-usage
    CONTRIBUTION_REWARD = "contribution_reward"  # POC-validated payout
    MERCHANT_SETTLEMENT = "merchant_settlement"
    TREASURY_ALLOCATION = "treasury_allocation"
    REFUND = "refund"
    TRANSFER = "transfer"


class CanxianArtifactStatus(str, Enum):
    """
    Status of a CanxianArtifact in the objectification pipeline.

    An artifact moves through: raw model output → grounded output →
    validated Canxian → payable / governable contribution.
    """
    RAW_OUTPUT = "raw_output"              # mere model output — NOT yet Canxian
    OPERATIONALLY_GROUNDED = "grounded"    # anchored to real context/resistance
    VALIDATED_CANXIAN = "validated"        # POC-confirmed cognitive objectification
    PAYABLE = "payable"                    # eligible for VirtueWellbeing settlement


class TrustEventType(str, Enum):
    """Trust state transitions in AHIN."""
    ESTABLISHED = "established"
    REINFORCED = "reinforced"
    DEGRADED = "degraded"
    REVOKED = "revoked"


class AccountType(str, Enum):
    """
    Accounts in the Cognitive Value Ledger.

    These must NOT be collapsed into a single balance field.
    Each represents a distinct economic role.
    """
    CAPITAL_STAKE = "capital_stake"              # participation admission stake
    PAYMENT_BALANCE = "payment_balance"          # spendable operational balance
    CONTRIBUTION_CREDIT = "contribution_credit"  # POC-earned credits
    TRUST_WEIGHT = "trust_weight"                # emergent trust score (not money)
    SETTLEMENT_CLAIM = "settlement_claim"        # pending settlement obligation
    LOCKED_PARTICIPATION = "locked_participation"  # locked while participating


class NodeType(str, Enum):
    """Types of nodes in the AHIN topology."""
    DIGITAL_AVATAR = "digital_avatar"    # human-AI symbiotic node (formerly User)
    MACHINE_AGENT = "machine_agent"      # autonomous software agent
    EDGE_TERMINAL = "edge_terminal"      # embodied local cognition-and-settlement node
    MERCHANT_NODE = "merchant_node"      # service provider node


# ---------------------------------------------------------------------------
# Base schema
# ---------------------------------------------------------------------------

class LifePPBaseModel(BaseModel):
    """
    Base Pydantic model for all Life++ domain objects.

    Enforces strict typing and ISO-serializable datetimes.
    """

    model_config = {
        "use_enum_values": True,
        "populate_by_name": True,
    }


# ---------------------------------------------------------------------------
# Spontaneous Time Order
# ---------------------------------------------------------------------------

class SpontaneousTimeOrder(LifePPBaseModel):
    """
    Represents the locally-emergent time ordering of an interaction.

    Per AHIN theory, time is NOT solely determined by a centralised timestamp
    authority.  It is the *emergent ordering* of interactions among nodes.
    This structure carries both the wall-clock seed and the interaction
    sequence number from the local node so that ordering can be reconstructed
    without global consensus.
    """
    wall_clock_utc: datetime = Field(default_factory=now_utc)
    local_sequence: int = Field(
        ..., description="Monotonically increasing per-node sequence number"
    )
    node_id: str = Field(..., description="Originating AHIN node identifier")
    interaction_hash: Optional[str] = Field(
        None,
        description=(
            "BLAKE3/SHA256 hash of the preceding interaction — chains time order "
            "without requiring global consensus"
        ),
    )


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------

class DigitalAvatarNode(LifePPBaseModel):
    """
    A human-AI symbiotic node participating in AHIN.

    Formerly called 'User' or 'AgentNode' in generic frameworks.
    In Life++ every participant is a cognitive-economic actor with:
      - identity (DID-compatible)
      - trust weight (emergent, not assigned)
      - participation stake (capital commitment)
    """
    node_id: str = Field(default_factory=new_id)
    node_type: NodeType = NodeType.DIGITAL_AVATAR
    display_name: Optional[str] = None
    public_key: Optional[str] = Field(
        None, description="Solana public key for on-chain identity binding"
    )
    trust_weight: float = Field(
        default=0.0,
        ge=0.0,
        description="Emergent trust from directional interaction history — NOT a score",
    )
    admission_stake_lifepp: float = Field(
        default=0.0,
        description="LIFE++ held as AHIN admission stake (≥ 10 USDT equivalent)",
    )
    is_admitted_to_ahin: bool = False
    created_at: datetime = Field(default_factory=now_utc)
    metadata: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Data Ontology State
# ---------------------------------------------------------------------------

class DataOntologyState(LifePPBaseModel):
    """
    The ground truth of the system — what has been confirmed through human
    subjective screening and interaction.

    Formerly called 'GlobalState' in generic systems.
    In Life++ state is never 'global' in the centralised sense; it is the
    *accumulated objectification* of human-verified interactions.
    """
    snapshot_id: str = Field(default_factory=new_id)
    time_order: SpontaneousTimeOrder
    confirmed_artifact_ids: List[str] = Field(default_factory=list)
    confirmed_poc_ids: List[str] = Field(default_factory=list)
    ontology_hash: str = Field(
        ...,
        description="Hash of the current ontology state for tamper-evidence",
    )
    metadata: Dict[str, Any] = Field(default_factory=dict)
