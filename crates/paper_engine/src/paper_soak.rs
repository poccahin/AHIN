use std::path::Path;

use domain::{
    AppError, AppResult, FeatureSnapshot, FeatureWindow, GodTurnpointConfig, PaperEngineState,
    PaperSoakConfig, PaperSoakErrorReason, PaperSoakReport,
};

use crate::{paper_loop, paper_state, soak_report};

pub fn run_snapshots(
    snapshots: &[FeatureSnapshot],
    config: &PaperSoakConfig,
) -> AppResult<PaperSoakReport> {
    paper_state::ensure_local_file_path(Path::new(&config.state_path))?;
    paper_state::ensure_local_file_path(Path::new(&config.log_path))?;
    let mut state = paper_state::load_or_default(&config.state_path)?;
    paper_state::ensure_trade_log(&config.log_path)?;
    paper_state::persist_state(&config.state_path, &state)?;
    let mut metrics = soak_report::PaperSoakRunMetrics {
        paper_equity_start: state.account_equity_usdt,
        paper_equity_end: state.account_equity_usdt,
        ..Default::default()
    };

    let mut ticks_processed = 0_u64;
    let mut candidate_generated_count = 0_u64;
    let mut errors_count = 0_u64;
    let god_config = GodTurnpointConfig::default();
    let mut feature_window = FeatureWindow::new(god_config.feature_window_len);

    for snapshot in snapshots.iter().take(config.ticks as usize) {
        let before = StateStructuralFingerprint::from_state(&state);
        match paper_loop::process_snapshot_with_yi(
            &mut state,
            snapshot,
            &mut feature_window,
            false,
            rust_decimal::Decimal::ONE,
        ) {
            Ok(outcome) => {
                ticks_processed += 1;
                let mut tick_had_error = false;
                let safe_candidate_generated =
                    soak_report::is_audit_only_candidate_generated(&outcome.candidate_decision);
                if safe_candidate_generated {
                    candidate_generated_count += 1;
                }
                if let Some(trade) = &outcome.trade
                    && let Err(err) = paper_state::append_trade(&config.log_path, trade)
                {
                    tick_had_error = true;
                    errors_count += 1;
                    record_loop_error(
                        &mut metrics,
                        PaperSoakErrorReason::StatePersistenceError,
                        err,
                        before != StateStructuralFingerprint::from_state(&state),
                    );
                }
                if let Err(err) = paper_state::persist_state(&config.state_path, &state) {
                    tick_had_error = true;
                    errors_count += 1;
                    record_loop_error(
                        &mut metrics,
                        PaperSoakErrorReason::StatePersistenceError,
                        err,
                        before != StateStructuralFingerprint::from_state(&state),
                    );
                }
                let state_mutated = before != StateStructuralFingerprint::from_state(&state);
                let state_mutated_without_candidate_or_fill =
                    state_mutated && !safe_candidate_generated && outcome.trade.is_none();
                metrics.record_decision(soak_report::PaperSoakDecisionInput {
                    signal_decision: &outcome.signal_decision,
                    risk_decision: &outcome.risk_decision,
                    candidate_decision: &outcome.candidate_decision,
                    god_turnpoint_decision: Some(&outcome.god_turnpoint_decision),
                    edge_after_cost_ratio: Some(
                        outcome.god_turnpoint_decision.edge_after_cost_ratio,
                    ),
                    paper_fill_generated: outcome.trade.is_some(),
                    state_mutated,
                    state_mutated_without_candidate_or_fill,
                    degraded_market_data: false,
                });
                if !tick_had_error {
                    metrics.record_fresh_market_data_tick();
                }
            }
            Err(err) => {
                errors_count += 1;
                record_loop_error(
                    &mut metrics,
                    soak_report::classify_loop_error(&err),
                    err,
                    before != StateStructuralFingerprint::from_state(&state),
                );
            }
        }
    }
    metrics.paper_equity_end = state.account_equity_usdt;
    metrics.duration_seconds = config
        .interval_seconds
        .saturating_mul(ticks_processed.saturating_sub(1));

    Ok(finalize_report_with_metrics(
        config,
        ticks_processed,
        candidate_generated_count,
        errors_count,
        metrics,
    ))
}

fn record_loop_error(
    metrics: &mut soak_report::PaperSoakRunMetrics,
    reason: PaperSoakErrorReason,
    err: AppError,
    state_mutated: bool,
) {
    metrics.record_loop_error(soak_report::PaperSoakLoopErrorInput {
        reason,
        message: err.to_string(),
        state_mutated,
    });
}

pub fn finalize_report(
    config: &PaperSoakConfig,
    ticks_processed: u64,
    candidate_generated_count: u64,
    errors_count: u64,
) -> PaperSoakReport {
    finalize_report_with_metrics(
        config,
        ticks_processed,
        candidate_generated_count,
        errors_count,
        soak_report::PaperSoakRunMetrics::default(),
    )
}

