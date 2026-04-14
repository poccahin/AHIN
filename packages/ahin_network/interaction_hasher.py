"""
InteractionHasher — produces tamper-evident hashes of AHIN interactions.

Uses SHA-256 to chain interaction records, implementing the
Spontaneous Time Order without relying on a centralised timestamp authority.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, Optional


class InteractionHasher:
    """
    Produces and verifies interaction hashes for AHIN.

    Each interaction hash incorporates:
      - The predecessor hash (chain integrity)
      - The initiator and responder node IDs
      - The interaction type
      - The content hash of the payload

    This creates a locally-verifiable chain of events that establishes
    Spontaneous Time Order without global consensus.
    """

    ALGORITHM = "sha256"

    @staticmethod
    def hash_interaction(
        predecessor_hash: Optional[str],
        initiator_node_id: str,
        responder_node_id: Optional[str],
        interaction_type: str,
        payload: Dict[str, Any],
    ) -> str:
        """
        Compute a deterministic hash for one AHIN interaction.

        The predecessor_hash binds this interaction into the chain.
        A None predecessor_hash is the genesis interaction.
        """
        canonical = json.dumps(
            {
                "predecessor": predecessor_hash or "GENESIS",
                "initiator": initiator_node_id,
                "responder": responder_node_id or "BROADCAST",
                "type": interaction_type,
                "payload_hash": hashlib.sha256(
                    json.dumps(payload, sort_keys=True, default=str).encode()
                ).hexdigest(),
            },
            sort_keys=True,
        )
        return hashlib.sha256(canonical.encode()).hexdigest()

    @staticmethod
    def verify_chain(interactions: list[Dict[str, Any]]) -> bool:
        """
        Verify that a sequence of interactions forms a valid chain.

        Returns True if every interaction's hash correctly follows from
        its predecessor.
        """
        prev_hash: Optional[str] = None
        for record in interactions:
            expected = InteractionHasher.hash_interaction(
                predecessor_hash=prev_hash,
                initiator_node_id=record["initiator_node_id"],
                responder_node_id=record.get("responder_node_id"),
                interaction_type=record["interaction_type"],
                payload=record.get("payload", {}),
            )
            if record["interaction_hash"] != expected:
                return False
            prev_hash = record["interaction_hash"]
        return True
