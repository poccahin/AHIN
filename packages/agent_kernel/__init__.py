"""
packages/agent_kernel — Life++ Agent OS Kernel Layer.

The kernel is the cognitive execution supervisor for all agents.
It is NOT a generic task runner.  It is a policy-enforced, trust-aware,
auditable execution fabric for cognitive-economic actors.

Responsibilities:
  - Agent identity and admission to AHIN
  - Capability registration and lookup
  - CognitiveTask scheduling and lifecycle management
  - Policy enforcement (including anti-zombie heuristics)
  - Auditable state transitions via CognitiveEvent emission
"""
from packages.agent_kernel.base_agent import BaseAgent
from packages.agent_kernel.agent_kernel import AgentKernel
from packages.agent_kernel.execution_supervisor import ExecutionSupervisor

__all__ = ["BaseAgent", "AgentKernel", "ExecutionSupervisor"]
