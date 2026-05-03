use domain::FeatureSnapshot;
use rust_decimal::Decimal;

use crate::signal_packet::clamp_score;

pub fn cost_score(snapshot: &FeatureSnapshot) -> Decimal {
    clamp_score(Decimal::from(100) - (snapshot.cost.estimated_total_cost_bps * Decimal::from(3)))
}

pub fn is_high_cost(snapshot: &FeatureSnapshot) -> bool {
    snapshot.cost.estimated_total_cost_bps >= Decimal::from(35)
}
