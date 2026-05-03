use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Price(Decimal);

impl Price {
    pub fn new(value: Decimal) -> AppResult<Self> {
        positive("price", value).map(Self)
    }

    pub fn as_decimal(self) -> Decimal {
        self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Quantity(Decimal);

impl Quantity {
    pub fn new(value: Decimal) -> AppResult<Self> {
        positive("quantity", value).map(Self)
    }

    pub fn as_decimal(self) -> Decimal {
        self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Notional(Decimal);

impl Notional {
    pub fn new(value: Decimal) -> AppResult<Self> {
        positive("notional", value).map(Self)
    }

    pub fn from_price_quantity(price: Price, quantity: Quantity) -> AppResult<Self> {
        Self::new(price.as_decimal() * quantity.as_decimal())
    }

    pub fn as_decimal(self) -> Decimal {
        self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Leverage(Decimal);

impl Leverage {
    pub fn new(value: Decimal) -> AppResult<Self> {
        positive("leverage", value).map(Self)
    }

    pub fn with_cap(value: Decimal, max: Decimal) -> AppResult<Self> {
        let leverage = Self::new(value)?;
        if value > max {
            return Err(AppError::LeverageTooHigh {
                requested: value.to_string(),
                max: max.to_string(),
            });
        }
        Ok(leverage)
    }

    pub fn max_phase_one(value: Decimal) -> AppResult<Self> {
        Self::with_cap(value, Decimal::from(5))
    }

    pub fn as_decimal(self) -> Decimal {
        self.0
    }
}

fn positive(field: &'static str, value: Decimal) -> AppResult<Decimal> {
    if value <= Decimal::ZERO {
        return Err(AppError::NonPositive {
            field,
            value: value.to_string(),
        });
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn rejects_non_positive_money_values() {
        assert!(Price::new(dec!(0)).is_err());
        assert!(Quantity::new(dec!(-1)).is_err());
        assert!(Notional::new(dec!(0)).is_err());
    }

    #[test]
    fn calculates_notional_from_price_and_quantity() {
        let price = Price::new(dec!(100)).unwrap();
        let quantity = Quantity::new(dec!(0.2)).unwrap();

        assert_eq!(
            Notional::from_price_quantity(price, quantity)
                .unwrap()
                .as_decimal(),
            dec!(20.0)
        );
    }

    #[test]
    fn enforces_phase_one_leverage_cap() {
        assert!(Leverage::max_phase_one(dec!(5)).is_ok());
        assert!(Leverage::max_phase_one(dec!(5.1)).is_err());
    }
}
