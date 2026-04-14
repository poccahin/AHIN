"""
ReceiptProofService — produces and verifies ObjectificationReceipts.

An ObjectificationReceipt is proof of Life+ externalization:
  - Intelligence has been externalized into a durable action
  - The action is anchored to a physical device context
  - The receipt is tamper-evident via hash chain

This is the edge terminal's contribution to POC evidence.
"""
from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


class ReceiptProofService:
    """
    Creates and verifies ObjectificationReceipts at the edge.

    Each receipt is:
      1. Hashed deterministically from its content
      2. Chained to the terminal's local interaction sequence
      3. Verifiable without central server connectivity
    """

    @staticmethod
    def create_proof(
        receipt: Dict[str, Any],
        terminal_private_context: Optional[str] = None,
    ) -> str:
        """
        Compute the proof hash for an ObjectificationReceipt.

        The proof is a SHA-256 over the canonical JSON of the receipt,
        optionally salted with a terminal-private context (device key).
        """
        canonical = json.dumps(
            {k: v for k, v in receipt.items() if k != "receipt_hash"},
            sort_keys=True,
            default=str,
        )
        if terminal_private_context:
            canonical = f"{terminal_private_context}:{canonical}"
        return hashlib.sha256(canonical.encode()).hexdigest()

    @staticmethod
    def verify_proof(
        receipt: Dict[str, Any],
        terminal_private_context: Optional[str] = None,
    ) -> bool:
        """
        Verify the proof hash of an ObjectificationReceipt.

        Returns True if the receipt has not been tampered with.
        """
        expected = ReceiptProofService.create_proof(receipt, terminal_private_context)
        actual = receipt.get("receipt_hash", "")
        is_valid = expected == actual
        if not is_valid:
            logger.warning(
                "Receipt proof verification failed",
                extra={"receipt_id": receipt.get("receipt_id")},
            )
        return is_valid
