use domain::{AppError, AppResult, OrderCandidate};

pub fn ensure_no_real_order_ids(open_orders: &[OrderCandidate]) -> AppResult<()> {
    if open_orders
        .iter()
        .any(|order| order.exchange_order_id.is_some())
    {
        return Err(AppError::Reconciliation(
            "real exchange order id found in dry-run state".to_string(),
        ));
    }
    Ok(())
}
