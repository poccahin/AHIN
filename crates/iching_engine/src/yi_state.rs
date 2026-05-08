use domain::{
    FeatureSnapshot, FeatureWindow, GodTurnpointConfig, HexagramState, RiskBudgetDecision,
    SignalDecision, SignalGrade, TurnpointEvidence, YiActionBias, YiReason, YiState,
};
use rust_decimal::Decimal;

use crate::{
    hexagram_mapper, moving_line, trigram_classifier,
    turnpoint_score::{compute_feature_delta, compute_turnpoint_evidence},
};

pub fn evaluate_yi_state(
    snapshot: &FeatureSnapshot,
    signal_decision: &SignalDecision,
    risk_decision: &RiskBudgetDecision,
    window: &FeatureWindow,
    data_freshness_score: Decimal,
    degraded_market_data: bool,
    config: &GodTurnpointConfig,
) -> (HexagramState, TurnpointEvidence) {
    let delta = compute_feature_delta(window, None, signal_decision, data_freshness_score);
    let evidence = compute_turnpoint_evidence(delta);
    let upper = trigram_classifier::upper_trigram(snapshot, signal_decision);
    let lower = trigram_classifier::lower_trigram(snapshot);
    let mut yi_state = hexagram_mapper::map_hexagram_state(upper, lower);
    let mut reasons = Vec::new();

    push_reason(&mut reasons, YiReason::ResearchOnlyExplanation);
    if signal_decision.packet.grade == SignalGrade::APlus {
        push_reason(&mut reasons, YiReason::StrongSignal);
    } else {
        push_reason(&mut reasons, YiReason::WeakSignal);
    }
    if risk_decision.risk_allowed {
        push_reason(&mut reasons, YiReason::RiskBudgetAllowed);
    } else {
        push_reason(&mut reasons, YiReason::RiskBudgetBlocked);
    }
    if data_freshness_score >= config.min_data_freshness_score {
        push_reason(&mut reasons, YiReason::DataFresh);
    } else {
        push_reason(&mut reasons, YiReason::DataFreshnessLow);
    }
    if degraded_market_data {
        push_reason(&mut reasons, YiReason::DegradedMarketData);
    }
    if evidence.positive_count >= 2 {
        push_reason(&mut reasons, YiReason::TurnpointEvidencePositive);
    }
    if evidence.negative_count >= 2 {
        push_reason(&mut reasons, YiReason::TurnpointEvidenceNegative);
    }

    if evidence.negative_count >= 2 && evidence.delta.mark_price_return <= Decimal::new(-2, 2) {
        yi_state = YiState::BoCollapse;
    }
    if !signal_decision.signal_allowed && snapshot.liquidity.liquidity_score <= Decimal::new(35, 2)
    {
        yi_state = YiState::PiBlockage;
    }

    if let Some(reason) = state_reason(yi_state) {
        push_reason(&mut reasons, reason);
    }
    if snapshot.liquidity.liquidity_score >= Decimal::new(8, 1)
        && snapshot.cost.estimated_total_cost_bps <= Decimal::from(15)
    {
        push_reason(&mut reasons, YiReason::ExecutionSupportive);
    }
    if snapshot.liquidity.liquidity_score <= Decimal::new(35, 2) {
        push_reason(&mut reasons, YiReason::ExecutionThin);
    }
    if snapshot.cost.estimated_total_cost_bps >= Decimal::from(35) {
        push_reason(&mut reasons, YiReason::CostHigh);
    }

    let line = moving_line::determine_moving_line(signal_decision, &evidence.delta, yi_state);
    let mut action_bias = moving_line::action_bias_for_line(line, yi_state);
    if signal_decision.packet.grade != SignalGrade::APlus
        || signal_decision.packet.final_strength < config.min_signal_strength
    {
        action_bias = YiActionBias::Observe;
    }
    if line.number() == 6 {
        action_bias = YiActionBias::Cooldown;
        if !matches!(
            yi_state,
            YiState::KanRisk | YiState::BoCollapse | YiState::PiBlockage
        ) {
            yi_state = YiState::Cooldown;
        }
        push_reason(&mut reasons, YiReason::Cooldown);
    }

    let name = hexagram_mapper::hexagram_name(upper, lower, yi_state);
    (
        HexagramState {
            upper,
            lower,
            position_line: line,
            yi_state,
            action_bias,
            name,
            reasons,
        },
        evidence,
    )
}

fn state_reason(state: YiState) -> Option<YiReason> {
    match state {
        YiState::KanRisk => Some(YiReason::KanRisk),
        YiState::BoCollapse => Some(YiReason::BoCollapse),
        YiState::PiBlockage => Some(YiReason::PiBlockage),
        _ => None,
    }
}

fn push_reason(reasons: &mut Vec<YiReason>, reason: YiReason) {
    if !reasons.contains(&reason) {
        reasons.push(reason);
    }
}
