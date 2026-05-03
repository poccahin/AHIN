use domain::{AppError, AppResult, ExposureState, Notional, RiskBudgetConfig, RiskDecisionReason};

pub fn ensure_gross_notional_within_cap(
    current_gross: Notional,
    candidate: Notional,
    cap: Notional,
) -> AppResult<()> {
    let next = current_gross.as_decimal() + candidate.as_decimal();
    if next > cap.as_decimal() {
        return Err(AppError::RiskRejected(format!(
            "gross notional {next} exceeds cap {}",
            cap.as_decimal()
        )));
    }
    Ok(())
}

pub fn gross_notional_reason(
    exposure: &ExposureState,
    config: &RiskBudgetConfig,
) -> Option<RiskDecisionReason> {
    if exposure.gross_notional > config.max_gross_notional {
        Some(RiskDecisionReason::GrossNotionalCapExceeded)
    } else {
        None
    }
}
