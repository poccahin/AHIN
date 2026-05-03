use domain::{AppError, AppResult};
use rust_decimal::Decimal;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DryRunWithdrawalPlan {
    pub amount: Decimal,
    pub dry_run_only: bool,
}

pub fn plan_high_watermark_withdrawal_dry_run(
    equity: Decimal,
    high_water_mark: Decimal,
    reserve: Decimal,
) -> AppResult<DryRunWithdrawalPlan> {
    if equity <= high_water_mark + reserve {
        return Ok(DryRunWithdrawalPlan {
            amount: Decimal::ZERO,
            dry_run_only: true,
        });
    }

    Err(AppError::ExecutionRejected(
        "real withdrawal logic is intentionally not implemented in phase one".to_string(),
    ))
}
