"""
LocalTimeSequencer — implements Spontaneous Time Order per AHIN node.

Time in AHIN is NOT a centralised clock.
It is the emergent ordering of interactions as experienced by each node.

The LocalTimeSequencer maintains a monotonically increasing local sequence
and chains each event to its predecessor hash, providing:
  - Locally verifiable ordering
  - No dependency on global timestamp authority
  - Tamper-evidence via hash chaining
"""
from __future__ import annotations

import threading
from typing import Optional

from packages.ahin_network.interaction_hasher import InteractionHasher
from packages.shared.domain import SpontaneousTimeOrder, now_utc


class LocalTimeSequencer:
    """
    Per-node Spontaneous Time Order generator.

    Thread-safe for concurrent agent execution.
    """

    def __init__(self, node_id: str) -> None:
        self._node_id = node_id
        self._sequence: int = 0
        self._last_hash: Optional[str] = None
        self._lock = threading.Lock()

    def next(
        self,
        interaction_type: str = "internal",
        initiator_node_id: Optional[str] = None,
        responder_node_id: Optional[str] = None,
        payload: Optional[dict] = None,
    ) -> SpontaneousTimeOrder:
        """
        Produce the next SpontaneousTimeOrder and advance the local sequence.

        Each call chains the new event to the predecessor hash.
        """
        with self._lock:
            self._sequence += 1
            new_hash = InteractionHasher.hash_interaction(
                predecessor_hash=self._last_hash,
                initiator_node_id=initiator_node_id or self._node_id,
                responder_node_id=responder_node_id,
                interaction_type=interaction_type,
                payload=payload or {},
            )
            self._last_hash = new_hash
            return SpontaneousTimeOrder(
                wall_clock_utc=now_utc(),
                local_sequence=self._sequence,
                node_id=self._node_id,
                interaction_hash=new_hash,
            )

    @property
    def current_sequence(self) -> int:
        return self._sequence

    @property
    def last_hash(self) -> Optional[str]:
        return self._last_hash
