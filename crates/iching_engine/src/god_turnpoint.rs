use domain::{
    FeatureSnapshot, FeatureWindow, GodTurnpointConfig, GodTurnpointDecision, GodTurnpointWarning,
    RiskBudgetDecision, SignalDecision, YiReason,
};
use rust_decimal::Decimal;

use crate::{explanation, yi_gate, yi_state};

pub fn evaluate_god_turnpoint(
    snapshot: &FeatureSnapshot,
    signal_decision: SignalDecision,
    risk_decision: RiskBudgetDecision,
    window: &FeatureWindow,
    data_freshness_score: Decimal,
    degraded_market_data: bool,
    config: GodTurnpointConfig,
) -> GodTurnpointDecision {
    let edge_after_cost_ratio = edge_after_cost_ratio(snapshot, &signal_decision);
    let (hexagram, evidence) = yi_state::evaluate_yi_state(
        snapshot,
        &signal_decision,
        &risk_decision,
        window,
        data_freshness_score,
        degraded_market_data,
        &config,
    );
    let blockers = yi_gate::blockers(
        &signal_decision,
        &risk_decision,
        &hexagram,
        edge_after_cost_ratio,
        data_freshness_score,
        degraded_market_data,
        &config,
    );
    let mut reasons = hexagram.reasons.clone();
    for reason in yi_gate::reasons_from_blockers(&blockers) {
        push_reason(&mut reasons, reason);
    }
    if blockers.is_empty() {
        push_reason(&mut reasons, YiReason::EdgeAfterCostStrong);
        push_reason(&mut reasons, YiReason::RiskBudgetAllowed);
    }
    let warnings = warnings(degraded_market_data);
    let god_turnpoint_allowed = blockers.is_empty();

    let mut decision = GodTurnpointDecision {
        symbol: snapshot.symbol.clone(),
        god_turnpoint_allowed,
        yi_state: hexagram.yi_state,
        action_bias: hexagram.action_bias,
        hexagram,
        turnpoint_evidence: evidence,
        edge_after_cost_ratio,
        data_freshness_score,
        degraded_market_data,
        blockers,
        warnings,
        reasons,
        explanation: String::new(),
        signal_decision,
        risk_decision,
    };
    decision.explanation = explanation::god_turnpoint_explanation(&decision);
    decision
}

pub fn edge_after_cost_ratio(
    snapshot: &FeatureSnapshot,
    signal_decision: &SignalDecision,
) -> Decimal {
    let cost_bps = snapshot.cost.estimated_total_cost_bps;
    if cost_bps <= Decimal::ZERO {
        return Decimal::from(100);
    }
    signal_decision.packet.final_strength / cost_bps
}

fn warnings(degraded_market_data: bool) -> Vec<GodTurnpointWarning> {
    let mut warnings = Vec::new();
    if degraded_market_data {
        warnings.push(GodTurnpointWarning {
            code: "degraded_market_data_explanation_only".to_string(),
            message: "Yi evaluation ran for explanation, but degraded data blocks god turnpoint"
                .to_string(),
        });
    }
    warnings
}

fn push_reason(reasons: &mut Vec<YiReason>, reason: YiReason) {
    if !reasons.contains(&reason) {
        reasons.push(reason);
    }
}

#[cfg(test)]
mod tests {
    use domain::{
        AccountRiskState, CostEstimate, DecisionReason, ExposureState, FeatureSnapshot,
        FundingRegime, LiquidityMetrics, MarketRegime, Price, Quantity, RiskBudgetConfig,
        RiskBudgetDecision, RiskDecisionReason, SignalDecision, SignalDirection, SignalGrade,
        SignalPacket, Symbol, YiActionBias, YiState,
    };
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn c_grade_signal_observes_and_blocks_god_signal() {
        let snapshot = snapshot(
            dec!(100),
            dec!(0),
            dec!(0),
            FundingRegime::Neutral,
            dec!(0.8),
            dec!(20),
        );
        let signal = signal(SignalGrade::C, dec!(62), SignalDirection::Neutral, false);
        let risk = risk(false, signal.clone());
        let decision = evaluate(&snapshot, signal, risk, false);

        assert!(!decision.god_turnpoint_allowed);
        assert_eq!(decision.action_bias, YiActionBias::Observe);
        assert!(has_blocker(&decision, "signal_grade_not_a_plus"));
    }

