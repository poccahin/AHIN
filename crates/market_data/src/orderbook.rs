use domain::{AppError, AppResult, OrderBook};
use rust_decimal::Decimal;

pub fn ensure_spread_below(book: &OrderBook, max_spread_bps: Decimal) -> AppResult<()> {
    let spread = book.spread_bps();
    if spread > max_spread_bps {
        return Err(AppError::CostRejected(format!(
            "spread {spread} bps exceeds max {max_spread_bps} bps"
        )));
    }
    Ok(())
}
