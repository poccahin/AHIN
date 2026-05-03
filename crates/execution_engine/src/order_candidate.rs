use domain::{AppError, AppResult, OrderCandidate};

pub fn ensure_candidate_is_not_live(candidate: &OrderCandidate) -> AppResult<()> {
    if !candidate.is_dry_run_only() {
        return Err(AppError::ExecutionRejected(
            "order candidate contains live-order capabilities".to_string(),
        ));
    }
    Ok(())
}
