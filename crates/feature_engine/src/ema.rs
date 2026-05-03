use rust_decimal::Decimal;

pub fn next_ema(previous: Decimal, value: Decimal, period: u32) -> Decimal {
    if period == 0 {
        return value;
    }
    let multiplier = Decimal::from(2) / Decimal::from(period + 1);
    (value * multiplier) + (previous * (Decimal::ONE - multiplier))
}
