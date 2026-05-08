use domain::{
    CandidateSizingConfig, FeatureSnapshot, OrderCandidateDecision, OrderCandidateReason,
    RiskBudgetDecision, SignalDecision, SignalGrade,
};
use rust_decimal::Decimal;

use crate::{dry_run_candidate, order_candidate};

const MIN_CANDIDATE_SIGNAL_STRENGTH: i64 = 85;
const MIN_EDGE_AFTER_COST_RATIO: i64 = 3;

pub fn evaluate_order_candidate(
    feature_snapshot: &FeatureSnapshot,
    signal_decision: SignalDecision,
    risk_decision: RiskBudgetDecision,
    sizing_config: CandidateSizingConfig,
) -> OrderCandidateDecision {
    let mut reasons = order_candidate::base_rejection_reasons(&signal_decision, &risk_decision);
    add_quality_gate_reasons(feature_snapshot, &signal_decision, &mut reasons);

    if has_candidate_blocking_reason(&reasons) {
        return OrderCandidateDecision {
            candidate_generated: false,
            candidate: None,
            reasons,
            signal_decision,
            risk_decision,
            sizing_config,
            summary: "dry-run candidate rejected by signal or risk gates".to_string(),
        };
    }

    let candidate = dry_run_candidate::build_dry_run_candidate(
        feature_snapshot,
        &signal_decision,
        &risk_decision,
        &sizing_config,
    );
    for reason in &candidate.reasons {
        order_candidate::push_reason(&mut reasons, *reason);
    }

    if !candidate.invariant_safe() {
        return OrderCandidateDecision {
            candidate_generated: false,
            candidate: None,
            reasons,
            signal_decision,
            risk_decision,
            sizing_config,
            summary: "dry-run candidate rejected because audit-only invariants failed".to_string(),
        };
    }

    OrderCandidateDecision {
        candidate_generated: true,
        candidate: Some(candidate),
        reasons,
        signal_decision,
        risk_decision,
        sizing_config,
        summary: "audit-only dry-run order candidate generated; no executable order exists"
            .to_string(),
    }
}

pub fn edge_after_cost_ratio(
    feature_snapshot: &FeatureSnapshot,
    signal_decision: &SignalDecision,
) -> Decimal {
    let cost_bps = feature_snapshot.cost.estimated_total_cost_bps;
    if cost_bps <= Decimal::ZERO {
        return Decimal::from(100);
    }
    signal_decision.packet.final_strength / cost_bps
}

fn add_quality_gate_reasons(
    feature_snapshot: &FeatureSnapshot,
    signal_decision: &SignalDecision,
    reasons: &mut Vec<OrderCandidateReason>,
) {
    if signal_decision.packet.grade != SignalGrade::APlus {
        order_candidate::push_reason(reasons, OrderCandidateReason::SignalGradeTooLow);
    }
    if signal_decision.packet.final_strength < Decimal::from(MIN_CANDIDATE_SIGNAL_STRENGTH) {
        order_candidate::push_reason(reasons, OrderCandidateReason::SignalStrengthTooLow);
    }
    if edge_after_cost_ratio(feature_snapshot, signal_decision)
        < Decimal::from(MIN_EDGE_AFTER_COST_RATIO)
    {
        order_candidate::push_reason(reasons, OrderCandidateReason::EdgeAfterCostTooLow);
    }
}

fn has_candidate_blocking_reason(reasons: &[OrderCandidateReason]) -> bool {
    reasons.iter().any(|reason| {
        matches!(
            reason,
            OrderCandidateReason::SignalRejected
                | OrderCandidateReason::RiskRejected
                | OrderCandidateReason::SignalGradeTooLow
                | OrderCandidateReason::SignalStrengthTooLow
                | OrderCandidateReason::EdgeAfterCostTooLow
                | OrderCandidateReason::DegradedMarketData
                | OrderCandidateReason::YiGateRejected
        )
    })
}

#[allow(dead_code)]
fn _keep_reason_visible(_: OrderCandidateReason) {}

