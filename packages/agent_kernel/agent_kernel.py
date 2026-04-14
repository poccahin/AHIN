"""
AgentKernel — the OS-level supervisor for cognitive agent execution.

The AgentKernel is the central coordinator that:
  1. Validates agent admission to AHIN (stake check)
  2. Dispatches CognitiveTasks to capable agents
  3. Enforces PolicyEngine constraints
  4. Records all state transitions as CognitiveEvents
  5. Manages the CapabilityRegistry and TrustWeightModel

Think of this as the 'kernel' in an OS sense:
  it mediates between the agent user-space and the underlying
  AHIN / ledger / event infrastructure.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from typing import Any, Dict, List, Optional

from packages.shared.domain import (
    CanxianArtifactStatus,
    CognitiveTaskStatus,
    NodeType,
    SpontaneousTimeOrder,
    new_id,
    now_utc,
)
from packages.shared.events import ArtifactValidationEvent, CognitiveEvent

logger = logging.getLogger(__name__)

# Token economics constants (from .env or defaults)
AHIN_ADMISSION_THRESHOLD_USDT = float(
    os.getenv("AHIN_ADMISSION_THRESHOLD_USDT", "10.0")
)
COLLABORATION_COST_USDT = float(os.getenv("COLLABORATION_COST_USDT", "0.00001"))
COLLABORATION_COST_MAX_LIFEPP = float(
    os.getenv("COLLABORATION_COST_MAX_LIFEPP", "1.0")
)


class AgentKernel:
    """
    The cognitive execution kernel.

    NOT a generic task queue.
    This is the trust-policy-aware dispatcher for cognitive-economic actors.
    """

    def __init__(
        self,
        node_id: Optional[str] = None,
        event_bus: Optional[Any] = None,
        ledger_service: Optional[Any] = None,
        policy_engine: Optional[Any] = None,
    ) -> None:
        self.kernel_id: str = node_id or new_id()
        self._event_bus = event_bus
        self._ledger_service = ledger_service
        self._policy_engine = policy_engine
        self._registered_agents: Dict[str, Any] = {}  # node_id → BaseAgent
        self._capability_index: Dict[str, List[str]] = {}  # capability → [node_ids]
        self._local_sequence: int = 0
        logger.info("AgentKernel initialised", extra={"kernel_id": self.kernel_id})

    # ------------------------------------------------------------------
    # Agent registration
    # ------------------------------------------------------------------

    def register_agent(self, agent: Any) -> None:
        """
        Register a BaseAgent with the kernel.

        The agent is indexed by its capabilities so the kernel can
        route CognitiveTasks to the right cognitive actor.
        """
        self._registered_agents[agent.node_id] = agent
        for cap in agent.get_capabilities():
            self._capability_index.setdefault(cap, [])
            if agent.node_id not in self._capability_index[cap]:
                self._capability_index[cap].append(agent.node_id)
        logger.info(
            "Agent registered",
            extra={
                "node_id": agent.node_id,
                "capabilities": agent.get_capabilities(),
            },
        )

    def find_capable_agents(self, capability: str) -> List[Any]:
        """Return agents capable of handling a given capability."""
        node_ids = self._capability_index.get(capability, [])
        return [self._registered_agents[nid] for nid in node_ids if nid in self._registered_agents]

    # ------------------------------------------------------------------
    # AHIN admission
    # ------------------------------------------------------------------

    async def check_ahin_admission(
        self, node_id: str, stake_lifepp: float, lifepp_usdt_price: float
    ) -> bool:
        """
        Verify that an agent holds enough LIFE++ to join AHIN.

        Rule: stake >= 10 USDT equivalent in LIFE++
        This is a participation threshold, NOT a PoS stake.
        """
        usdt_value = stake_lifepp * lifepp_usdt_price
        admitted = usdt_value >= AHIN_ADMISSION_THRESHOLD_USDT
        if not admitted:
            logger.warning(
                "AHIN admission denied — insufficient stake",
                extra={
                    "node_id": node_id,
                    "stake_lifepp": stake_lifepp,
                    "usdt_value": usdt_value,
                    "threshold_usdt": AHIN_ADMISSION_THRESHOLD_USDT,
                },
            )
        return admitted

    def compute_collaboration_cost(self, lifepp_usdt_price: float) -> float:
        """
        Compute the micro-usage cost for one collaboration interaction.

        Rule: min{LIFE++ equivalent of 0.00001 USDT, 1 LIFE++}
        """
        lifepp_equivalent = (
            COLLABORATION_COST_USDT / lifepp_usdt_price
            if lifepp_usdt_price > 0
            else COLLABORATION_COST_MAX_LIFEPP
        )
        return min(lifepp_equivalent, COLLABORATION_COST_MAX_LIFEPP)

    # ------------------------------------------------------------------
    # Task dispatch
    # ------------------------------------------------------------------

    async def dispatch_task(
        self,
        task_id: str,
        capability: str,
        input_payload: Dict[str, Any],
        initiator_node_id: str,
        policy_constraints: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Dispatch a CognitiveTask to a capable agent.

        Workflow:
          1. Find capable agents
          2. Policy check
          3. Record SCHEDULED event
          4. Execute
          5. Causation check (anti-zombie)
          6. Produce CanxianArtifact metadata
          7. Emit CognitiveEvent (OBJECTIFIED or FAILED)
        """
        agents = self.find_capable_agents(capability)
        if not agents:
            logger.error(
                "No capable agent found",
                extra={"capability": capability, "task_id": task_id},
            )
            return None

        agent = agents[0]  # TODO: implement load-balanced selection
        time_order = self._next_time_order()

        # Emit SCHEDULED event
        await self._emit_cognitive_event(
            task_id=task_id,
            initiator_node_id=initiator_node_id,
            status=CognitiveTaskStatus.SCHEDULED,
            time_order=time_order,
        )

        # Policy check
        if self._policy_engine:
            allowed = await self._policy_engine.evaluate(
                task_id=task_id,
                agent=agent,
                payload=input_payload,
                constraints=policy_constraints or {},
            )
            if not allowed:
                await self._emit_cognitive_event(
                    task_id=task_id,
                    initiator_node_id=initiator_node_id,
                    status=CognitiveTaskStatus.FAILED,
                    time_order=self._next_time_order(),
                    error_detail="Policy engine rejected task",
                )
                return None

        await self._emit_cognitive_event(
            task_id=task_id,
            initiator_node_id=initiator_node_id,
            status=CognitiveTaskStatus.EXECUTING,
            time_order=self._next_time_order(),
        )

        try:
            await agent.on_task_received(task_id, input_payload)
            output = await agent.execute_cognitive_task(task_id, input_payload)

            # Causation Re-engineering check
            is_grounded = await agent.verify_causation(input_payload, output)
            artifact_status = (
                CanxianArtifactStatus.OPERATIONALLY_GROUNDED
                if is_grounded
                else CanxianArtifactStatus.RAW_OUTPUT
            )

            artifact_id = new_id()
            content_hash = hashlib.sha256(
                str(output).encode()
            ).hexdigest()

            await self._emit_artifact_validation_event(
                artifact_id=artifact_id,
                producer_node_id=agent.node_id,
                from_status=CanxianArtifactStatus.RAW_OUTPUT,
                to_status=artifact_status,
                is_zombie_flagged=not is_grounded,
                time_order=self._next_time_order(),
            )

            await self._emit_cognitive_event(
                task_id=task_id,
                initiator_node_id=initiator_node_id,
                status=CognitiveTaskStatus.OBJECTIFIED,
                time_order=self._next_time_order(),
                artifact_id=artifact_id,
            )

            await agent.on_artifact_produced(artifact_id)

            return {
                "artifact_id": artifact_id,
                "content_hash": content_hash,
                "status": artifact_status,
                "output": output,
                "is_grounded": is_grounded,
            }

        except Exception as exc:
            logger.exception(
                "Task execution failed",
                extra={"task_id": task_id, "agent": agent.node_id},
            )
            await self._emit_cognitive_event(
                task_id=task_id,
                initiator_node_id=initiator_node_id,
                status=CognitiveTaskStatus.FAILED,
                time_order=self._next_time_order(),
                error_detail=str(exc),
            )
            return None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _next_time_order(self) -> SpontaneousTimeOrder:
        self._local_sequence += 1
        return SpontaneousTimeOrder(
            local_sequence=self._local_sequence,
            node_id=self.kernel_id,
        )

    async def _emit_cognitive_event(
        self,
        task_id: str,
        initiator_node_id: str,
        status: CognitiveTaskStatus,
        time_order: SpontaneousTimeOrder,
        artifact_id: Optional[str] = None,
        poc_id: Optional[str] = None,
        error_detail: Optional[str] = None,
    ) -> None:
        event = CognitiveEvent(
            task_id=task_id,
            initiator_node_id=initiator_node_id,
            task_status=status,
            time_order=time_order,
            artifact_id=artifact_id,
            poc_id=poc_id,
            error_detail=error_detail,
        )
        if self._event_bus:
            await self._event_bus.publish(event)
        else:
            logger.debug("CognitiveEvent (no bus)", extra={"event": event.model_dump()})

    async def _emit_artifact_validation_event(
        self,
        artifact_id: str,
        producer_node_id: str,
        from_status: CanxianArtifactStatus,
        to_status: CanxianArtifactStatus,
        is_zombie_flagged: bool,
        time_order: SpontaneousTimeOrder,
    ) -> None:
        event = ArtifactValidationEvent(
            artifact_id=artifact_id,
            producer_node_id=producer_node_id,
            from_status=from_status,
            to_status=to_status,
            is_zombie_flagged=is_zombie_flagged,
            time_order=time_order,
        )
        if self._event_bus:
            await self._event_bus.publish(event)
        else:
            logger.debug(
                "ArtifactValidationEvent (no bus)", extra={"event": event.model_dump()}
            )
