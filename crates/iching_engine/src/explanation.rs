use domain::{GodTurnpointDecision, HexagramState, TurnpointEvidence};

pub fn yi_explanation(hexagram: &HexagramState, evidence: &TurnpointEvidence) -> String {
    format!(
        "Yi taxonomy maps upper={:?}, lower={:?}, line={} to {:?}/{:?}. {}",
        hexagram.upper,
        hexagram.lower,
        hexagram.position_line.number(),
        hexagram.yi_state,
        hexagram.action_bias,
        evidence.summary
    )
}

pub fn god_turnpoint_explanation(decision: &GodTurnpointDecision) -> String {
    if decision.god_turnpoint_allowed {
        format!(
            "God turnpoint passed internally as research-only: {:?}/{:?}, edge_after_cost_ratio={}, data_freshness_score={}. No executable order is generated.",
            decision.yi_state,
            decision.action_bias,
            decision.edge_after_cost_ratio,
            decision.data_freshness_score
        )
    } else {
        format!(
            "God turnpoint blocked by {} deterministic gates. Yi remains explanation-only and cannot bypass risk or execution safety.",
            decision.blockers.len()
        )
    }
}
