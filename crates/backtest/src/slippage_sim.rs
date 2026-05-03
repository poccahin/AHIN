use rust_decimal::Decimal;

pub fn simulated_slippage(notional: Decimal, slippage_bps: Decimal) -> Decimal {
    notional * slippage_bps / Decimal::from(10_000)
}
