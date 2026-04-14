"""Agents router — registration, AHIN admission, identity."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import Field

from packages.shared.domain import LifePPBaseModel, NodeType, new_id, now_utc

router = APIRouter()


class RegisterAgentRequest(LifePPBaseModel):
    node_type: NodeType = NodeType.MACHINE_AGENT
    display_name: Optional[str] = None
    public_key: Optional[str] = None
    capabilities: List[str] = Field(default_factory=list)


class RegisterAgentResponse(LifePPBaseModel):
    node_id: str
    node_type: str
    display_name: Optional[str]
    is_admitted_to_ahin: bool = False
    created_at: str


@router.post("/register", response_model=RegisterAgentResponse)
async def register_agent(req: RegisterAgentRequest) -> RegisterAgentResponse:
    """
    Register a new cognitive-economic agent in the Life++ Agent OS.

    The agent is NOT yet admitted to AHIN — it must stake LIFE++ first.
    """
    # TODO: persist to DB via DigitalAvatarNodeORM
    node_id = new_id()
    return RegisterAgentResponse(
        node_id=node_id,
        node_type=req.node_type,
        display_name=req.display_name or f"agent-{node_id[:8]}",
        is_admitted_to_ahin=False,
        created_at=now_utc().isoformat(),
    )


class AhinAdmissionRequest(LifePPBaseModel):
    node_id: str
    stake_lifepp: float
    lifepp_usdt_price: float


class AhinAdmissionResponse(LifePPBaseModel):
    admitted: bool
    node_id: str
    stake_lifepp: float
    message: str


@router.post("/ahin-admission", response_model=AhinAdmissionResponse)
async def apply_ahin_admission(req: AhinAdmissionRequest) -> AhinAdmissionResponse:
    """
    Apply to join AHIN by staking LIFE++.

    Rule: stake >= 10 USDT equivalent in LIFE++ (not PoS — cognitive participation stake).
    """
    # TODO: integrate with WalletService and AgentKernel.check_ahin_admission
    usdt_value = req.stake_lifepp * req.lifepp_usdt_price
    admitted = usdt_value >= 10.0
    return AhinAdmissionResponse(
        admitted=admitted,
        node_id=req.node_id,
        stake_lifepp=req.stake_lifepp,
        message=(
            "Admitted to AHIN" if admitted
            else f"Insufficient stake: {usdt_value:.4f} USDT (minimum 10 USDT)"
        ),
    )
