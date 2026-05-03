use domain::{
    AccountRiskState, AppResult, BacktestConfig, BacktestReport, CandidateSizingConfig,
    FeatureSnapshot, FundingRate, MarketEvent, OpenInterest, OrderBook, OrderBookLevel, Price,
    Quantity, RiskBudgetConfig, Symbol,
};
use execution_engine::candidate_decision;
use feature_engine::snapshot;
use risk_engine::risk_decision;
use signal_engine::signal_decision;

use crate::{report, simulated_fill};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplayEvent {
    pub sequence: u64,
    pub kind: String,
}

pub fn events_are_ordered(events: &[ReplayEvent]) -> bool {
    events
        .windows(2)
        .all(|pair| pair[0].sequence <= pair[1].sequence)
}

pub fn replay_events(events: &[MarketEvent], config: &BacktestConfig) -> AppResult<BacktestReport> {
    if events.is_empty() {
        return Ok(report::empty_report());
    }

    let mut builder = report::ReportBuilder::new(config.starting_equity_usdt);
    let mut equity = config.starting_equity_usdt;

    for (idx, event) in events.iter().enumerate() {
        let feature_snapshot = feature_snapshot_from_event(event)?;
        let signal_decision = signal_decision::evaluate_snapshot(&feature_snapshot);
        let risk_decision = risk_decision::evaluate_risk_budget(
            signal_decision.clone(),
            AccountRiskState {
                equity,
                realized_pnl_today: equity - config.starting_equity_usdt,
                realized_pnl_week: equity - config.starting_equity_usdt,
                ..Default::default()
            },
            RiskBudgetConfig::default(),
        );
        let candidate_decision = candidate_decision::evaluate_order_candidate(
            &feature_snapshot,
            signal_decision.clone(),
            risk_decision.clone(),
            CandidateSizingConfig::default(),
        );

        let exit_idx = idx
            .saturating_add(config.exit_horizon_events)
            .min(events.len() - 1);
        let trade = match candidate_decision.candidate.as_ref() {
            Some(candidate) => Some(simulated_fill::simulate_trade(
                candidate,
                event,
                &events[exit_idx],
                &feature_snapshot.cost,
            )?),
            None => None,
        };
        if let Some(trade) = &trade {
            equity += trade.net_pnl_usdt;
        }

        builder.record(
            event.sequence,
            &signal_decision,
            &risk_decision,
            &candidate_decision,
            trade,
        );
    }

    Ok(builder.finish())
}

pub fn feature_snapshot_from_event(event: &MarketEvent) -> AppResult<FeatureSnapshot> {
    let symbol = Symbol::new(event.symbol.as_str())?;
    let mark_price = Price::new(event.mark_price)?;
    let index_price = Price::new(event.index_price)?;
    let funding_rate = FundingRate {
        symbol: symbol.clone(),
        rate: event.funding_rate,
        interval_hours: 8,
    };
    let open_interest = OpenInterest {
        symbol: symbol.clone(),
        quantity: Quantity::new(event.open_interest)?,
    };
    let orderbook = OrderBook::from_levels(
        symbol.clone(),
        parse_levels(&event.bid_levels)?,
        parse_levels(&event.ask_levels)?,
    )?;

    snapshot::build_feature_snapshot(
        event.exchange.clone(),
        symbol,
        mark_price,
        index_price,
        funding_rate,
        open_interest,
        orderbook,
    )
}

fn parse_levels(levels: &[domain::MarketEventLevel]) -> AppResult<Vec<OrderBookLevel>> {
    levels
        .iter()
        .map(|level| {
            Ok(OrderBookLevel {
                price: Price::new(level.price)?,
                quantity: Quantity::new(level.quantity)?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use domain::{BacktestConfig, MarketEvent, MarketEventLevel, Symbol};
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn replay_processes_all_events() {
        let events = sample_events();
        let report = replay_events(&events, &BacktestConfig::default()).unwrap();

        assert_eq!(report.events_processed, 3);
    }

    #[test]
    fn backtest_is_deterministic() {
        let events = sample_events();

        let first = replay_events(&events, &BacktestConfig::default()).unwrap();
        let second = replay_events(&events, &BacktestConfig::default()).unwrap();

        assert_eq!(first, second);
    }

    #[test]
    fn rejected_signal_count_is_tracked() {
        let events = vec![neutral_event(1)];
        let report = replay_events(&events, &BacktestConfig::default()).unwrap();

        assert_eq!(report.rejected_by_signal, 1);
    }

    fn sample_events() -> Vec<MarketEvent> {
        vec![
            directional_event(1, dec!(100), dec!(100.2)),
            directional_event(2, dec!(99), dec!(99.1)),
            neutral_event(3),
        ]
    }

    fn directional_event(
        sequence: u64,
        mark: rust_decimal::Decimal,
        index: rust_decimal::Decimal,
    ) -> MarketEvent {
        MarketEvent {
            sequence,
            timestamp_ms: sequence * 60_000,
            exchange: "offline".to_string(),
            symbol: Symbol::new("BTCUSDT").unwrap(),
            mark_price: mark,
            index_price: index,
            funding_rate: dec!(0.0002),
            open_interest: dec!(1000),
            bid_levels: vec![level(mark - dec!(0.01), dec!(500))],
            ask_levels: vec![level(mark + dec!(0.01), dec!(500))],
        }
    }

    fn neutral_event(sequence: u64) -> MarketEvent {
        MarketEvent {
            sequence,
            timestamp_ms: sequence * 60_000,
            exchange: "offline".to_string(),
            symbol: Symbol::new("BTCUSDT").unwrap(),
            mark_price: dec!(100),
            index_price: dec!(100),
            funding_rate: dec!(0),
            open_interest: dec!(1000),
            bid_levels: vec![level(dec!(99.99), dec!(500))],
            ask_levels: vec![level(dec!(100.01), dec!(500))],
        }
    }

    fn level(price: rust_decimal::Decimal, quantity: rust_decimal::Decimal) -> MarketEventLevel {
        MarketEventLevel { price, quantity }
    }
}
