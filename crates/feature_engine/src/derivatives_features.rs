use rust_decimal::Decimal;

pub fn funding_pressure_score(funding_rate: Decimal, open_interest_delta: Decimal) -> Decimal {
    if open_interest_delta > Decimal::ZERO {
        funding_rate
    } else if open_interest_delta < Decimal::ZERO {
        -funding_rate
    } else {
        Decimal::ZERO
    }
}

#[cfg(test)]
mod tests {
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn funding_pressure_uses_open_interest_direction() {
        assert_eq!(funding_pressure_score(dec!(0.0001), dec!(10)), dec!(0.0001));
        assert_eq!(
            funding_pressure_score(dec!(0.0001), dec!(-10)),
            dec!(-0.0001)
        );
    }
}
