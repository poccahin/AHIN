use domain::{
    GodTurnpointBlocker, GodTurnpointConfig, HexagramState, RiskBudgetDecision, SignalDecision,
    SignalGrade, YiReason,
};
use rust_decimal::Decimal;

pub fn blockers(
    signal_decision: &SignalDecision,
    risk_decision: &RiskBudgetDecision,
    hexagram: &HexagramState,
    edge_after_cost_ratio: Decimal,
    data_freshness_score: Decimal,
    degraded_market_data: bool,
    config: &GodTurnpointConfig,
) -> Vec<GodTurnpointBlocker> {
    let mut blockers = Vec::new();
    if signal_decision.packet.grade != SignalGrade::APlus {
        push_blocker(
            &mut blockers,
            "signal_grade_not_a_plus",
            "God turnpoint requires A+ signal grade",
        );
    }
    if signal_decision.packet.final_strength < config.min_signal_strength {
        push_blocker(
            &mut blockers,
            "signal_strength_too_low",
            "God turnpoint requires final signal strength >= configured threshold",
        );
    }
    if edge_after_cost_ratio < config.min_edge_after_cost_ratio {
        push_blocker(
            &mut blockers,
            "edge_after_cost_too_low",
            "God turnpoint requires edge-after-cost ratio >= configured threshold",
        );
    }
    if !risk_decision.risk_allowed {
        push_blocker(
            &mut blockers,
            "risk_budget_rejected",
            "Risk budget must internally allow risk before Yi layer can pass",
        );
    }
    if data_freshness_score < config.min_data_freshness_score {
        push_blocker(
            &mut blockers,
            "data_freshness_too_low",
            "God turnpoint requires fresh stable market data",
        );
    }
    if degraded_market_data {
        push_blocker(
            &mut blockers,
            "degraded_market_data",
            "Degraded market data may be explained but cannot produce a god turnpoint",
        );
    }
    if !config.allowed_biases.contains(&hexagram.action_bias) {
        push_blocker(
            &mut blockers,
            "yi_action_bias_restricts",
            "Yi action bias is restrictive and cannot loosen downstream gates",
        );
    }
    if config.blocked_states.contains(&hexagram.yi_state) {
        push_blocker(
            &mut blockers,
            "yi_state_blocked",
            "Yi state is one of the blocked risk/collapse/blockage/cooldown states",
        );
    }
    blockers
}

pub fn reasons_from_blockers(blockers: &[GodTurnpointBlocker]) -> Vec<YiReason> {
    let mut reasons = Vec::new();
    for blocker in blockers {
        match blocker.code.as_str() {
            "signal_grade_not_a_plus" | "signal_strength_too_low" => {
                push_reason(&mut reasons, YiReason::WeakSignal)
            }
            "edge_after_cost_too_low" => push_reason(&mut reasons, YiReason::EdgeAfterCostWeak),
            "risk_budget_rejected" => push_reason(&mut reasons, YiReason::RiskBudgetBlocked),
            "data_freshness_too_low" => push_reason(&mut reasons, YiReason::DataFreshnessLow),
            "degraded_market_data" => push_reason(&mut reasons, YiReason::DegradedMarketData),
            "yi_state_blocked" => push_reason(&mut reasons, YiReason::Cooldown),
            _ => {}
        }
    }
    reasons
}

fn push_blocker(blockers: &mut Vec<GodTurnpointBlocker>, code: &str, message: &str) {
    if !blockers.iter().any(|blocker| blocker.code == code) {
        blockers.push(GodTurnpointBlocker {
            code: code.to_string(),
            message: message.to_string(),
        });
    }
}

fn push_reason(reasons: &mut Vec<YiReason>, reason: YiReason) {
    if !reasons.contains(&reason) {
        reasons.push(reason);
    }
}