#[cfg(test)]
mod tests {
    use domain::{
        AccountRiskState, CandidateSizingConfig, CostEstimate, DecisionReason, FeatureSnapshot,
        FundingRegime, LiquidityMetrics, MarketRegime, Price, Quantity, RiskBudgetConfig,
        RiskBudgetDecision, RiskDecisionReason, SignalDecision, SignalDirection, SignalGrade,
        SignalPacket, Symbol,
    };
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn rejected_signal_produces_no_candidate() {
        let signal = signal_decision(false, dec!(30));
        let risk = risk_decision(true, signal.clone(), dec!(0));

        let decision =
            evaluate_order_candidate(&snapshot(), signal, risk, CandidateSizingConfig::default());

        assert!(!decision.candidate_generated);
        assert!(decision.candidate.is_none());
        assert!(
            decision
                .reasons
                .contains(&OrderCandidateReason::SignalRejected)
        );
    }

    #[test]
    fn rejected_risk_produces_no_candidate() {
        let signal = signal_decision(true, dec!(92));
        let risk = risk_decision(false, signal.clone(), dec!(0));

        let decision =
            evaluate_order_candidate(&snapshot(), signal, risk, CandidateSizingConfig::default());

        assert!(!decision.candidate_generated);
        assert!(decision.candidate.is_none());
        assert!(
            decision
                .reasons
                .contains(&OrderCandidateReason::RiskRejected)
        );
    }

    #[test]
    fn c_grade_signal_produces_no_candidate() {
        let signal = signal_decision_with_grade(true, dec!(62), SignalGrade::C);
        let risk = risk_decision(true, signal.clone(), dec!(0));

        let decision =
            evaluate_order_candidate(&snapshot(), signal, risk, CandidateSizingConfig::default());

        assert!(!decision.candidate_generated);
        assert!(decision.candidate.is_none());
        assert!(
            decision
                .reasons
                .contains(&OrderCandidateReason::SignalGradeTooLow)
        );
        assert!(
            decision
                .reasons
                .contains(&OrderCandidateReason::SignalStrengthTooLow)
        );
    }

    #[test]
    fn final_strength_below_threshold_produces_no_candidate() {
        let signal = signal_decision(true, dec!(84.99));
        let risk = risk_decision(true, signal.clone(), dec!(0));

        let decision =
            evaluate_order_candidate(&snapshot(), signal, risk, CandidateSizingConfig::default());

        assert!(!decision.candidate_generated);
        assert!(decision.candidate.is_none());
        assert!(
            decision
                .reasons
                .contains(&OrderCandidateReason::SignalStrengthTooLow)
        );
    }

    #[test]
    fn low_edge_after_cost_ratio_produces_no_candidate() {
        let signal = signal_decision(true, dec!(92));
        let risk = risk_decision(true, signal.clone(), dec!(0));

        let decision = evaluate_order_candidate(
            &snapshot_with_total_cost(dec!(40)),
            signal,
            risk,
            CandidateSizingConfig::default(),
        );

        assert!(!decision.candidate_generated);
        assert!(decision.candidate.is_none());
        assert!(
            decision
                .reasons
                .contains(&OrderCandidateReason::EdgeAfterCostTooLow)
        );
    }

    #[test]
    fn a_plus_signal_and_passing_risk_produces_audit_only_candidate() {
        let signal = signal_decision(true, dec!(92));
        let risk = risk_decision(true, signal.clone(), dec!(0));

        let decision =
            evaluate_order_candidate(&snapshot(), signal, risk, CandidateSizingConfig::default());
        let candidate = decision.candidate.as_ref().unwrap();

        assert!(decision.candidate_generated);
        assert!(candidate.audit_only);
        assert!(candidate.invariant_safe());
        assert!(
            candidate
                .reasons
                .contains(&OrderCandidateReason::DryRunOnly)
        );
        assert!(
            candidate
                .reasons
                .contains(&OrderCandidateReason::NoExecutableOrderGenerated)
        );
    }

