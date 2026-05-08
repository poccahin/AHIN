use domain::{FeatureSnapshot, FundingRegime, SignalDecision, SignalDirection, Trigram};
use rust_decimal::Decimal;

pub fn upper_trigram(snapshot: &FeatureSnapshot, signal_decision: &SignalDecision) -> Trigram {
    if is_derivatives_risk(snapshot) {
        return Trigram::Kan;
    }
    match signal_decision.packet.direction {
        SignalDirection::Long if signal_decision.packet.final_strength >= Decimal::from(85) => {
            Trigram::Qian
        }
        SignalDirection::Short if signal_decision.packet.final_strength >= Decimal::from(85) => {
            Trigram::Kun
        }
        SignalDirection::Long => Trigram::Li,
        SignalDirection::Short => Trigram::Dui,
        SignalDirection::Neutral => Trigram::Gen,
    }
}

pub fn lower_trigram(snapshot: &FeatureSnapshot) -> Trigram {
    if snapshot.cost.estimated_total_cost_bps >= Decimal::from(35) {
        return Trigram::Kan;
    }
    if snapshot.liquidity.liquidity_score <= Decimal::new(25, 2) {
        return Trigram::Gen;
    }
    if snapshot.liquidity.liquidity_score >= Decimal::new(85, 2)
        && snapshot.cost.estimated_total_cost_bps <= Decimal::from(15)
    {
        return Trigram::Xun;
    }
    if snapshot.liquidity.imbalance.abs() >= Decimal::new(35, 2) {
        return Trigram::Zhen;
    }
    Trigram::Kun
}

fn is_derivatives_risk(snapshot: &FeatureSnapshot) -> bool {
    let crowded_funding = matches!(
        snapshot.funding_regime,
        FundingRegime::StronglyNegative | FundingRegime::StronglyPositive
    ) && snapshot.funding_rate.abs() >= Decimal::new(6, 4);
    let stretched_premium = snapshot.premium_bps.abs() >= Decimal::from(120);
    crowded_funding || stretched_premium
}
