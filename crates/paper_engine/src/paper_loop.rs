use std::time::{SystemTime, UNIX_EPOCH};

use domain::{
    AccountRiskState, AppError, AppResult, CandidateSizingConfig, ExposureState, FeatureSnapshot,
    OrderCandidateDecision, PaperEngineState, PaperRunConfig, PaperRunReport, PaperTick,
    PaperTrade, RiskBudgetConfig, RiskBudgetDecision, SignalDecision,
};
use execution_engine::candidate_decision;
use risk_engine::risk_decision;
use rust_decimal::Decimal;
use signal_engine::signal_decision;

use crate::{paper_fill, paper_report, paper_state};

#[derive(Debug, Clone, PartialEq)]
pub struct PaperTickOutcome {
    pub tick: PaperTick,
    pub trade: Option<PaperTrade>,
    pub signal_decision: SignalDecision,
    pub risk_decision: RiskBudgetDecision,
    pub candidate_decision: OrderCandidateDecision,
}

pub fn run_snapshots(
    snapshots: &[FeatureSnapshot],
    config: &PaperRunConfig,
) -> AppResult<PaperRunReport> {
    paper_state::ensure_local_file_path(std::path::Path::new(&config.state_path))?;
    paper_state::ensure_local_file_path(std::path::Path::new(&config.log_path))?;
    let mut state = paper_state::load_or_default(&config.state_path)?;
    paper_state::ensure_trade_log(&config.log_path)?;
    let mut ticks_processed = 0;
    let mut fills_generated = 0;
    let mut rejected_candidates = 0;

    for snapshot in snapshots.iter().take(config.ticks as usize) {
        let outcome = process_snapshot(&mut state, snapshot)?;
        ticks_processed += 1;
        if let Some(trade) = &outcome.trade {
            paper_state::append_trade(&config.log_path, trade)?;
            fills_generated += 1;
        } else {
            rejected_candidates += 1;
        }
        paper_state::persist_state(&config.state_path, &state)?;
    }

    Ok(paper_report::build_report(
        config,
        state,
        ticks_processed,
        fills_generated,
        rejected_candidates,
    ))
}

pub fn process_snapshot(
    state: &mut PaperEngineState,
    snapshot: &FeatureSnapshot,
) -> AppResult<PaperTickOutcome> {
    paper_state::mark_positions(state, &snapshot.symbol, snapshot.mark_price.as_decimal());

    let signal_decision = signal_decision::evaluate_snapshot(snapshot);
    let risk_decision = risk_decision::evaluate_risk_budget(
        signal_decision.clone(),
        account_risk_state(state),
        RiskBudgetConfig::default(),
    );
    let candidate_decision = candidate_decision::evaluate_order_candidate(
        snapshot,
        signal_decision.clone(),
        risk_decision.clone(),
        CandidateSizingConfig::default(),
    );

    let tick = PaperTick {
        tick_id: state.ticks_processed + 1,
        timestamp_ms: now_ms()?,
        exchange: snapshot.exchange.clone(),
        symbol: snapshot.symbol.clone(),
        mark_price: snapshot.mark_price.as_decimal(),
        signal_allowed: signal_decision.signal_allowed,
        risk_allowed: risk_decision.risk_allowed,
        candidate_generated: candidate_decision.candidate_generated,
    };

    let trade = match candidate_decision.candidate.as_ref() {
        Some(candidate)
            if !paper_state::has_open_position(state, &candidate.symbol, candidate.direction) =>
        {
            let trade = paper_fill::build_paper_fill(&tick, candidate, snapshot)?;
            paper_state::apply_trade(state, trade.clone());
            Some(trade)
        }
        None => None,
        Some(_) => None,
    };

    state.ticks_processed = tick.tick_id;
    state.last_tick = Some(tick.clone());

    Ok(PaperTickOutcome {
        tick,
        trade,
        signal_decision,
        risk_decision,
        candidate_decision,
    })
}

fn account_risk_state(state: &PaperEngineState) -> AccountRiskState {
    AccountRiskState {
        equity: state.account_equity_usdt,
        realized_pnl_today: state.realized_pnl_usdt,
        realized_pnl_week: state.realized_pnl_usdt,
        exposure: ExposureState {
            gross_notional: state
                .positions
                .iter()
                .map(|position| position.notional.abs())
                .sum::<Decimal>(),
            liquidation_buffer_bps: None,
        },
        research_only: true,
    }
}

fn now_ms() -> AppResult<u64> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| AppError::Config(format!("system time before unix epoch: {err}")))?;
    Ok(duration.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use domain::{
        CostEstimate, FeatureSnapshot, FundingRegime, LiquidityMetrics, PaperRunConfig, Price,
        Quantity, Symbol,
    };
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn paper_loop_with_mock_snapshots_updates_ticks_processed() {
        let config = config("updates_ticks");
        let report = run_snapshots(
            &[
                passing_snapshot(dec!(100)),
                passing_snapshot(dec!(101)),
                rejected_snapshot(dec!(101)),
            ],
            &config,
        )
        .unwrap();

        assert_eq!(report.ticks_processed, 3);
        cleanup(&config);
    }

    #[test]
    fn candidate_rejection_does_not_open_paper_position() {
        let config = config("candidate_rejection");
        let report = run_snapshots(&[rejected_snapshot(dec!(100))], &config).unwrap();

        assert_eq!(report.fills_generated, 0);
        assert_eq!(report.final_state.positions.len(), 0);
        cleanup(&config);
    }

    #[test]
    fn paper_pnl_updates_deterministically() {
        let config = config("deterministic_pnl");
        let report = run_snapshots(
            &[passing_snapshot(dec!(100)), rejected_snapshot(dec!(101))],
            &config,
        )
        .unwrap();

        assert_eq!(report.final_state.positions.len(), 1);
        assert_eq!(
            report.final_state.positions[0].unrealized_pnl_usdt,
            dec!(0.6)
        );
        assert!(report.final_state.account_equity_usdt > dec!(200));
        cleanup(&config);
    }

    fn passing_snapshot(mark_price: rust_decimal::Decimal) -> FeatureSnapshot {
        FeatureSnapshot {
            exchange: "test".to_string(),
            symbol: Symbol::new("BTCUSDT").unwrap(),
            mark_price: Price::new(mark_price).unwrap(),
            index_price: Price::new(mark_price - dec!(1)).unwrap(),
            premium: dec!(1),
            premium_bps: dec!(100),
            funding_rate: dec!(0),
            funding_regime: FundingRegime::Neutral,
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

    fn rejected_snapshot(mark_price: rust_decimal::Decimal) -> FeatureSnapshot {
        FeatureSnapshot {
            premium_bps: dec!(0),
            premium: dec!(0),
            funding_rate: dec!(0),
            funding_regime: FundingRegime::Neutral,
            ..passing_snapshot(mark_price)
        }
    }

    fn config(name: &str) -> PaperRunConfig {
        let base =
            std::env::temp_dir().join(format!("rustquanteth-paper-{name}-{}", std::process::id()));
        PaperRunConfig {
            ticks: 10,
            interval_seconds: 0,
            state_path: base.join("paper_state.json").display().to_string(),
            log_path: base.join("paper_trades.jsonl").display().to_string(),
        }
    }

    fn cleanup(config: &PaperRunConfig) {
        let _ = fs::remove_file(&config.state_path);
        let _ = fs::remove_file(&config.log_path);
        if let Some(parent) = PathBuf::from(&config.state_path).parent() {
            let _ = fs::remove_dir(parent);
        }
    }
}
