use domain::{AppError, AppResult};
use rust_decimal::Decimal;

pub fn ensure_independent_heatmap_confirmation(
    heatmap_score: Decimal,
    independent_confirmation: bool,
) -> AppResult<()> {
    if heatmap_score > Decimal::ZERO && !independent_confirmation {
        return Err(AppError::RiskRejected(
            "liquidation heatmap score is not sufficient without independent confirmation"
                .to_string(),
        ));
    }
    Ok(())
}

pub fn institutional_score(derivatives_score: Decimal, flow_score: Decimal) -> Decimal {
    (derivatives_score + flow_score) / Decimal::from(2)
}
