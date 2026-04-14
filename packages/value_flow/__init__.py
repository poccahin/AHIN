"""
packages/value_flow — LIFE++ Cognitive Value Flow System.

This is NOT a generic payment system.
It is a cognitive-economic accounting and settlement architecture for:
  - Validating meaningful contribution
  - Pricing collaboration
  - Anchoring participation in AHIN
  - Supporting Proof of Cognitive Canxian
  - Structurally aligning Virtue and Well-being

Sub-components:
  - PriceOracle: LIFE++ / USDT price feed
  - AdmissionGate: AHIN participation eligibility
  - CollaborationCostEngine: micro-usage cost computation
  - MerchantSettlementService: merchant payment loop
  - TreasuryService: public goods treasury
  - CognitiveValueFlowSystem: unified facade
"""
from packages.value_flow.wallet_service import WalletService
from packages.value_flow.payment_intent_service import PaymentIntentService
from packages.value_flow.transfer_engine import TransferEngine
from packages.value_flow.price_oracle import PriceOracle
from packages.value_flow.admission_gate import AdmissionGate
from packages.value_flow.collaboration_cost_engine import CollaborationCostEngine
from packages.value_flow.merchant_settlement_service import MerchantSettlementService
from packages.value_flow.treasury_service import TreasuryService
from packages.value_flow.cognitive_value_flow_system import CognitiveValueFlowSystem

__all__ = [
    "WalletService",
    "PaymentIntentService",
    "TransferEngine",
    "PriceOracle",
    "AdmissionGate",
    "CollaborationCostEngine",
    "MerchantSettlementService",
    "TreasuryService",
    "CognitiveValueFlowSystem",
]
