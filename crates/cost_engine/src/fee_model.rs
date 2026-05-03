use domain::{AppError, AppResult};
use rust_decimal::Decimal;

pub fn round_trip_fee_bps(maker_or_taker_fee_bps: Decimal) -> Decimal {
    maker_or_taker_fee_bps * Decimal::from(2)
}

pub fn ensure_cost_attrition_safe(
    equity: Decimal,
    expected_round_trip_fee: Decimal,
    max_fee_to_equity_pct: Decimal,
) -> AppResult<()> {
    if equity <= Decimal::ZERO {
        return Err(AppError::CostRejected(
            "equity must be positive for cost attrition check".to_string(),
        ));
    }
    let fee_pct = expected_round_trip_fee / equity;
    if fee_pct > max_fee_to_equity_pct {
        return Err(AppError::CostRejected(format!(
            "fee attrition {fee_pct} exceeds max {max_fee_to_equity_pct}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn rejects_fees_that_can_grind_small_account() {
        assert!(ensure_cost_attrition_safe(dec!(200), dec!(5), dec!(0.01)).is_err());
        assert!(ensure_cost_attrition_safe(dec!(200), dec!(0.2), dec!(0.01)).is_ok());
    }
}
