use domain::{AppError, AppResult, OrderCandidate, OrderRequest};
use exchange::ExchangeAdapter;

pub async fn route_dry_run_order<A>(adapter: &A, request: OrderRequest) -> AppResult<OrderCandidate>
where
    A: ExchangeAdapter,
{
    let candidate = adapter.place_order_dry_run(request).await?;
    if !candidate.is_dry_run_only() {
        return Err(AppError::ExecutionRejected(
            "adapter returned a candidate that is not dry-run only".to_string(),
        ));
    }
    Ok(candidate)
}
