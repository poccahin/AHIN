use domain::{AppError, AppResult, Notional};
use rust_decimal::Decimal;

pub fn ensure_daily_loss_within_cap(
    realized_pnl_today: Decimal,
    max_daily_loss: Notional,
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
