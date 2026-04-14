"""
CognitiveValueFlowSystem — facade over all value flow sub-components.

This is the unified interface for all LIFE++ cognitive-economic operations:
  - Price lookup (PriceOracle)
  - Admission validation (AdmissionGate)
  - Collaboration cost computation (CollaborationCostEngine)
  - Merchant payment flow (MerchantSettlementService)
  - Treasury management (TreasuryService)
  - Anti-spam policy (PolicyEngine integration)

Usage:
  cvfs = CognitiveValueFlowSystem()
  cost = cvfs.compute_collaboration_cost()
  admission = cvfs.evaluate_admission(node_id, stake)
  payment = cvfs.create_merchant_payment(...)
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from packages.value_flow.admission_gate import AdmissionGate, AdmissionResult
from packages.value_flow.collaboration_cost_engine import CollaborationCostEngine
from packages.value_flow.merchant_settlement_service import (
    MerchantPaymentRequest,
    MerchantSettlementRecord,
    MerchantSettlementService,
)
from packages.value_flow.price_oracle import PriceOracle
from packages.value_flow.treasury_service import TreasuryService

logger = logging.getLogger(__name__)


class CognitiveValueFlowSystem:
    """
    Unified facade for the LIFE++ cognitive value flow system.

    Combines all value-related operations under a single coordinated
    interface with consistent price referencing and audit logging.
    """

    def __init__(
        self,
        price_oracle: Optional[PriceOracle] = None,
        admission_gate: Optional[AdmissionGate] = None,
        cost_engine: Optional[CollaborationCostEngine] = None,
        merchant_service: Optional[MerchantSettlementService] = None,
        treasury_service: Optional[TreasuryService] = None,
    ) -> None:
        self.price_oracle = price_oracle or PriceOracle()
        self.admission_gate = admission_gate or AdmissionGate()
        self.cost_engine = cost_engine or CollaborationCostEngine()
        self.merchant_service = merchant_service or MerchantSettlementService()
        self.treasury_service = treasury_service or TreasuryService()

    # ------------------------------------------------------------------
    # Price operations
    # ------------------------------------------------------------------

    @property
    def current_price(self) -> float:
        """Current LIFE++ / USDT price."""
        return self.price_oracle.lifepp_usdt_price

    def lifepp_to_usdt(self, amount_lifepp: float) -> float:
        """Convert LIFE++ to USDT equivalent."""
        return self.price_oracle.lifepp_to_usdt(amount_lifepp)

    def usdt_to_lifepp(self, amount_usdt: float) -> float:
        """Convert USDT to LIFE++ equivalent."""
        return self.price_oracle.usdt_to_lifepp(amount_usdt)

    # ------------------------------------------------------------------
    # Admission
    # ------------------------------------------------------------------

    def evaluate_admission(
        self,
        node_id: str,
        stake_lifepp: float,
        is_already_admitted: bool = False,
        is_blocked: bool = False,
    ) -> AdmissionResult:
        """Evaluate AHIN admission eligibility."""
        return self.admission_gate.evaluate(
            node_id=node_id,
            stake_lifepp=stake_lifepp,
            lifepp_usdt_price=self.price_oracle.lifepp_usdt_price,
            is_already_admitted=is_already_admitted,
            is_blocked=is_blocked,
        )

    # ------------------------------------------------------------------
    # Collaboration cost
    # ------------------------------------------------------------------

    def compute_collaboration_cost(self) -> float:
        """Compute micro-usage cost for one collaboration interaction."""
        return self.cost_engine.compute_cost(
            self.price_oracle.lifepp_usdt_price
        )

    def record_collaboration_cost(
        self, task_id: str, node_id: str, cost_lifepp: float
    ) -> None:
        """Record a collaboration cost for tracking."""
        self.cost_engine.record_cost(task_id, node_id, cost_lifepp)

    # ------------------------------------------------------------------
    # Merchant payment
    # ------------------------------------------------------------------

    def create_merchant_payment(
        self,
        merchant_node_id: str,
        payer_node_id: str,
        amount_lifepp: float,
        amount_fiat: Optional[float] = None,
        fiat_currency: Optional[str] = None,
        description: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> MerchantPaymentRequest:
        """Create a merchant payment request."""
        return self.merchant_service.create_payment(
            merchant_node_id=merchant_node_id,
            payer_node_id=payer_node_id,
            amount_lifepp=amount_lifepp,
            amount_fiat=amount_fiat,
            fiat_currency=fiat_currency,
            description=description,
            metadata=metadata,
        )

    def authorise_merchant_payment(
        self, request_id: str, payer_balance: float
    ) -> bool:
        """Authorise a merchant payment against payer balance."""
        return self.merchant_service.authorise_payment(
            request_id, payer_balance
        )

    def capture_merchant_payment(
        self, request_id: str
    ) -> Optional[MerchantSettlementRecord]:
        """Capture an authorised merchant payment."""
        return self.merchant_service.capture_payment(request_id)

    def batch_merchant_settlements(self) -> Dict[str, Any]:
        """Create a settlement batch from completed merchant payments."""
        return self.merchant_service.batch_settlements()

    # ------------------------------------------------------------------
    # Treasury
    # ------------------------------------------------------------------

    def compute_treasury_amount(self, pool_lifepp: float) -> float:
        """Compute treasury allocation from a settlement pool."""
        return self.treasury_service.compute_treasury_amount(pool_lifepp)

    def record_treasury_allocation(
        self, batch_id: str, amount_lifepp: float
    ) -> Dict:
        """Record a treasury allocation."""
        return self.treasury_service.record_allocation(
            batch_id, amount_lifepp
        )
