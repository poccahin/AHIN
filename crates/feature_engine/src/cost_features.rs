use rust_decimal::Decimal;

pub fn total_cost_bps(fee_bps: Decimal, slippage_bps: Decimal, spread_bps: Decimal) -> Decimal {
    fee_bps + slippage_bps + spread_bps
}
