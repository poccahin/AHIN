use domain::{AppError, AppResult};
use rust_decimal::Decimal;

pub fn edge_after_cost_bps(
    raw_edge_bps: Decimal,
    fee_bps: Decimal,
    slippage_bps: Decimal,
    spread_bps: Decimal,
) -> Decimal {
    raw_edge_bps - fee_bps - slippage_bps - spread_bps
}

pub fn ensure_positive_edge_after_cost(edge_after_cost_bps: Decimal) -> AppResult<()> {
    if edge_after_cost_bps <= Decimal::ZERO {
        return Err(AppError::CostRejected(
            "edge after cost is not positive".to_string(),
        ));
    }
    Ok(())
}
