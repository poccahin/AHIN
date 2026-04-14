"""CognitiveTasks router — submit and query cognitive tasks."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import Field

from packages.shared.domain import CognitiveTaskStatus, LifePPBaseModel, new_id, now_utc

router = APIRouter()


class SubmitCognitiveTaskRequest(LifePPBaseModel):
    initiator_node_id: str
    capability: str
    input_payload: Dict[str, Any] = Field(default_factory=dict)
    policy_constraints: Dict[str, Any] = Field(default_factory=dict)
    idempotency_key: Optional[str] = None


class SubmitCognitiveTaskResponse(LifePPBaseModel):
    task_id: str
    status: CognitiveTaskStatus
    idempotency_key: str
    submitted_at: str


@router.post("/submit", response_model=SubmitCognitiveTaskResponse)
async def submit_cognitive_task(
    req: SubmitCognitiveTaskRequest,
) -> SubmitCognitiveTaskResponse:
    """
    Submit a CognitiveTask for execution by an AHIN-admitted agent.

    The task represents the objectification of subjective intentionality.
    It is NOT a generic 'job' — it carries policy, trust, and POC implications.
    """
    # TODO: integrate with ExecutionSupervisor.submit()
    idempotency_key = req.idempotency_key or new_id()
    task_id = new_id()
    return SubmitCognitiveTaskResponse(
        task_id=task_id,
        status=CognitiveTaskStatus.PENDING,
        idempotency_key=idempotency_key,
        submitted_at=now_utc().isoformat(),
    )


@router.get("/{task_id}/status")
async def get_task_status(task_id: str) -> Dict[str, Any]:
    """
    Get the current status of a CognitiveTask.

    Status values: pending → scheduled → executing → validating → objectified → settled
    """
    # TODO: query CognitiveTaskORM from DB
    return {
        "task_id": task_id,
        "status": CognitiveTaskStatus.PENDING,
        "message": "TODO: query from DB",
    }
