use domain::{
    DecisionReason, FeatureSnapshot, MarketRegime, SignalDirection, SignalGrade, SignalPacket,
};
use rust_decimal::Decimal;

use crate::{cost_score, derivatives_score, funding_score, liquidity_score, regime_classifier};

pub fn build_signal_packet(snapshot: &FeatureSnapshot) -> SignalPacket {
    let market_regime = regime_classifier::classify_market_regime(snapshot);
    let direction = direction_for_regime(market_regime);
    let price_structure_score = placeholder_price_structure_score(snapshot);
    let derivatives_score = derivatives_score::derivatives_score(snapshot);
    let funding_score = funding_score::funding_score(snapshot.funding_regime);
    let liquidity_score = liquidity_score::liquidity_score(snapshot);
    let cost_score = cost_score::cost_score(snapshot);
    let final_strength = final_strength(
        price_structure_score,
        derivatives_score,
        funding_score,
        liquidity_score,
        cost_score,
    );
    let grade = grade_for_strength(final_strength);
    let reasons = packet_reasons(market_regime, direction);

    SignalPacket {
        exchange: snapshot.exchange.clone(),
        symbol: snapshot.symbol.clone(),
        direction,
        market_regime,
        price_structure_score,
        derivatives_score,
        funding_score,
        liquidity_score,
        cost_score,
        final_strength,
        grade,
        reasons,
    }
}

pub fn clamp_score(value: Decimal) -> Decimal {
    value.max(Decimal::ZERO).min(Decimal::from(100))
}

pub fn grade_for_strength(strength: Decimal) -> SignalGrade {
    if strength >= Decimal::from(85) {
        SignalGrade::APlus
    } else if strength >= Decimal::from(75) {
        SignalGrade::A
    } else if strength >= Decimal::from(65) {
        SignalGrade::B
    } else if strength >= Decimal::from(55) {
        SignalGrade::C
    } else if strength >= Decimal::from(40) {
        SignalGrade::D
    } else {
        SignalGrade::F
    }
}

fn final_strength(
    price_structure_score: Decimal,
    derivatives_score: Decimal,
    funding_score: Decimal,
    liquidity_score: Decimal,
    cost_score: Decimal,
) -> Decimal {
    clamp_score(
        ((price_structure_score * Decimal::from(25))
            + (derivatives_score * Decimal::from(30))
            + (funding_score * Decimal::from(15))
            + (liquidity_score * Decimal::from(15))
            + (cost_score * Decimal::from(15)))
            / Decimal::from(100),
    )
}

fn placeholder_price_structure_score(snapshot: &FeatureSnapshot) -> Decimal {
    let premium_component = snapshot
        .premium_bps
        .max(Decimal::from(-25))
        .min(Decimal::from(25));
    let funding_component = match snapshot.funding_regime {
        domain::FundingRegime::StronglyPositive => Decimal::from(10),
        domain::FundingRegime::Positive => Decimal::from(5),
        domain::FundingRegime::Neutral => Decimal::ZERO,
        domain::FundingRegime::Negative => Decimal::from(-5),
        domain::FundingRegime::StronglyNegative => Decimal::from(-10),
    };
    let liquidity_component =
        (snapshot.liquidity.liquidity_score - Decimal::new(5, 1)) * Decimal::from(20);

    clamp_score(Decimal::from(50) + premium_component + funding_component + liquidity_component)
}

fn direction_for_regime(regime: MarketRegime) -> SignalDirection {
    match regime {
        MarketRegime::CrowdedLong => SignalDirection::Short,
        MarketRegime::CrowdedShort => SignalDirection::Long,
        MarketRegime::PositivePremium => SignalDirection::Long,
        MarketRegime::NegativePremium => SignalDirection::Short,
        MarketRegime::Neutral | MarketRegime::Illiquid | MarketRegime::HighCost => {
            SignalDirection::Neutral
        }
    }
}

fn packet_reasons(regime: MarketRegime, direction: SignalDirection) -> Vec<DecisionReason> {
    let mut reasons = Vec::new();
    match regime {
        MarketRegime::HighCost => reasons.push(DecisionReason::HighCost),
        MarketRegime::Illiquid => reasons.push(DecisionReason::LowLiquidity),
        MarketRegime::CrowdedLong => reasons.push(DecisionReason::CrowdedLong),
        MarketRegime::CrowdedShort => reasons.push(DecisionReason::CrowdedShort),
        MarketRegime::Neutral | MarketRegime::PositivePremium | MarketRegime::NegativePremium => {}
    }
    if direction == SignalDirection::Neutral {
        reasons.push(DecisionReason::NeutralSignal);
    }
    reasons
}

#[cfg(test)]
mod tests {
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn clamps_scores_to_zero_to_one_hundred() {
        assert_eq!(clamp_score(dec!(-1)), dec!(0));
        assert_eq!(clamp_score(dec!(101)), dec!(100));
        assert_eq!(clamp_score(dec!(42)), dec!(42));
    }
}
