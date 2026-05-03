use rust_decimal::Decimal;

pub fn realized_abs_move_bps(open: Decimal, close: Decimal) -> Decimal {
    if open <= Decimal::ZERO {
        return Decimal::ZERO;
    }
    ((close - open).abs() / open) * Decimal::from(10_000)
}
