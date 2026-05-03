use domain::{AppError, AppResult, RiskBudgetConfig, RiskDecisionReason};
use rust_decimal::Decimal;

pub fn ensure_daily_loss_within_cap(
    realized_pnl_today: Decimal,
    max_daily_loss: domain::Notional,
) -> AppResult<()> {
    if realized_pnl_today < Decimal::ZERO && realized_pnl_today.abs() >= max_daily_loss.as_decimal()
    {
        return Err(AppError::RiskRejected(format!(
            "daily loss {} exceeds or equals cap {}",
            realized_pnl_today.abs(),
            max_daily_loss.as_decimal()
        )));
    }
    Ok(())
}

pub fn daily_loss_reasons(
    realized_pnl_today: Decimal,
    config: &RiskBudgetConfig,
) -> Vec<RiskDecisionReason> {
    let loss = realized_pnl_today.min(Decimal::ZERO).abs();
    if loss >= config.daily_hard_stop_usdt {
        vec![RiskDecisionReason::DailyHardStop]
    } else if loss >= config.daily_soft_stop_usdt {
        vec![RiskDecisionReason::DailySoftStop]
    } else {
        Vec::new()
    }
}
