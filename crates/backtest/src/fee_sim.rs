use rust_decimal::Decimal;

pub fn simulated_fee(notional: Decimal, fee_bps: Decimal) -> Decimal {
    notional * fee_bps / Decimal::from(10_000)
}