    #[test]
    fn final_strength_below_threshold_blocks_god_turnpoint() {
        let snapshot = snapshot(
            dec!(100),
            dec!(60),
            dec!(0.0002),
            FundingRegime::Positive,
            dec!(0.9),
            dec!(20),
        );
        let signal = signal(SignalGrade::APlus, dec!(84), SignalDirection::Long, true);
        let risk = risk(true, signal.clone());
        let decision = evaluate(&snapshot, signal, risk, false);

        assert!(!decision.god_turnpoint_allowed);
        assert!(has_blocker(&decision, "signal_strength_too_low"));
    }

    #[test]
    fn edge_after_cost_below_threshold_blocks_god_turnpoint() {
        let snapshot = snapshot(
            dec!(100),
            dec!(60),
            dec!(0.0002),
            FundingRegime::Positive,
            dec!(0.9),
            dec!(40),
        );
        let signal = signal(SignalGrade::APlus, dec!(90), SignalDirection::Long, true);
        let risk = risk(true, signal.clone());
        let decision = evaluate(&snapshot, signal, risk, false);

        assert!(!decision.god_turnpoint_allowed);
        assert!(has_blocker(&decision, "edge_after_cost_too_low"));
    }

    #[test]
    fn a_plus_edge_risk_and_probe_can_allow_god_turnpoint_internally() {
        let snapshot = snapshot(
            dec!(100),
            dec!(60),
            dec!(0.0002),
            FundingRegime::Positive,
            dec!(0.9),
            dec!(20),
        );
        let signal = signal(SignalGrade::APlus, dec!(90), SignalDirection::Long, true);
        let risk = risk(true, signal.clone());
        let decision = evaluate(&snapshot, signal, risk, false);

        assert!(decision.god_turnpoint_allowed);
        assert!(matches!(
            decision.action_bias,
            YiActionBias::Probe | YiActionBias::Hold | YiActionBias::AddAllowed
        ));
        assert!(decision.edge_after_cost_ratio >= dec!(3));
    }

    #[test]
    fn degraded_market_data_blocks_god_turnpoint() {
        let snapshot = snapshot(
            dec!(100),
            dec!(60),
            dec!(0.0002),
            FundingRegime::Positive,
            dec!(0.9),
            dec!(20),
        );
        let signal = signal(SignalGrade::APlus, dec!(90), SignalDirection::Long, true);
        let risk = risk(true, signal.clone());
        let decision = evaluate(&snapshot, signal, risk, true);

        assert!(!decision.god_turnpoint_allowed);
        assert!(has_blocker(&decision, "degraded_market_data"));
        assert!(!decision.warnings.is_empty());
    }

    #[test]
    fn kan_risk_state_blocks_god_turnpoint() {
        let snapshot = snapshot(
            dec!(100),
            dec!(80),
            dec!(0.0008),
            FundingRegime::StronglyPositive,
            dec!(0.9),
            dec!(20),
        );
        let signal = signal(SignalGrade::APlus, dec!(90), SignalDirection::Long, true);
        let risk = risk(true, signal.clone());
        let decision = evaluate(&snapshot, signal, risk, false);

        assert!(!decision.god_turnpoint_allowed);
        assert_eq!(decision.yi_state, YiState::KanRisk);
        assert!(has_blocker(&decision, "yi_state_blocked"));
    }

    #[test]
    fn bo_collapse_state_blocks_god_turnpoint() {
        let first = snapshot(
            dec!(100),
            dec!(40),
            dec!(0.0001),
            FundingRegime::Positive,
            dec!(0.9),
            dec!(10),
        );
        let last = snapshot(
            dec!(95),
            dec!(20),
            dec!(0.0001),
            FundingRegime::Positive,
            dec!(0.5),
            dec!(30),
        );
        let signal = signal(SignalGrade::APlus, dec!(90), SignalDirection::Long, true);
        let risk = risk(true, signal.clone());
        let mut window = domain::FeatureWindow::new(4);
        window.push(first);
        window.push(last.clone());

        let decision = evaluate_god_turnpoint(
            &last,
            signal,
            risk,
            &window,
            dec!(1),
            false,
            GodTurnpointConfig::default(),
        );

        assert!(!decision.god_turnpoint_allowed);
        assert_eq!(decision.yi_state, YiState::BoCollapse);
        assert!(has_blocker(&decision, "yi_state_blocked"));
    }

    #[test]
    fn yi_gate_only_tightens_and_never_loosen_candidate_gate() {
        let snapshot = snapshot(
            dec!(100),
            dec!(0),
            dec!(0),
            FundingRegime::Neutral,
            dec!(0.8),
            dec!(20),
        );
        let signal = signal(SignalGrade::C, dec!(62), SignalDirection::Neutral, false);
        let risk = risk(false, signal.clone());
        let decision = evaluate(&snapshot, signal, risk, false);

        assert!(!decision.signal_decision.signal_allowed);
        assert!(!decision.risk_decision.risk_allowed);
        assert!(!decision.god_turnpoint_allowed);
    }

