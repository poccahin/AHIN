use domain::{AppError, AppResult, Notional};

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
