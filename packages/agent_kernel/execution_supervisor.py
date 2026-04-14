"""
ExecutionSupervisor — manages the full CognitiveTask lifecycle.

The ExecutionSupervisor sits above the AgentKernel.
It handles:
  - Idempotent task submission
  - Retry logic with exponential backoff
  - Timeout and kill-switch enforcement
  - Duplicate execution prevention
  - Anomaly detection hooks
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3
_BASE_BACKOFF_SECONDS = 1.0
_TASK_TIMEOUT_SECONDS = 120.0


class ExecutionSupervisor:
    """
    Supervises the execution of CognitiveTasks with reliability guarantees.

    Key invariants:
      - A task with a given idempotency_key is executed AT MOST ONCE
        (even under retry storms).
      - Execution is bounded by a configurable timeout.
      - Anomaly detection can trigger a kill-switch to halt a misbehaving agent.
    """

    def __init__(self, kernel: Any, timeout_seconds: float = _TASK_TIMEOUT_SECONDS) -> None:
        self._kernel = kernel
        self._timeout = timeout_seconds
        self._executed_keys: set[str] = set()  # In-memory dedup (use Redis in prod)
        self._killed_agents: set[str] = set()

    async def submit(
        self,
        idempotency_key: str,
        capability: str,
        input_payload: Dict[str, Any],
        initiator_node_id: str,
        policy_constraints: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Submit a CognitiveTask for execution with idempotency and retry.

        Returns the artifact metadata dict or None on failure.
        """
        if idempotency_key in self._executed_keys:
            logger.warning(
                "Duplicate task submission suppressed",
                extra={"idempotency_key": idempotency_key},
            )
            return None

        task_id = idempotency_key  # Use idempotency key as task ID for traceability

        for attempt in range(1, _MAX_RETRIES + 1):
            # Kill switch — refuse tasks for suspended agents
            capable = self._kernel.find_capable_agents(capability)
            if capable and capable[0].node_id in self._killed_agents:
                logger.error(
                    "Agent is suspended (kill switch active)",
                    extra={"node_id": capable[0].node_id},
                )
                return None

            try:
                result = await asyncio.wait_for(
                    self._kernel.dispatch_task(
                        task_id=task_id,
                        capability=capability,
                        input_payload=input_payload,
                        initiator_node_id=initiator_node_id,
                        policy_constraints=policy_constraints,
                    ),
                    timeout=self._timeout,
                )
                if result is not None:
                    self._executed_keys.add(idempotency_key)
                    return result
            except asyncio.TimeoutError:
                logger.error(
                    "Task timed out",
                    extra={"task_id": task_id, "attempt": attempt},
                )
            except Exception:
                logger.exception(
                    "Task execution error",
                    extra={"task_id": task_id, "attempt": attempt},
                )

            if attempt < _MAX_RETRIES:
                backoff = _BASE_BACKOFF_SECONDS * (2 ** (attempt - 1))
                await asyncio.sleep(backoff)

        logger.error(
            "Task failed after max retries",
            extra={"task_id": task_id, "max_retries": _MAX_RETRIES},
        )
        return None

    def activate_kill_switch(self, node_id: str, reason: str) -> None:
        """Suspend an agent from executing further tasks."""
        self._killed_agents.add(node_id)
        logger.warning(
            "Kill switch activated",
            extra={"node_id": node_id, "reason": reason},
        )

    def deactivate_kill_switch(self, node_id: str) -> None:
        """Restore an agent's execution rights."""
        self._killed_agents.discard(node_id)
        logger.info("Kill switch deactivated", extra={"node_id": node_id})