    #[test]
    fn real_order_id_is_always_none_and_executable_is_false() {
        let signal = signal_decision(true, dec!(92));
        let risk = risk_decision(true, signal.clone(), dec!(0));

        let decision =
            evaluate_order_candidate(&snapshot(), signal, risk, CandidateSizingConfig::default());
        let candidate = decision.candidate.unwrap();

        assert!(candidate.real_order_id.is_none());
        assert!(!candidate.executable);
    }

    #[test]
    fn no_live_order_method_is_called_because_decision_uses_no_adapter() {
        let signal = signal_decision(true, dec!(92));
        let risk = risk_decision(true, signal.clone(), dec!(0));

        let decision =
            evaluate_order_candidate(&snapshot(), signal, risk, CandidateSizingConfig::default());

        assert!(decision.candidate_generated);
    }

    fn snapshot() -> FeatureSnapshot {
        snapshot_with_total_cost(dec!(10))
    }

    fn snapshot_with_total_cost(total_cost_bps: rust_decimal::Decimal) -> FeatureSnapshot {
        FeatureSnapshot {
            exchange: "test".to_string(),
            symbol: Symbol::new("BTCUSDT").unwrap(),
            mark_price: Price::new(dec!(100)).unwrap(),
            index_price: Price::new(dec!(100)).unwrap(),
            premium: dec!(0),
            premium_bps: dec!(0),
            funding_rate: dec!(0.0002),
            funding_regime: FundingRegime::Positive,
            open_interest: Quantity::new(dec!(1000)).unwrap(),
            liquidity: LiquidityMetrics {
                spread_bps: dec!(2),
                bid_depth_5bps: dec!(10000),
                ask_depth_5bps: dec!(10000),
                bid_depth_10bps: dec!(20000),
                ask_depth_10bps: dec!(20000),
                imbalance: dec!(0),
                liquidity_score: dec!(1),
            },
            cost: CostEstimate {
                round_trip_fee_bps: dec!(8),
                spread_bps: dec!(2),
                slippage_bps: dec!(0),
                estimated_total_cost_bps: total_cost_bps,
            },
        }
    }

    fn signal_decision(signal_allowed: bool, strength: rust_decimal::Decimal) -> SignalDecision {
        signal_decision_with_grade(signal_allowed, strength, SignalGrade::APlus)
    }

    fn signal_decision_with_grade(
        signal_allowed: bool,
        strength: rust_decimal::Decimal,
        grade: SignalGrade,
    ) -> SignalDecision {
        SignalDecision {
            packet: SignalPacket {
                exchange: "test".to_string(),
                symbol: Symbol::new("BTCUSDT").unwrap(),
                direction: SignalDirection::Long,
                market_regime: MarketRegime::PositivePremium,
                price_structure_score: strength,
                derivatives_score: strength,
                funding_score: strength,
                liquidity_score: strength,
                cost_score: strength,
                final_strength: strength,
                grade,
                reasons: Vec::new(),
            },
            signal_allowed,
            trade_allowed: false,
            reasons: vec![DecisionReason::ResearchOnlyMode],
            summary: "test signal".to_string(),
        }
    }

    fn risk_decision(
        risk_allowed: bool,
        signal_decision: SignalDecision,
        gross_notional: rust_decimal::Decimal,
    ) -> RiskBudgetDecision {
        RiskBudgetDecision {
            symbol: Symbol::new("BTCUSDT").unwrap(),
            risk_allowed,
            executable_trading_allowed: false,
            risk_budget_usdt: if risk_allowed { dec!(0.8) } else { dec!(0) },
            effective_one_r_usdt: dec!(0.8),
            max_loss_per_signal_usdt: dec!(1),
            account: AccountRiskState {
                exposure: domain::ExposureState {
                    gross_notional,
                    liquidation_buffer_bps: None,
                },
                ..Default::default()
            },
            config: RiskBudgetConfig::default(),
            reasons: vec![
                RiskDecisionReason::ResearchOnlyMode,
                RiskDecisionReason::NoExecutableOrderGenerated,
            ],
            signal_decision,
            summary: "test risk".to_string(),
        }
    }
}
