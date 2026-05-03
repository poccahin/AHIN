use domain::{AppError, AppResult};
use rust_decimal::Decimal;

pub fn ensure_regime_allows_trade(regime_score: Decimal) -> AppResult<()> {
    if regime_score <= Decimal::ZERO {
        return Err(AppError::RiskRejected(
            "regime filter does not allow trade".to_string(),
        ));
    }
    Ok(())
}
