use domain::{AppResult, Price};
use rust_decimal::Decimal;

pub fn annualized_basis_bps(spot: Price, futures: Price) -> AppResult<Decimal> {
    let spot = spot.as_decimal();
    let futures = futures.as_decimal();
    if spot <= Decimal::ZERO {
        return Ok(Decimal::ZERO);
    }
    Ok(((futures - spot) / spot) * Decimal::from(10_000))
}