    #[test]
    fn current_neutral_style_signal_blocks_god_turnpoint() {
        let snapshot = snapshot(
            dec!(100),
            dec!(0),
            dec!(0),
            FundingRegime::Neutral,
            dec!(0.8),
            dec!(20),
        );
        let signal = signal(SignalGrade::C, dec!(50), SignalDirection::Neutral, false);
        let risk = risk(false, signal.clone());
        let decision = evaluate(&snapshot, signal, risk, false);

        assert!(!decision.god_turnpoint_allowed);
    }

    fn evaluate(
        snapshot: &FeatureSnapshot,
        signal: SignalDecision,
        risk: RiskBudgetDecision,
        degraded: bool,
    ) -> GodTurnpointDecision {
        let mut window = domain::FeatureWindow::new(4);
        window.push(snapshot.clone());
        evaluate_god_turnpoint(
            snapshot,
            signal,
            risk,
            &window,
            dec!(1),
            degraded,
            GodTurnpointConfig::default(),
        )
    }

    fn has_blocker(decision: &GodTurnpointDecision, code: &str) -> bool {
        decision.blockers.iter().any(|blocker| blocker.code == code)
    }

    fn signal(
        grade: SignalGrade,
        strength: rust_decimal::Decimal,
        direction: SignalDirection,
        allowed: bool,
    ) -> SignalDecision {
        SignalDecision {
            packet: SignalPacket {
                exchange: "test".to_string(),
                symbol: Symbol::new("BTCUSDT").unwrap(),
                direction,
                market_regime: MarketRegime::Neutral,
                price_structure_score: strength,
                derivatives_score: strength,
                funding_score: strength,
                liquidity_score: strength,
                cost_score: strength,
                final_strength: strength,
                grade,
                reasons: vec![DecisionReason::ResearchOnlyMode],
            },
            signal_allowed: allowed,
            trade_allowed: false,
            reasons: vec![DecisionReason::ResearchOnlyMode],
            summary: "test signal".to_string(),
        }
    }

    fn risk(allowed: bool, signal_decision: SignalDecision) -> RiskBudgetDecision {
        RiskBudgetDecision {
            symbol: Symbol::new("BTCUSDT").unwrap(),
            risk_allowed: allowed,
            executable_trading_allowed: false,
            risk_budget_usdt: if allowed { dec!(0.8) } else { dec!(0) },
            effective_one_r_usdt: dec!(0.8),
            max_loss_per_signal_usdt: dec!(1),
            account: AccountRiskState {
                exposure: ExposureState::default(),
                ..Default::default()
            },
            config: RiskBudgetConfig::default(),
            reasons: if allowed {
                vec![
                    RiskDecisionReason::ResearchOnlyMode,
                    RiskDecisionReason::NoExecutableOrderGenerated,
                    RiskDecisionReason::RiskChecksPassed,
                ]
            } else {
                vec![
                    RiskDecisionReason::SignalNotAllowed,
                    RiskDecisionReason::WeakSignal,
                    RiskDecisionReason::ResearchOnlyMode,
                    RiskDecisionReason::NoExecutableOrderGenerated,
                ]
            },
            signal_decision,
            summary: "test risk".to_string(),
        }
    }

    fn snapshot(
        mark: rust_decimal::Decimal,
        premium_bps: rust_decimal::Decimal,
        funding_rate: rust_decimal::Decimal,
        funding_regime: FundingRegime,
        liquidity_score: rust_decimal::Decimal,
        cost_bps: rust_decimal::Decimal,
    ) -> FeatureSnapshot {
        FeatureSnapshot {
            exchange: "test".to_string(),
            symbol: Symbol::new("BTCUSDT").unwrap(),
            mark_price: Price::new(mark).unwrap(),
            index_price: Price::new(mark).unwrap(),
            premium: dec!(0),
            premium_bps,
            funding_rate,
            funding_regime,
            open_interest: Quantity::new(dec!(1000)).unwrap(),
            liquidity: LiquidityMetrics {
                spread_bps: dec!(1),
                bid_depth_5bps: dec!(1000),
                ask_depth_5bps: dec!(1000),
                bid_depth_10bps: dec!(2000),
                ask_depth_10bps: dec!(2000),
                imbalance: dec!(0),
                liquidity_score,
            },
            cost: CostEstimate {
                round_trip_fee_bps: dec!(8),
                spread_bps: dec!(1),
                slippage_bps: dec!(1),
                estimated_total_cost_bps: cost_bps,
            },
        }
    }
}
