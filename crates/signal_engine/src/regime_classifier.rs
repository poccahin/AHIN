use domain::{FeatureSnapshot, MarketRegime};
use rust_decimal::Decimal;

use crate::{cost_score, funding_score, liquidity_score};

pub fn classify_market_regime(snapshot: &FeatureSnapshot) -> MarketRegime {
    if cost_score::is_high_cost(snapshot) {
        return MarketRegime::HighCost;
    }
    if liquidity_score::is_low_liquidity(snapshot) {
        return MarketRegime::Illiquid;
    }
    if let Some(crowding) =
        funding_score::funding_crowding_regime(snapshot.funding_regime, snapshot.premium_bps)
    {
        return crowding;
    }
    if snapshot.premium_bps > Decimal::from(5) {
        MarketRegime::PositivePremium
    } else if snapshot.premium_bps < Decimal::from(-5) {
        MarketRegime::NegativePremium
    } else {
        MarketRegime::Neutral
    }
}
