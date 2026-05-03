use std::path::Path;

use domain::{AppResult, FeatureSnapshot, PaperSoakConfig, PaperSoakReport};

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

    let mut ticks_processed = 0;
    let mut candidate_generated_count = 0;
    let mut errors_count = 0;

    for snapshot in snapshots.iter().take(config.ticks as usize) {
        match paper_loop::process_snapshot(&mut state, snapshot) {
            Ok(outcome) => {
                ticks_processed += 1;
                if outcome.tick.candidate_generated {
                    candidate_generated_count += 1;
                }
                let append_failed = outcome.trade.as_ref().is_some_and(|trade| {
                    paper_state::append_trade(&config.log_path, trade).is_err()
                });
                if append_failed {
                    errors_count += 1;
                }
                if paper_state::persist_state(&config.state_path, &state).is_err() {
                    errors_count += 1;
                }
            }
            Err(_) => errors_count += 1,
        }
    }

    Ok(finalize_report(
        config,
        ticks_processed,
        candidate_generated_count,
        errors_count,
    ))
}

pub fn finalize_report(
    config: &PaperSoakConfig,
    ticks_processed: u64,
    candidate_generated_count: u64,
    errors_count: u64,
) -> PaperSoakReport {
    soak_report::build_soak_report(
        config,
        ticks_processed,
        candidate_generated_count,
        errors_count,
    )
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
            premium: dec!(0),
            premium_bps: dec!(0),
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