pub fn finalize_report_with_metrics(
    config: &PaperSoakConfig,
    ticks_processed: u64,
    candidate_generated_count: u64,
    errors_count: u64,
    metrics: soak_report::PaperSoakRunMetrics,
) -> PaperSoakReport {
    let report = soak_report::build_soak_report_with_metrics(
        config,
        ticks_processed,
        candidate_generated_count,
        errors_count,
        &metrics,
    );
    soak_report::persist_report_if_configured(config, report)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StateStructuralFingerprint {
    trades_count: u64,
    positions: Vec<String>,
    realized_pnl_usdt: String,
    total_fees_usdt: String,
}

impl StateStructuralFingerprint {
    pub fn from_state(state: &PaperEngineState) -> Self {
        Self {
            trades_count: state.trades_count,
            positions: state
                .positions
                .iter()
                .map(|position| {
                    format!(
                        "{}::{}::{:?}::{}::{}::{}::{}",
                        position.position_id,
                        position.symbol.as_str(),
                        position.direction,
                        position.entry_price,
                        position.notional,
                        position.quantity,
                        position.opened_at_tick
                    )
                })
                .collect(),
            realized_pnl_usdt: state.realized_pnl_usdt.to_string(),
            total_fees_usdt: state.total_fees_usdt.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use domain::{
        CostEstimate, FeatureSnapshot, FundingRegime, LiquidityMetrics, PaperSoakConfig, Price,
        Quantity, Symbol,
    };
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn clean_paper_run_passes_soak() {
        let config = config("clean_run");
        let report = run_snapshots(
            &[passing_snapshot(dec!(100)), rejected_snapshot(dec!(101))],
            &config,
        )
        .unwrap();

        assert!(report.soak_passed);
        assert!(report.state_valid);
        assert!(report.paper_log_valid);
        assert_eq!(report.ticks_processed, 2);
        cleanup(&config);
    }

    #[test]
    fn low_quality_smoke_report_generates_zero_candidates() {
        let config = config("low_quality_smoke");
        let report = run_snapshots(
            &[
                rejected_snapshot(dec!(100)),
                rejected_snapshot(dec!(100.2)),
                rejected_snapshot(dec!(99.8)),
            ],
            &config,
        )
        .unwrap();

        assert!(report.soak_passed);
        assert_eq!(report.ticks_processed, 3);
        assert_eq!(report.candidate_decisions_evaluated, 3);
        assert_eq!(report.candidate_generated_count, 0);
        assert_eq!(report.candidate_pressure_ratio, dec!(0));
        assert_eq!(report.paper_trades_count, 0);
        assert_eq!(report.open_positions_count, 0);
        assert!(report.blockers.is_empty());
        assert!(!report.rejection_breakdown_by_reason.is_empty());
        assert!(
            report
                .warnings
                .iter()
                .any(|warning| warning.code == "zero_paper_trades")
        );
        cleanup(&config);
    }

    #[test]
    fn c_grade_signal_records_yi_observe_and_god_blockers() {
        let config = config("yi_observe");
        let report = run_snapshots(&[rejected_snapshot(dec!(100))], &config).unwrap();

        assert_eq!(report.god_turnpoint_evaluated_count, 1);
        assert_eq!(report.god_turnpoint_allowed_count, 0);
        assert_eq!(report.yi_action_bias_distribution["observe"], 1);
        assert_eq!(
            report.god_turnpoint_blocker_breakdown["signal_grade_not_a_plus"],
            1
        );
        assert_eq!(report.god_signal_pressure_ratio, dec!(0));
        cleanup(&config);
    }

    #[test]
    fn a_plus_mock_signal_can_increment_god_turnpoint_allowed_count() {
        let config = config("god_allowed");
        let report = run_snapshots(&[passing_snapshot(dec!(100))], &config).unwrap();

        assert_eq!(report.god_turnpoint_evaluated_count, 1);
        assert_eq!(report.god_turnpoint_allowed_count, 1);
        assert_eq!(report.god_signal_pressure_ratio, dec!(1));
        assert_eq!(report.candidate_generated_count, 1);
        assert!(report.soak_passed);
        cleanup(&config);
    }

    #[test]
    fn god_signal_pressure_ratio_is_deterministic() {
        let first_config = config("god_pressure_first");
        let second_config = config("god_pressure_second");
        let snapshots = [passing_snapshot(dec!(100)), rejected_snapshot(dec!(101))];

        let first = run_snapshots(&snapshots, &first_config).unwrap();
        let second = run_snapshots(&snapshots, &second_config).unwrap();

        assert_eq!(
            first.god_signal_pressure_ratio,
            second.god_signal_pressure_ratio
        );
        assert_eq!(first.god_signal_pressure_ratio, dec!(0.5));
        cleanup(&first_config);
        cleanup(&second_config);
    }

    #[test]
    fn zero_god_signals_warns_only() {
        let config = config("zero_god_warning");
        let report = run_snapshots(
            &[rejected_snapshot(dec!(100)), rejected_snapshot(dec!(101))],
            &config,
        )
        .unwrap();

        assert!(report.soak_passed);
        assert_eq!(report.god_turnpoint_allowed_count, 0);
        assert!(
            report
                .warnings
                .iter()
                .any(|warning| warning.code == "zero_god_turnpoints")
        );
        assert!(report.blockers.is_empty());
        cleanup(&config);
    }

    #[test]
    fn yi_veto_prevents_candidate_generation() {
        let mut state = PaperEngineState::default();
        let outcome = paper_loop::process_snapshot(&mut state, &kan_risk_snapshot(dec!(100)))
            .expect("paper tick should evaluate without live order capability");

        assert!(outcome.signal_decision.signal_allowed);
        assert!(outcome.risk_decision.risk_allowed);
        assert!(!outcome.god_turnpoint_decision.god_turnpoint_allowed);
        assert!(!outcome.candidate_decision.candidate_generated);
        assert!(outcome.trade.is_none());
        assert!(state.positions.is_empty());
    }

    #[test]
    fn yi_layer_cannot_turn_rejected_signal_into_candidate() {
        let mut state = PaperEngineState::default();
        let outcome = paper_loop::process_snapshot(&mut state, &rejected_snapshot(dec!(100)))
            .expect("rejected signal remains research-only");

        assert!(!outcome.signal_decision.signal_allowed);
        assert!(!outcome.god_turnpoint_decision.god_turnpoint_allowed);
        assert!(!outcome.candidate_decision.candidate_generated);
        assert!(outcome.trade.is_none());
    }

    #[test]
    fn degraded_market_data_records_yi_diagnostics_and_blocks_god_turnpoint() {
        let config = config("degraded_yi");
        paper_state::ensure_local_file_path(std::path::Path::new(&config.state_path)).unwrap();
        paper_state::ensure_local_file_path(std::path::Path::new(&config.log_path)).unwrap();
        paper_state::persist_state(&config.state_path, &PaperEngineState::default()).unwrap();
        paper_state::ensure_trade_log(&config.log_path).unwrap();
        let state = PaperEngineState::default();
        let god_config = GodTurnpointConfig::default();
        let mut window = FeatureWindow::new(god_config.feature_window_len);
        let snapshot = passing_snapshot(dec!(100));
        let (signal_decision, risk_decision, god_turnpoint_decision, candidate_decision) =
            paper_loop::evaluate_snapshot_decisions(&state, &snapshot, &mut window, true, dec!(1));
        let mut metrics = soak_report::PaperSoakRunMetrics {
            paper_equity_start: dec!(200),
            paper_equity_end: dec!(200),
            ..Default::default()
        };
        metrics.record_decision(soak_report::PaperSoakDecisionInput {
            signal_decision: &signal_decision,
            risk_decision: &risk_decision,
            god_turnpoint_decision: Some(&god_turnpoint_decision),
            candidate_decision: &candidate_decision,
            edge_after_cost_ratio: Some(god_turnpoint_decision.edge_after_cost_ratio),
            paper_fill_generated: false,
            state_mutated: false,
            state_mutated_without_candidate_or_fill: false,
            degraded_market_data: true,
        });

        let report = finalize_report_with_metrics(&config, 1, 0, 0, metrics);

        assert_eq!(report.degraded_yi_evaluation_count, 1);
        assert_eq!(report.god_turnpoint_allowed_count, 0);
        assert_eq!(
            report.god_turnpoint_blocker_breakdown["degraded_market_data"],
            1
        );
        assert!(!candidate_decision.candidate_generated);
        assert!(report.soak_passed);
        cleanup(&config);
    }

    #[test]
    fn paper_soak_remains_safe_with_no_executable_order_id() {
        let config = config("god_safe_log");
        let report = run_snapshots(&[passing_snapshot(dec!(100))], &config).unwrap();
        let raw_log = fs::read_to_string(&config.log_path).unwrap();

        assert!(report.paper_log_valid);
        assert!(raw_log.contains("\"executable\":false"));
        assert!(raw_log.contains("\"real_order_id\":null"));
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
            funding_rate: dec!(-0.0002),
            funding_regime: FundingRegime::StronglyNegative,
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
            premium: dec!(0),
            premium_bps: dec!(0),
            funding_rate: dec!(0),
            funding_regime: FundingRegime::Neutral,
            ..passing_snapshot(mark_price)
        }
    }

    fn kan_risk_snapshot(mark_price: rust_decimal::Decimal) -> FeatureSnapshot {
        FeatureSnapshot {
            funding_rate: dec!(0.0008),
            funding_regime: FundingRegime::StronglyPositive,
            ..passing_snapshot(mark_price)
        }
    }

    fn config(name: &str) -> PaperSoakConfig {
        let base = std::env::temp_dir().join(format!(
            "rustquanteth-paper-soak-{name}-{}",
            std::process::id()
        ));
        PaperSoakConfig {
            ticks: 10,
            interval_seconds: 0,
            state_path: base.join("paper_state.json").display().to_string(),
            log_path: base.join("paper_trades.jsonl").display().to_string(),
            ..Default::default()
        }
    }

    fn cleanup(config: &PaperSoakConfig) {
        let _ = fs::remove_file(&config.state_path);
        let _ = fs::remove_file(&config.log_path);
        if let Some(parent) = PathBuf::from(&config.state_path).parent() {
            let _ = fs::remove_dir(parent);
        }
    }
}
