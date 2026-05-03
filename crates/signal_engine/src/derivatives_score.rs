use domain::{FeatureSnapshot, FundingRegime};
use rust_decimal::Decimal;

use crate::signal_packet::clamp_score;

pub fn derivatives_score(snapshot: &FeatureSnapshot) -> Decimal {
    let premium_component = (snapshot.premium_bps.abs() * Decimal::from(2)).min(Decimal::from(30));
    let funding_component = funding_component(snapshot.funding_regime);
    let open_interest_component = if snapshot.open_interest.as_decimal() > Decimal::ZERO {
        Decimal::from(10)
    } else {
        Decimal::ZERO
    };
    let liquidity_component = snapshot.liquidity.liquidity_score * Decimal::from(30);

    clamp_score(
        premium_component + funding_component + open_interest_component + liquidity_component,
    )
}

fn funding_component(regime: FundingRegime) -> Decimal {
    match regime {
        FundingRegime::StronglyNegative | FundingRegime::StronglyPositive => Decimal::from(25),
        FundingRegime::Negative | FundingRegime::Positive => Decimal::from(15),
        FundingRegime::Neutral => Decimal::from(5),
    }
}
