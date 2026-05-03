use domain::{AppResult, Price, Quantity};
use rust_decimal::Decimal;

pub fn single_period_vwap(price: Price, quantity: Quantity) -> AppResult<Decimal> {
    let notional = price.as_decimal() * quantity.as_decimal();
    if quantity.as_decimal() <= Decimal::ZERO {
        return Ok(Decimal::ZERO);
    }
    Ok(notional / quantity.as_decimal())
}
