use domain::{FundingRegime, MarketRegime};
use rust_decimal::Decimal;

pub fn funding_score(regime: FundingRegime) -> Decimal {
    match regime {
        FundingRegime::StronglyNegative | FundingRegime::StronglyPositive => Decimal::from(90),
        FundingRegime::Negative | FundingRegime::Positive => Decimal::from(65),
        FundingRegime::Neutral => Decimal::from(45),
    }
}

pub fn funding_crowding_regime(
    regime: FundingRegime,
    premium_bps: Decimal,
) -> Option<MarketRegime> {
    if matches!(
        regime,
        FundingRegime::Positive | FundingRegime::StronglyPositive
    ) && premium_bps > Decimal::from(5)
    {
        Some(MarketRegime::CrowdedLong)
    } else if matches!(
        regime,
        FundingRegime::Negative | FundingRegime::StronglyNegative
    ) && premium_bps < Decimal::from(-5)
    {
        Some(MarketRegime::CrowdedShort)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use domain::{FundingRegime, MarketRegime};
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn classifies_crowded_long_and_short_from_funding_and_premium() {
        assert_eq!(
            funding_crowding_regime(FundingRegime::StronglyPositive, dec!(12)),
            Some(MarketRegime::CrowdedLong)
        );
        assert_eq!(
            funding_crowding_regime(FundingRegime::StronglyNegative, dec!(-12)),
            Some(MarketRegime::CrowdedShort)
        );
        assert_eq!(
            funding_crowding_regime(FundingRegime::Neutral, dec!(20)),
            None
        );
    }
}
