"""
packages/value_flow — LIFE++ Cognitive Value Flow System.

This is NOT a generic payment system.
It is a cognitive-economic accounting and settlement architecture for:
  - Validating meaningful contribution
  - Pricing collaboration
  - Anchoring participation in AHIN
  - Supporting Proof of Cognitive Canxian
  - Structurally aligning Virtue and Well-being
"""
from packages.value_flow.wallet_service import WalletService
from packages.value_flow.payment_intent_service import PaymentIntentService
from packages.value_flow.transfer_engine import TransferEngine

__all__ = ["WalletService", "PaymentIntentService", "TransferEngine"]
