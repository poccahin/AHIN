use domain::{AppError, AppResult};

pub fn ensure_funding_interval_unchanged(previous_hours: u32, current_hours: u32) -> AppResult<()> {
    if previous_hours != current_hours {
        return Err(AppError::RiskRejected(format!(
            "funding interval changed from {previous_hours}h to {current_hours}h"
        )));
    }
    Ok(())
}
