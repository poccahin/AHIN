use domain::{
    FeatureDelta, FeatureSnapshot, FeatureWindow, SignalDecision, SignalDirection,
    TurnpointEvidence,
};
use rust_decimal::Decimal;

pub fn compute_feature_delta(
    window: &FeatureWindow,
    previous_signal: Option<&SignalDecision>,
    current_signal: &SignalDecision,
    data_freshness_score: Decimal,
) -> FeatureDelta {
    let Some(first) = window.snapshots.front() else {
        return FeatureDelta {
            data_freshness_stability: data_freshness_score,
            ..FeatureDelta::default()
        };
    };
    let Some(last) = window.snapshots.back() else {
        return FeatureDelta {
            data_freshness_stability: data_freshness_score,
            ..FeatureDelta::default()
        };
    };
    let intervals = Decimal::from(window.snapshots.len().saturating_sub(1).max(1) as u64);
    let previous_strength = previous_signal
        .map(|signal| signal.packet.final_strength)
        .unwrap_or(current_signal.packet.final_strength);
    let previous_direction = previous_signal
        .map(|signal| signal.packet.direction)
        .unwrap_or_else(|| infer_direction(first));

    FeatureDelta {
        signal_strength_slope: (current_signal.packet.final_strength - previous_strength)
            / intervals,
        premium_bps_slope: (last.premium_bps - first.premium_bps) / intervals,
        funding_rate_slope: (last.funding_rate - first.funding_rate) / intervals,
        liquidity_score_slope: (last.liquidity.liquidity_score - first.liquidity.liquidity_score)
            / intervals,
        cost_bps_slope: (last.cost.estimated_total_cost_bps - first.cost.estimated_total_cost_bps)
            / intervals,
        mark_price_return: mark_price_return(first, last),
        direction_transition: direction_transition(
            previous_direction,
            current_signal.packet.direction,
        ),
        data_freshness_stability: data_freshness_score,
    }
}

pub fn compute_turnpoint_evidence(delta: FeatureDelta) -> TurnpointEvidence {
    let mut positive_count = 0_u64;
    let mut negative_count = 0_u64;

    if delta.signal_strength_slope > Decimal::ZERO {
        positive_count += 1;
    } else if delta.signal_strength_slope < Decimal::ZERO {
        negative_count += 1;
    }
    if delta.liquidity_score_slope > Decimal::ZERO {
        positive_count += 1;
    } else if delta.liquidity_score_slope < Decimal::ZERO {
        negative_count += 1;
    }
    if delta.cost_bps_slope < Decimal::ZERO {
        positive_count += 1;
    } else if delta.cost_bps_slope > Decimal::ZERO {
        negative_count += 1;
    }
    if delta.mark_price_return.abs() >= Decimal::new(5, 3) {
        positive_count += 1;
    }
    if delta.data_freshness_stability < Decimal::new(98, 2) {
        negative_count += 1;
    }

    let score = (Decimal::from(positive_count) * Decimal::from(20)
        - Decimal::from(negative_count) * Decimal::from(15))
    .clamp(Decimal::ZERO, Decimal::from(100));
    let summary = format!(
        "turnpoint evidence: positive={positive_count}, negative={negative_count}, score={score}"
    );

    TurnpointEvidence {
        delta,
        positive_count,
        negative_count,
        score,
        summary,
    }
}

fn mark_price_return(first: &FeatureSnapshot, last: &FeatureSnapshot) -> Decimal {
    let first_price = first.mark_price.as_decimal();
    if first_price <= Decimal::ZERO {
        return Decimal::ZERO;
    }
    (last.mark_price.as_decimal() - first_price) / first_price
}

fn infer_direction(snapshot: &FeatureSnapshot) -> SignalDirection {
    if snapshot.premium_bps > Decimal::from(5) {
        SignalDirection::Long
    } else if snapshot.premium_bps < Decimal::from(-5) {
        SignalDirection::Short
    } else {
        SignalDirection::Neutral
    }
}

fn direction_transition(previous: SignalDirection, current: SignalDirection) -> String {
    format!("{previous:?}_to_{current:?}").to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use domain::{
        CostEstimate, DecisionReason, FundingRegime, LiquidityMetrics, MarketRegime, Price,
        Quantity, SignalGrade, SignalPacket, Symbol,
    };
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn feature_window_computes_deterministic_slopes() {
        let mut window = FeatureWindow::new(3);
        window.push(snapshot(
            dec!(100),
            dec!(10),
            dec!(0.0001),
            dec!(0.5),
            dec!(20),
        ));
        window.push(snapshot(
            dec!(105),
            dec!(20),
            dec!(0.0003),
            dec!(0.7),
            dec!(10),
        ));
        let previous = signal(dec!(60), SignalDirection::Long);
        let current = signal(dec!(80), SignalDirection::Short);

        let delta = compute_feature_delta(&window, Some(&previous), &current, dec!(0.99));

        assert_eq!(delta.signal_strength_slope, dec!(20));
        assert_eq!(delta.premium_bps_slope, dec!(10));
        assert_eq!(delta.funding_rate_slope, dec!(0.0002));
        assert_eq!(delta.liquidity_score_slope, dec!(0.2));
        assert_eq!(delta.cost_bps_slope, dec!(-10));
        assert_eq!(delta.mark_price_return, dec!(0.05));
        assert_eq!(delta.direction_transition, "long_to_short");
        assert_eq!(delta.data_freshness_stability, dec!(0.99));
    }

    fn signal(strength: Decimal, direction: SignalDirection) -> SignalDecision {
        SignalDecision {
            packet: SignalPacket {
                exchange: "test".to_string(),
                symbol: Symbol::new("BTCUSDT").unwrap(),
                direction,
                market_regime: MarketRegime::Neutral,
                price_structure_score: strength,
                derivatives_score: strength,
                funding_score: strength,
                liquidity_score: strength,
                cost_score: strength,
                final_strength: strength,
                grade: SignalGrade::A,
                reasons: vec![DecisionReason::ResearchOnlyMode],
            },
            signal_allowed: true,
            trade_allowed: false,
            reasons: vec![DecisionReason::ResearchOnlyMode],
            summary: "test".to_string(),
        }
    }

    fn snapshot(
        mark: Decimal,
        premium_bps: Decimal,
        funding_rate: Decimal,
        liquidity_score: Decimal,
        cost_bps: Decimal,
    ) -> FeatureSnapshot {
        FeatureSnapshot {
            exchange: "test".to_string(),
            symbol: Symbol::new("BTCUSDT").unwrap(),
            mark_price: Price::new(mark).unwrap(),
            index_price: Price::new(mark).unwrap(),
            premium: Decimal::ZERO,
            premium_bps,
            funding_rate,
            funding_regime: FundingRegime::Neutral,
            open_interest: Quantity::new(dec!(1000)).unwrap(),
            liquidity: LiquidityMetrics {
                spread_bps: dec!(1),
                bid_depth_5bps: dec!(1000),
                ask_depth_5bps: dec!(1000),
                bid_depth_10bps: dec!(2000),
                ask_depth_10bps: dec!(2000),
                imbalance: Decimal::ZERO,
                liquidity_score,
            },
            cost: CostEstimate {
                round_trip_fee_bps: dec!(8),
                spread_bps: dec!(1),
                slippage_bps: dec!(1),
                estimated_total_cost_bps: cost_bps,
            },
        }
    }
}
