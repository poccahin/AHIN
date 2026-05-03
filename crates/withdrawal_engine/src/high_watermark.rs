use rust_decimal::Decimal;

pub fn unrealized_high_watermark_profit(equity: Decimal, high_water_mark: Decimal) -> Decimal {
    (equity - high_water_mark).max(Decimal::ZERO)
}
