use domain::{AppError, AppResult, Position, Side};
use rust_decimal::Decimal;

pub fn ensure_mark_not_near_liquidation(
    position: &Position,
    min_distance_pct: Decimal,
) -> AppResult<()> {
    let Some(liquidation_price) = position.liquidation_price else {
        return Ok(());
    };
    let mark = position.mark_price.as_decimal();
    let liq = liquidation_price.as_decimal();
    let distance = match position.side {
        Side::Buy => (mark - liq) / mark,
        Side::Sell => (liq - mark) / mark,
    };

    if distance <= min_distance_pct {
        return Err(AppError::RiskRejected(format!(
            "mark price is too close to liquidation: distance {distance}, min {min_distance_pct}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use domain::{Leverage, Notional, Price, Quantity, Symbol};
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn rejects_position_near_liquidation() {
        let position = Position {
            symbol: Symbol::new("BTCUSDT").unwrap(),
            side: Side::Buy,
            quantity: Quantity::new(dec!(1)).unwrap(),
            entry_price: Price::new(dec!(100)).unwrap(),
            mark_price: Price::new(dec!(100)).unwrap(),
            notional: Notional::new(dec!(100)).unwrap(),
            leverage: Leverage::max_phase_one(dec!(5)).unwrap(),
            liquidation_price: Some(Price::new(dec!(99)).unwrap()),
            reduce_only: false,
        };

        assert!(ensure_mark_not_near_liquidation(&position, dec!(0.02)).is_err());
    }
}
