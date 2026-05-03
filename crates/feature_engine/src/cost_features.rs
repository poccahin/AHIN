use domain::CostEstimate;
use rust_decimal::Decimal;

pub fn total_cost_bps(fee_bps: Decimal, slippage_bps: Decimal, spread_bps: Decimal) -> Decimal {
    fee_bps + slippage_bps + spread_bps
}

pub fn basic_cost_estimate(
    spread_bps: Decimal,
    liquidity_score: Decimal,
    one_way_taker_fee_bps: Decimal,
) -> CostEstimate {
    let liquidity_score = clamp(liquidity_score, Decimal::ZERO, Decimal::ONE);
    let round_trip_fee_bps = one_way_taker_fee_bps * Decimal::from(2);
    let slippage_bps = (Decimal::ONE - liquidity_score) * Decimal::from(10);
    let estimated_total_cost_bps = total_cost_bps(
        round_trip_fee_bps,
        slippage_bps,
        spread_bps.max(Decimal::ZERO),
    );

    CostEstimate {
        round_trip_fee_bps,
        spread_bps,
        slippage_bps,
        estimated_total_cost_bps,
    }
}

fn clamp(value: Decimal, min: Decimal, max: Decimal) -> Decimal {
    value.max(min).min(max)
}

#[cfg(test)]
mod tests {
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn estimates_total_cost_from_fee_spread_and_liquidity() {
        let estimate = basic_cost_estimate(dec!(2), dec!(0.8), dec!(4));

        assert_eq!(estimate.round_trip_fee_bps, dec!(8));
        assert_eq!(estimate.slippage_bps, dec!(2.0));
        assert_eq!(estimate.estimated_total_cost_bps, dec!(12.0));
    }
}
