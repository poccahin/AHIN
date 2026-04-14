"""
packages/cognitive_memory — Persistent memory for cognitive agents.

Cognitive memory stores the episodic and semantic knowledge of each agent.
It is the substrate for Life+ Objectification:
  intelligence externalised into persistent, queryable structures.

TODO: implement vector store integration (Qdrant/Weaviate) for semantic search.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class CognitiveMemoryStore:
    """
    Episodic and semantic memory for a cognitive agent.

    In MVP: in-memory dict.
    In production: vector database (Qdrant) for semantic retrieval.

    TODO: integrate Qdrant / Weaviate for semantic search
    TODO: implement memory decay and consolidation
    """

    def __init__(self, node_id: str) -> None:
        self._node_id = node_id
        self._episodic: List[Dict[str, Any]] = []  # ordered interaction history
        self._semantic: Dict[str, Any] = {}        # key-value concept store

    def remember(self, key: str, value: Any) -> None:
        """Store a semantic memory."""
        self._semantic[key] = value

    def recall(self, key: str) -> Optional[Any]:
        """Retrieve a semantic memory."""
        return self._semantic.get(key)

    def record_episode(self, episode: Dict[str, Any]) -> None:
        """Append an episodic interaction record."""
        self._episodic.append(episode)

    def recent_episodes(self, n: int = 10) -> List[Dict[str, Any]]:
        """Return the n most recent episodic memories."""
        return self._episodic[-n:]

    def summarise(self) -> Dict[str, Any]:
        """Return a summary of this agent's memory state."""
        return {
            "node_id": self._node_id,
            "semantic_keys": list(self._semantic.keys()),
            "episode_count": len(self._episodic),
        }
