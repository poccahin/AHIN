use domain::{DecisionReason, FeatureSnapshot, SignalDecision, SignalDirection, SignalPacket};
use rust_decimal::Decimal;

use crate::{cost_score, liquidity_score, signal_packet};

const MIN_SIGNAL_STRENGTH: i64 = 55;

pub fn evaluate_snapshot(snapshot: &FeatureSnapshot) -> SignalDecision {
    let packet = signal_packet::build_signal_packet(snapshot);
    decide_from_packet(packet, snapshot)
}

pub fn decide_from_packet(packet: SignalPacket, snapshot: &FeatureSnapshot) -> SignalDecision {
    let mut reasons = packet.reasons.clone();

    if cost_score::is_high_cost(snapshot) {
        push_reason(&mut reasons, DecisionReason::HighCost);
    }
    if liquidity_score::is_low_liquidity(snapshot) {
        push_reason(&mut reasons, DecisionReason::LowLiquidity);
    }
    if packet.direction == SignalDirection::Neutral {
        push_reason(&mut reasons, DecisionReason::NeutralSignal);
    }
    if packet.final_strength < Decimal::from(MIN_SIGNAL_STRENGTH) {
        push_reason(&mut reasons, DecisionReason::InsufficientStrength);
    }
    push_reason(&mut reasons, DecisionReason::ResearchOnlyMode);

    let signal_allowed = !reasons.iter().any(|reason| {
        matches!(
            reason,
            DecisionReason::HighCost
                | DecisionReason::LowLiquidity
                | DecisionReason::NeutralSignal
                | DecisionReason::InsufficientStrength
        )
    });

    SignalDecision {
        packet,
        signal_allowed,
        trade_allowed: false,
        summary: if signal_allowed {
            "research signal only; trade execution is disabled in phase 3".to_string()
        } else {
            "signal rejected for research decision gates".to_string()
        },
        reasons,
    }
}

fn push_reason(reasons: &mut Vec<DecisionReason>, reason: DecisionReason) {
    if !reasons.contains(&reason) {
        reasons.push(reason);
    }
}

#[cfg(test)]
mod tests {
    use domain::{
        CostEstimate, FeatureSnapshot, FundingRegime, LiquidityMetrics, Price, Quantity, Symbol,
    };
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn high_cost_rejects_signal() {
        let snapshot = sample_snapshot(dec!(10), FundingRegime::Positive, dec!(1.0), dec!(60));

        let decision = evaluate_snapshot(&snapshot);

        assert!(!decision.signal_allowed);
        assert!(!decision.trade_allowed);
        assert!(decision.reasons.contains(&DecisionReason::HighCost));
    }

    #[test]
    fn low_liquidity_rejects_signal() {
        let snapshot = sample_snapshot(dec!(10), FundingRegime::Positive, dec!(0.10), dec!(10));

        let decision = evaluate_snapshot(&snapshot);

        assert!(!decision.signal_allowed);
        assert!(decision.reasons.contains(&DecisionReason::LowLiquidity));
    }

    #[test]
    fn neutral_signal_defaults_to_no_trade() {
        let snapshot = sample_snapshot(dec!(0), FundingRegime::Neutral, dec!(0.80), dec!(10));

        let decision = evaluate_snapshot(&snapshot);

        assert_eq!(decision.packet.direction, SignalDirection::Neutral);
        assert!(!decision.signal_allowed);
        assert!(!decision.trade_allowed);
        assert!(decision.reasons.contains(&DecisionReason::NeutralSignal));
    }

    #[test]
    fn a_plus_signal_still_cannot_trade_in_research_only_mode() {
        let snapshot = sample_snapshot(
            dec!(100),
            FundingRegime::StronglyPositive,
            dec!(1.0),
            dec!(1),
        );

        let decision = evaluate_snapshot(&snapshot);

        assert_eq!(decision.packet.grade, domain::SignalGrade::APlus);
        assert!(decision.signal_allowed);
        assert!(!decision.trade_allowed);
        assert!(decision.reasons.contains(&DecisionReason::ResearchOnlyMode));
    }

    fn sample_snapshot(
        premium_bps: rust_decimal::Decimal,
        funding_regime: FundingRegime,
        liquidity_score: rust_decimal::Decimal,
        total_cost_bps: rust_decimal::Decimal,
    ) -> FeatureSnapshot {
        FeatureSnapshot {
            exchange: "test".to_string(),
            symbol: Symbol::new("BTCUSDT").unwrap(),
            mark_price: Price::new(dec!(101)).unwrap(),
            index_price: Price::new(dec!(100)).unwrap(),
            premium: dec!(1),
            premium_bps,
            funding_rate: dec!(0.0002),
            funding_regime,
            open_interest: Quantity::new(dec!(1000)).unwrap(),
            liquidity: LiquidityMetrics {
                spread_bps: dec!(2),
                bid_depth_5bps: dec!(10000),
                ask_depth_5bps: dec!(10000),
                bid_depth_10bps: dec!(20000),
                ask_depth_10bps: dec!(20000),
                imbalance: dec!(0),
                liquidity_score,
            },
            cost: CostEstimate {
                round_trip_fee_bps: dec!(8),
                spread_bps: dec!(2),
                slippage_bps: dec!(0),
                estimated_total_cost_bps: total_cost_bps,
            },
        }
    }
}
