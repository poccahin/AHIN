use domain::{RiskBudgetConfig, RiskDecisionReason};
use rust_decimal::Decimal;

pub fn weekly_loss_reason(
    realized_pnl_week: Decimal,
    config: &RiskBudgetConfig,
) -> Option<RiskDecisionReason> {
    let loss = realized_pnl_week.min(Decimal::ZERO).abs();
    if loss >= config.weekly_stop_usdt {
        Some(RiskDecisionReason::WeeklyStop)
    } else {
        None
    }
}
