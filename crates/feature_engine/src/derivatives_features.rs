use domain::{AppResult, FundingRegime, Price};
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

pub fn mark_index_premium(mark_price: Price, index_price: Price) -> Decimal {
    mark_price.as_decimal() - index_price.as_decimal()
}

pub fn premium_bps(mark_price: Price, index_price: Price) -> AppResult<Decimal> {
    let index = index_price.as_decimal();
    Ok((mark_index_premium(mark_price, index_price) / index) * Decimal::from(10_000))
}

pub fn classify_funding_regime(funding_rate: Decimal) -> FundingRegime {
    let neutral_threshold = Decimal::new(1, 4);
    let strong_threshold = Decimal::new(5, 4);

    if funding_rate <= -strong_threshold {
        FundingRegime::StronglyNegative
    } else if funding_rate < -neutral_threshold {
        FundingRegime::Negative
    } else if funding_rate <= neutral_threshold {
        FundingRegime::Neutral
    } else if funding_rate < strong_threshold {
        FundingRegime::Positive
    } else {
        FundingRegime::StronglyPositive
    }
}

#[cfg(test)]
mod tests {
    use domain::Price;
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

    #[test]
    fn calculates_mark_index_premium_and_bps() {
        let mark = Price::new(dec!(101)).unwrap();
        let index = Price::new(dec!(100)).unwrap();

        assert_eq!(mark_index_premium(mark, index), dec!(1));
        assert_eq!(premium_bps(mark, index).unwrap(), dec!(100));
    }

    #[test]
    fn classifies_funding_regime_by_thresholds() {
        assert_eq!(
            classify_funding_regime(dec!(-0.0006)),
            FundingRegime::StronglyNegative
        );
        assert_eq!(
            classify_funding_regime(dec!(-0.0002)),
            FundingRegime::Negative
        );
        assert_eq!(
            classify_funding_regime(dec!(0.0001)),
            FundingRegime::Neutral
        );
        assert_eq!(
            classify_funding_regime(dec!(0.0002)),
            FundingRegime::Positive
        );
        assert_eq!(
            classify_funding_regime(dec!(0.0005)),
            FundingRegime::StronglyPositive
        );
    }
}
