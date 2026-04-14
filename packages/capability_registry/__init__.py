"""
CapabilityRegistry — maps capabilities to capable agents.

Capabilities are NOT generic job types.
They represent the cognitive competencies of agents in the AHIN ecosystem.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)


class CapabilityRegistry:
    """
    Runtime registry of agent capabilities.

    Enables the AgentKernel to route CognitiveTasks to the right agents
    based on declared cognitive competencies.
    """

    def __init__(self) -> None:
        # {capability: [agent]}
        self._registry: Dict[str, List[Any]] = {}
        # {node_id: Set[capability]}
        self._node_capabilities: Dict[str, Set[str]] = {}

    def register(self, agent: Any) -> None:
        """Register an agent's capabilities."""
        node_id = agent.node_id
        capabilities = agent.get_capabilities()
        self._node_capabilities[node_id] = set(capabilities)

        for cap in capabilities:
            self._registry.setdefault(cap, [])
            if not any(a.node_id == node_id for a in self._registry[cap]):
                self._registry[cap].append(agent)

        logger.info(
            "Agent registered in CapabilityRegistry",
            extra={"node_id": node_id, "capabilities": capabilities},
        )

    def deregister(self, node_id: str) -> None:
        """Remove an agent from the registry."""
        caps = self._node_capabilities.pop(node_id, set())
        for cap in caps:
            self._registry[cap] = [
                a for a in self._registry.get(cap, []) if a.node_id != node_id
            ]
        logger.info("Agent deregistered", extra={"node_id": node_id})

    def find(self, capability: str) -> List[Any]:
        """Return all agents capable of handling a given capability."""
        return self._registry.get(capability, [])

    def all_capabilities(self) -> List[str]:
        """Return all registered capability identifiers."""
        return list(self._registry.keys())

    def get_node_capabilities(self, node_id: str) -> Set[str]:
        """Return the capabilities of a specific agent."""
        return self._node_capabilities.get(node_id, set())
