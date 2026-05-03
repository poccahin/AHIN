use domain::{
    AppError, AppResult, DryRunOrderCandidate, OrderCandidate, OrderCandidateReason,
    RiskBudgetDecision, SignalDecision,
};

pub fn ensure_candidate_is_not_live(candidate: &OrderCandidate) -> AppResult<()> {
    if !candidate.is_dry_run_only() {
        return Err(AppError::ExecutionRejected(
            "order candidate contains live-order capabilities".to_string(),
        ));
    }
    Ok(())
}

pub fn base_rejection_reasons(
    signal_decision: &SignalDecision,
    risk_decision: &RiskBudgetDecision,
) -> Vec<OrderCandidateReason> {
    let mut reasons = Vec::new();
    if !signal_decision.signal_allowed {
        push_reason(&mut reasons, OrderCandidateReason::SignalRejected);
    }
    if !risk_decision.risk_allowed {
        push_reason(&mut reasons, OrderCandidateReason::RiskRejected);
    }
    push_reason(&mut reasons, OrderCandidateReason::ResearchOnlyMode);
    push_reason(
        &mut reasons,
        OrderCandidateReason::NoExecutableOrderGenerated,
    );
    reasons
}

pub fn ensure_dry_run_candidate_invariants(candidate: &DryRunOrderCandidate) -> AppResult<()> {
    if !candidate.invariant_safe() {
        return Err(AppError::ExecutionRejected(
            "dry-run candidate violated audit-only invariants".to_string(),
        ));
    }
    Ok(())
}

pub fn push_reason(reasons: &mut Vec<OrderCandidateReason>, reason: OrderCandidateReason) {
    if !reasons.contains(&reason) {
        reasons.push(reason);
    }
}
