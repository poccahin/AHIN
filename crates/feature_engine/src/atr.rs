use domain::Price;
use rust_decimal::Decimal;

pub fn true_range(high: Price, low: Price, previous_close: Price) -> Decimal {
    let high = high.as_decimal();
    let low = low.as_decimal();
    let previous_close = previous_close.as_decimal();
    let high_low = high - low;
    let high_close = (high - previous_close).abs();
    let low_close = (low - previous_close).abs();
    high_low.max(high_close).max(low_close)
}
