use domain::{
    AppResult, DryRunOrderCandidate, FeatureSnapshot, PaperPosition, PaperTick, PaperTrade,
};
use rust_decimal::Decimal;

pub fn build_paper_fill(
    tick: &PaperTick,
    candidate: &DryRunOrderCandidate,
    snapshot: &FeatureSnapshot,
) -> AppResult<PaperTrade> {
    let price = snapshot.mark_price.as_decimal();
    let quantity = if price <= Decimal::ZERO {
        Decimal::ZERO
    } else {
        candidate.notional / price
    };
    let fees = candidate.notional * snapshot.cost.estimated_total_cost_bps / Decimal::from(10_000);

    Ok(PaperTrade {
        trade_id: format!("paper-{}-{}", tick.tick_id, candidate.candidate_id),
        tick_id: tick.tick_id,
        timestamp_ms: tick.timestamp_ms,
        symbol: candidate.symbol.clone(),
        direction: candidate.direction,
        price,
        notional: candidate.notional,
        quantity,
        fees_usdt: fees,
        realized_pnl_usdt: -fees,
        executable: false,
        real_order_id: None,
        candidate_id: candidate.candidate_id.clone(),
    })
}

pub fn position_from_trade(trade: &PaperTrade) -> PaperPosition {
    PaperPosition {
        position_id: format!("paper-position-{}", trade.trade_id),
        symbol: trade.symbol.clone(),
        direction: trade.direction,
        entry_price: trade.price,
        mark_price: trade.price,
        notional: trade.notional,
        quantity: trade.quantity,
        unrealized_pnl_usdt: Decimal::ZERO,
        opened_at_tick: trade.tick_id,
        candidate_id: trade.candidate_id.clone(),
    }
}

#[cfg(test)]
mod tests {
    use domain::{
        CostEstimate, DryRunOrderCandidate, FeatureSnapshot, FundingRegime, LiquidityMetrics,
        PaperTick, Price, Quantity, SignalDirection, Symbol,
    };
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn paper_fill_has_no_real_order_id() {
        let trade = build_paper_fill(&tick(), &candidate(), &snapshot(dec!(100))).unwrap();

        assert!(trade.real_order_id.is_none());
    }

    #[test]
    fn paper_fill_is_executable_false() {
        let trade = build_paper_fill(&tick(), &candidate(), &snapshot(dec!(100))).unwrap();

        assert!(!trade.executable);
    }

    pub(crate) fn snapshot(mark_price: rust_decimal::Decimal) -> FeatureSnapshot {
        FeatureSnapshot {
            exchange: "test".to_string(),
            symbol: Symbol::new("BTCUSDT").unwrap(),
            mark_price: Price::new(mark_price).unwrap(),
            index_price: Price::new(mark_price - dec!(0.2)).unwrap(),
            premium: dec!(0.2),
            premium_bps: dec!(20),
            funding_rate: dec!(0.0002),
            funding_regime: FundingRegime::Positive,
            open_interest: Quantity::new(dec!(1000)).unwrap(),
            liquidity: LiquidityMetrics {
                spread_bps: dec!(2),
                bid_depth_5bps: dec!(10000),
                ask_depth_5bps: dec!(10000),
                bid_depth_10bps: dec!(20000),
                ask_depth_10bps: dec!(20000),
                imbalance: dec!(0),
                liquidity_score: dec!(1),
            },
            cost: CostEstimate {
                round_trip_fee_bps: dec!(8),
                spread_bps: dec!(2),
                slippage_bps: dec!(0),
                estimated_total_cost_bps: dec!(10),
            },
        }
    }

    pub(crate) fn candidate() -> DryRunOrderCandidate {
        DryRunOrderCandidate {
            candidate_id: "audit-test".to_string(),
            exchange: "test".to_string(),
            symbol: Symbol::new("BTCUSDT").unwrap(),
            direction: SignalDirection::Long,
            reference_price: Price::new(dec!(100)).unwrap(),
            notional: dec!(60),
            margin_required: dec!(30),
            leverage: dec!(2),
            assumed_stop_distance_pct: dec!(0.005),
            max_loss_usdt: dec!(0.8),
            executable: false,
            real_order_id: None,
            audit_only: true,
            reasons: Vec::new(),
        }
    }

    pub(crate) fn tick() -> PaperTick {
        PaperTick {
            tick_id: 1,
            timestamp_ms: 1,
            exchange: "test".to_string(),
            symbol: Symbol::new("BTCUSDT").unwrap(),
            mark_price: dec!(100),
            signal_allowed: true,
            risk_allowed: true,
            candidate_generated: true,
        }
    }
}
