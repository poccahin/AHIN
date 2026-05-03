use domain::FeatureSnapshot;
use rust_decimal::Decimal;

use crate::signal_packet::clamp_score;

pub fn liquidity_score(snapshot: &FeatureSnapshot) -> Decimal {
    clamp_score(snapshot.liquidity.liquidity_score * Decimal::from(100))
}

pub fn is_low_liquidity(snapshot: &FeatureSnapshot) -> bool {
    snapshot.liquidity.liquidity_score < Decimal::new(25, 2)
}
