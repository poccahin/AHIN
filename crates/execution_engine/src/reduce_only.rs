use domain::{AppError, AppResult};

pub fn ensure_reduce_only_can_execute(
    has_matching_position: bool,
    reduce_only: bool,
) -> AppResult<()> {
    if reduce_only && !has_matching_position {
        return Err(AppError::ExecutionRejected(
            "reduce-only order cannot execute without a matching open position".to_string(),
        ));
    }
    Ok(())
}
