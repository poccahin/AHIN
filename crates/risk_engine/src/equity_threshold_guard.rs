use domain::{RiskBudgetConfig, RiskDecisionReason};
use rust_decimal::Decimal;

pub fn equity_threshold_reasons(
    equity: Decimal,
    config: &RiskBudgetConfig,
) -> Vec<RiskDecisionReason> {
    let mut reasons = Vec::new();
    if equity < config.disable_trend_below_equity {
        reasons.push(RiskDecisionReason::TrendDisabledBelowEquity);
    }
    if equity < config.paper_mode_below_equity {
        reasons.push(RiskDecisionReason::PaperModeBelowEquity);
    }
    reasons
}
