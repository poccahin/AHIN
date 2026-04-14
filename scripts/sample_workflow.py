"""
Sample workflow: Cognitive collaboration between two AHIN nodes.

This demonstrates the full Life++ cognitive-economic cycle:
  1. Two agents register and stake LIFE++ for AHIN admission
  2. Agent A proposes a Proactive Association to Agent B
  3. Agent B accepts
  4. A CognitiveTask is submitted and executed
  5. The CanxianArtifact is validated via POC
  6. VirtueWellbeing settlement distributes LIFE++

Run with: python scripts/sample_workflow.py
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Sample concrete agent implementation
# ---------------------------------------------------------------------------

from packages.agent_kernel.base_agent import BaseAgent
from packages.ahin_network.ahin_node import AhinNode
from packages.ahin_network.association_graph import AssociationGraph
from packages.ahin_network.trust_weight_model import TrustWeightModel
from packages.event_bus.event_bus import EventBus
from packages.shared.domain import NodeType


class CausalReasoningAgent(BaseAgent):
    """
    A sample agent that demonstrates causation re-engineering.

    This agent explicitly constructs causal chains in its output,
    distinguishing it from a philosophical-zombie LLM wrapper.
    """

    async def execute_cognitive_task(
        self, task_id: str, input_payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        query = input_payload.get("query", "")
        context = input_payload.get("context", {})

        # Simulate causal reasoning (NOT pure statistical inference)
        causal_chain = [
            f"Observation: {query}",
            f"Context grounding: {list(context.keys())}",
            "Causal inference: derived from observed context, not priors",
            "Conclusion: action-relevant output grounded in input",
        ]

        return {
            "query": query,
            "causal_chain": causal_chain,
            "answer": f"Causally grounded response to: {query}",
            "context_references": list(context.keys()),
            "novelty_score": 0.7,
        }

    def get_capabilities(self) -> List[str]:
        return ["causal_reasoning", "knowledge_synthesis"]

    async def verify_causation(
        self, input_payload: Dict[str, Any], output: Dict[str, Any]
    ) -> bool:
        """
        Verify that the output is causally grounded.

        A valid causal output:
          - Has a non-empty causal_chain
          - References input context
          - Is not merely a high-confidence statistical guess
        """
        causal_chain = output.get("causal_chain", [])
        context_refs = output.get("context_references", [])
        return len(causal_chain) >= 2 and len(context_refs) > 0


# ---------------------------------------------------------------------------
# Workflow
# ---------------------------------------------------------------------------

async def main() -> None:
    logger.info("=== Life++ Cognitive Collaboration Workflow ===\n")

    # 1. Create event bus
    bus = EventBus()

    # 2. Create agents
    agent_a = CausalReasoningAgent(
        node_id="agent-alpha",
        node_type=NodeType.DIGITAL_AVATAR,
        display_name="Alpha (Proactive)",
    )
    agent_b = CausalReasoningAgent(
        node_id="agent-beta",
        node_type=NodeType.MACHINE_AGENT,
        display_name="Beta (Responder)",
    )

    # 3. AHIN nodes
    node_a = AhinNode(node_id=agent_a.node_id, node_type=NodeType.DIGITAL_AVATAR)
    node_b = AhinNode(node_id=agent_b.node_id, node_type=NodeType.MACHINE_AGENT)

    # Simulate AHIN admission (stake check passed)
    node_a.set_admitted(stake_lifepp=1000.0)  # > 10 USDT equivalent
    node_b.set_admitted(stake_lifepp=1000.0)

    # 4. Build association graph
    trust_model = TrustWeightModel()
    graph = AssociationGraph(trust_model=trust_model)

    # 5. Proactive Association: A → B
    logger.info("Step 1: Agent A proposes Proactive Association to Agent B")
    proactive = node_a.propose_association(
        responder_node_id=node_b.node_id,
        task_id="task-001",
        payload={"intent": "collaborative causal reasoning on climate data"},
    )
    graph.record_event(proactive)
    logger.info(
        f"  Proactive event: {proactive.event_id}, hash: {proactive.interaction_hash[:16]}..."
    )

    # 6. Acceptance: B → A
    logger.info("Step 2: Agent B accepts the association")
    acceptance = node_b.accept_association(proactive_event=proactive)
    graph.record_event(acceptance)
    logger.info(
        f"  Acceptance event: {acceptance.event_id}, hash: {acceptance.interaction_hash[:16]}..."
    )

    # 7. Trust state
    trust_a_to_b = graph.get_trust_weight(agent_a.node_id, agent_b.node_id)
    trust_b_to_a = graph.get_trust_weight(agent_b.node_id, agent_a.node_id)
    logger.info(f"\nTrust weights (after association):")
    logger.info(f"  A→B: {trust_a_to_b:.4f}")
    logger.info(f"  B→A: {trust_b_to_a:.4f}")

    # 8. Execute CognitiveTask via AgentKernel
    logger.info("\nStep 3: Submit and execute CognitiveTask")
    from packages.agent_kernel.agent_kernel import AgentKernel
    from packages.agent_kernel.execution_supervisor import ExecutionSupervisor

    kernel = AgentKernel(event_bus=bus)
    kernel.register_agent(agent_a)
    kernel.register_agent(agent_b)

    supervisor = ExecutionSupervisor(kernel=kernel)
    result = await supervisor.submit(
        idempotency_key="workflow-demo-001",
        capability="causal_reasoning",
        input_payload={
            "query": "What causes CO2 rise in urban areas?",
            "context": {
                "location": "Shanghai",
                "data_sources": ["traffic_sensor", "factory_emissions"],
                "time_range": "2024-Q1",
            },
        },
        initiator_node_id=agent_a.node_id,
    )

    if result:
        logger.info(f"\nCognitiveTask result:")
        logger.info(f"  artifact_id: {result['artifact_id']}")
        logger.info(f"  status: {result['status']}")
        logger.info(f"  is_grounded: {result['is_grounded']}")
        logger.info(f"  causal_chain: {result['output'].get('causal_chain', [])}")
    else:
        logger.error("Task execution failed")

    # 9. VirtueWellbeing distribution simulation
    logger.info("\nStep 4: VirtueWellbeing settlement simulation")
    from packages.settlement.virtue_wellbeing_distributor import VirtueWellbeingDistributor

    distributor = VirtueWellbeingDistributor(treasury_fraction=0.05)
    contribution_credits = {
        agent_a.node_id: 0.8,  # high cognitive contribution
        agent_b.node_id: 0.6,  # solid contribution
    }
    distributions, treasury = distributor.compute_distribution(
        contribution_credits, total_pool_lifepp=100.0
    )

    logger.info(f"\nDistributions from 100 LIFEPP pool:")
    for node_id, amount in distributions.items():
        name = "Alpha" if node_id == agent_a.node_id else "Beta"
        logger.info(f"  {name}: {amount:.4f} LIFEPP")
    logger.info(f"  Treasury: {treasury:.4f} LIFEPP")

    # 10. Event replay
    logger.info(f"\nEvent bus replay log: {bus.replay_log_size} events recorded")

    logger.info("\n=== Workflow complete ===")


if __name__ == "__main__":
    asyncio.run(main())
