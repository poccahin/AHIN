use domain::{
    CandidateSizingConfig, DryRunOrderCandidate, FeatureSnapshot, OrderCandidateReason,
    RiskBudgetDecision, SignalDecision,
};

use crate::{candidate_sizing, order_candidate};

pub fn build_dry_run_candidate(
    feature_snapshot: &FeatureSnapshot,
    signal_decision: &SignalDecision,
    risk_decision: &RiskBudgetDecision,
    config: &CandidateSizingConfig,
) -> DryRunOrderCandidate {
    let sizing = candidate_sizing::size_candidate(risk_decision, config);
    let mut reasons = sizing.reasons;
    order_candidate::push_reason(&mut reasons, OrderCandidateReason::DryRunOnly);
    order_candidate::push_reason(
        &mut reasons,
        OrderCandidateReason::NoExecutableOrderGenerated,
    );
    order_candidate::push_reason(&mut reasons, OrderCandidateReason::ResearchOnlyMode);
    order_candidate::push_reason(&mut reasons, OrderCandidateReason::AuditOnly);
    order_candidate::push_reason(&mut reasons, OrderCandidateReason::CandidateGenerated);

    DryRunOrderCandidate {
        candidate_id: format!(
            "audit-{}-{}",
            signal_decision.packet.exchange,
            signal_decision.packet.symbol.as_str()
        ),
        exchange: signal_decision.packet.exchange.clone(),
        symbol: signal_decision.packet.symbol.clone(),
        direction: signal_decision.packet.direction,
        reference_price: feature_snapshot.mark_price,
        notional: sizing.notional,
        margin_required: sizing.margin_required,
        leverage: sizing.leverage,
        assumed_stop_distance_pct: config.assumed_stop_distance_pct,
        max_loss_usdt: sizing.max_loss_usdt,
        executable: false,
        real_order_id: None,
        audit_only: true,
        reasons,
    }
}
