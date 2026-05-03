use domain::{AppResult, CostEstimate, DryRunOrderCandidate, MarketEvent, SimulatedTrade};

use crate::{fee_sim, pnl_simulator};

pub fn simulate_trade(
    candidate: &DryRunOrderCandidate,
    entry_event: &MarketEvent,
    exit_event: &MarketEvent,
    cost: &CostEstimate,
) -> AppResult<SimulatedTrade> {
    let entry_price = entry_event.mark_price;
    let exit_price = exit_event.mark_price;
    let gross_pnl = pnl_simulator::gross_pnl(
        candidate.direction,
        entry_price,
        exit_price,
        candidate.notional,
    );
    let fees = fee_sim::simulated_fee(candidate.notional, cost.estimated_total_cost_bps);

    Ok(SimulatedTrade {
        entry_sequence: entry_event.sequence,
        exit_sequence: exit_event.sequence,
        symbol: candidate.symbol.clone(),
        direction: candidate.direction,
        entry_price,
        exit_price,
        notional: candidate.notional,
        gross_pnl_usdt: gross_pnl,
        fees_usdt: fees,
        net_pnl_usdt: gross_pnl - fees,
        executable: false,
        real_order_id: None,
    })
}

#[cfg(test)]
mod tests {
    use domain::{MarketEvent, MarketEventLevel, SignalDirection, Symbol};
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn fees_reduce_gross_pnl() {
        let candidate = candidate();
        let trade = simulate_trade(
            &candidate,
            &event(1, dec!(100)),
            &event(2, dec!(101)),
            &CostEstimate {
                round_trip_fee_bps: dec!(8),
                spread_bps: dec!(2),
                slippage_bps: dec!(0),
                estimated_total_cost_bps: dec!(10),
            },
        )
        .unwrap();

        assert!(trade.gross_pnl_usdt > trade.net_pnl_usdt);
        assert_eq!(trade.fees_usdt, dec!(0.060));
    }

    #[test]
    fn no_executable_order_id_is_ever_produced() {
        let candidate = candidate();
        let trade = simulate_trade(
            &candidate,
            &event(1, dec!(100)),
            &event(2, dec!(101)),
            &CostEstimate {
                round_trip_fee_bps: dec!(8),
                spread_bps: dec!(2),
                slippage_bps: dec!(0),
                estimated_total_cost_bps: dec!(10),
            },
        )
        .unwrap();

        assert!(!trade.executable);
        assert!(trade.real_order_id.is_none());
    }

    fn candidate() -> DryRunOrderCandidate {
        DryRunOrderCandidate {
            candidate_id: "audit-test".to_string(),
            exchange: "offline".to_string(),
            symbol: Symbol::new("BTCUSDT").unwrap(),
            direction: SignalDirection::Long,
            reference_price: domain::Price::new(dec!(100)).unwrap(),
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

    fn event(sequence: u64, mark_price: rust_decimal::Decimal) -> MarketEvent {
        MarketEvent {
            sequence,
            timestamp_ms: sequence,
            exchange: "offline".to_string(),
            symbol: Symbol::new("BTCUSDT").unwrap(),
            mark_price,
            index_price: mark_price,
            funding_rate: dec!(0),
            open_interest: dec!(1000),
            bid_levels: vec![MarketEventLevel {
                price: mark_price - dec!(0.01),
                quantity: dec!(100),
            }],
            ask_levels: vec![MarketEventLevel {
                price: mark_price + dec!(0.01),
                quantity: dec!(100),
            }],
        }
    }
}
