use std::{collections::BTreeMap, fs, path::Path};

use domain::{
    AppError, AppResult, PaperEngineState, PaperSoakBlocker, PaperSoakConfig, PaperSoakReport,
    PaperSoakWarning, PaperTrade,
};
use rust_decimal::Decimal;

use crate::paper_state;

const MIN_TICKS_FOR_CANDIDATE_BLOCKER: u64 = 20;

pub fn build_soak_report(
    config: &PaperSoakConfig,
    ticks_processed: u64,
    candidate_generated_count: u64,
    errors_count: u64,
) -> PaperSoakReport {
    let mut warnings = Vec::new();
    let mut blockers = Vec::new();
    let mut state_valid = false;
    let mut paper_log_valid = false;
    let mut duplicate_positions_count = 0;
    let mut paper_trades_count = 0;
    let mut open_positions_count = 0;
    let mut realized_pnl_usdt = Decimal::ZERO;
    let mut unrealized_pnl_usdt = Decimal::ZERO;

    match read_state(Path::new(&config.state_path)) {
        Ok(state) => {
            duplicate_positions_count = count_duplicate_positions(&state);
            open_positions_count = state.positions.len() as u64;
            realized_pnl_usdt = state.realized_pnl_usdt;
            unrealized_pnl_usdt = state.unrealized_pnl_usdt;

            if state.account_equity_usdt < Decimal::ZERO {
                blockers.push(blocker(
                    "negative_paper_equity",
                    "paper account equity must not be negative",
                ));
            }
            if duplicate_positions_count > 0 {
                blockers.push(blocker(
                    "duplicate_open_positions",
                    "duplicate same-symbol/same-direction paper positions found",
                ));
            }
            state_valid = !blockers.iter().any(|blocker| {
                matches!(
                    blocker.code.as_str(),
                    "paper_state_unreadable"
                        | "paper_state_parse_failed"
                        | "negative_paper_equity"
                        | "duplicate_open_positions"
                )
            });
        }
        Err(blocker) => blockers.push(blocker),
    }

    match read_paper_log(Path::new(&config.log_path)) {
        Ok(log_check) => {
            paper_trades_count = log_check.trades_count;
            blockers.extend(log_check.blockers);
            warnings.extend(log_check.warnings);
            paper_log_valid = !blockers.iter().any(|blocker| {
                matches!(
                    blocker.code.as_str(),
                    "paper_log_unreadable"
                        | "paper_log_parse_failed"
                        | "paper_log_executable_trade"
                        | "paper_log_real_order_id"
                )
            });
        }
        Err(blocker) => blockers.push(blocker),
    }

    if errors_count > 0 {
        blockers.push(blocker(
            "paper_loop_errors",
            format!("paper soak observed {errors_count} loop errors"),
        ));
    }

    add_candidate_pressure_findings(
        config,
        ticks_processed,
        candidate_generated_count,
        &mut warnings,
        &mut blockers,
    );

    let soak_passed = blockers.is_empty();

    PaperSoakReport {
        ticks_requested: config.ticks,
        ticks_processed,
        state_valid,
        paper_log_valid,
        duplicate_positions_count,
        candidate_generated_count,
        paper_trades_count,
        open_positions_count,
        realized_pnl_usdt,
        unrealized_pnl_usdt,
        errors_count,
        warnings,
        blockers,
        soak_passed,
    }
}

fn read_state(path: &Path) -> Result<PaperEngineState, PaperSoakBlocker> {
    paper_state::ensure_local_file_path(path).map_err(|err| {
        blocker(
            "paper_state_unreadable",
            format!("paper state path is invalid: {err}"),
        )
    })?;
    let raw = fs::read_to_string(path).map_err(|err| {
        blocker(
            "paper_state_unreadable",
            format!(
                "paper state is required and must be readable: {} ({err})",
                path.display()
            ),
        )
    })?;
    serde_json::from_str::<PaperEngineState>(&raw).map_err(|err| {
        blocker(
            "paper_state_parse_failed",
            format!("paper state JSON parse failed: {err}"),
        )
    })
}

fn read_paper_log(path: &Path) -> Result<PaperLogCheck, PaperSoakBlocker> {
    paper_state::ensure_local_file_path(path).map_err(|err| {
        blocker(
            "paper_log_unreadable",
            format!("paper log path is invalid: {err}"),
        )
    })?;
    let raw = fs::read_to_string(path).map_err(|err| {
        blocker(
            "paper_log_unreadable",
            format!(
                "paper log is required and must be readable: {} ({err})",
                path.display()
            ),
        )
    })?;

    let mut check = PaperLogCheck::default();
    for (idx, line) in raw.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let trade = match serde_json::from_str::<PaperTrade>(line) {
            Ok(trade) => trade,
            Err(err) => {
                check.blockers.push(blocker(
                    "paper_log_parse_failed",
                    format!("paper log line {} failed to parse: {err}", idx + 1),
                ));
                continue;
            }
        };
        check.trades_count += 1;
        if trade.executable {
            check.blockers.push(blocker(
                "paper_log_executable_trade",
                format!("paper log line {} has executable=true", idx + 1),
            ));
        }
        if trade.real_order_id.is_some() {
            check.blockers.push(blocker(
                "paper_log_real_order_id",
                format!("paper log line {} contains real_order_id", idx + 1),
            ));
        }
    }

    if check.trades_count == 0 {
        check.warnings.push(warning(
            "zero_paper_trades",
            "paper soak completed with zero paper trades",
        ));
    }

    Ok(check)
}

fn add_candidate_pressure_findings(
    config: &PaperSoakConfig,
    ticks_processed: u64,
    candidate_generated_count: u64,
    warnings: &mut Vec<PaperSoakWarning>,
    blockers: &mut Vec<PaperSoakBlocker>,
) {
    if ticks_processed == 0 {
        warnings.push(warning(
            "zero_ticks_processed",
            "paper soak processed zero ticks",
        ));
        return;
    }
    if candidate_generated_count > ticks_processed {
        blockers.push(blocker(
            "candidate_count_exceeds_ticks",
            "candidate_generated_count cannot exceed ticks_processed",
        ));
        return;
    }

    let ratio = Decimal::from(candidate_generated_count) / Decimal::from(ticks_processed);
    if ratio > config.candidate_blocker_ratio && ticks_processed >= MIN_TICKS_FOR_CANDIDATE_BLOCKER
    {
        blockers.push(blocker(
            "candidate_generation_excessive",
            "candidate generation ratio exceeded blocker threshold",
        ));
    } else if ratio > config.candidate_warning_ratio {
        warnings.push(warning(
            "candidate_generation_high",
            "candidate generation ratio exceeded warning threshold",
        ));
    }
}

fn count_duplicate_positions(state: &PaperEngineState) -> u64 {
    let mut counts = BTreeMap::<String, u64>::new();
    for position in &state.positions {
        let key = format!("{}::{:?}", position.symbol.as_str(), position.direction);
        *counts.entry(key).or_insert(0) += 1;
    }

    counts
        .values()
        .filter(|count| **count > 1)
        .map(|count| count - 1)
        .sum()
}

fn warning(code: impl Into<String>, message: impl Into<String>) -> PaperSoakWarning {
    PaperSoakWarning {
        code: code.into(),
        message: message.into(),
    }
}

fn blocker(code: impl Into<String>, message: impl Into<String>) -> PaperSoakBlocker {
    PaperSoakBlocker {
        code: code.into(),
        message: message.into(),
    }
}

#[derive(Debug, Default)]
struct PaperLogCheck {
    trades_count: u64,
    warnings: Vec<PaperSoakWarning>,
    blockers: Vec<PaperSoakBlocker>,
}

pub fn write_state_for_test(path: &Path, state: &PaperEngineState) -> AppResult<()> {
    let raw = serde_json::to_string_pretty(state)
        .map_err(|err| AppError::Config(format!("failed to render test state: {err}")))?;
    fs::write(path, raw)
        .map_err(|err| AppError::Config(format!("failed to write {}: {err}", path.display())))
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use domain::{PaperEngineState, PaperPosition, PaperTrade, SignalDirection, Symbol};
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn duplicate_position_blocks_soak() {
        let paths = FixturePaths::new("duplicate_position");
        write_state_for_test(
            &paths.state,
            &PaperEngineState {
                positions: vec![position("one"), position("two")],
                ..Default::default()
            },
        )
        .unwrap();
        write_log(&paths.log, &[trade(false, false)]);

        let report = build_soak_report(&paths.config(), 2, 1, 0);

        assert!(!report.soak_passed);
        assert_eq!(report.duplicate_positions_count, 1);
        assert!(has_blocker(&report, "duplicate_open_positions"));
        paths.cleanup();
    }

    #[test]
    fn executable_paper_trade_blocks_soak() {
        let paths = FixturePaths::new("executable_trade");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(true, false)]);

        let report = build_soak_report(&paths.config(), 1, 1, 0);

        assert!(!report.paper_log_valid);
        assert!(has_blocker(&report, "paper_log_executable_trade"));
        paths.cleanup();
    }

    #[test]
    fn real_order_id_blocks_soak() {
        let paths = FixturePaths::new("real_order");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, true)]);

        let report = build_soak_report(&paths.config(), 1, 1, 0);

        assert!(!report.paper_log_valid);
        assert!(has_blocker(&report, "paper_log_real_order_id"));
        paths.cleanup();
    }

    #[test]
    fn negative_equity_blocks_soak() {
        let paths = FixturePaths::new("negative_equity");
        write_state_for_test(
            &paths.state,
            &PaperEngineState {
                account_equity_usdt: dec!(-1),
                ..Default::default()
            },
        )
        .unwrap();
        write_log(&paths.log, &[trade(false, false)]);

        let report = build_soak_report(&paths.config(), 1, 0, 0);

        assert!(!report.state_valid);
        assert!(has_blocker(&report, "negative_paper_equity"));
        paths.cleanup();
    }

    #[test]
    fn zero_trades_emits_warning_only() {
        let paths = FixturePaths::new("zero_trades");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        fs::write(&paths.log, "").unwrap();

        let report = build_soak_report(&paths.config(), 2, 0, 0);

        assert!(report.soak_passed);
        assert!(has_warning(&report, "zero_paper_trades"));
        paths.cleanup();
    }

    #[test]
    fn high_candidate_generation_warns_only() {
        let paths = FixturePaths::new("candidate_warning");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let mut config = paths.config();
        config.candidate_warning_ratio = dec!(0.50);
        config.candidate_blocker_ratio = dec!(0.90);

        let report = build_soak_report(&config, 4, 3, 0);

        assert!(report.soak_passed);
        assert!(has_warning(&report, "candidate_generation_high"));
        paths.cleanup();
    }

    #[test]
    fn excessive_candidate_generation_blocks_soak() {
        let paths = FixturePaths::new("candidate_blocker");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let mut config = paths.config();
        config.candidate_warning_ratio = dec!(0.50);
        config.candidate_blocker_ratio = dec!(0.75);

        let report = build_soak_report(&config, MIN_TICKS_FOR_CANDIDATE_BLOCKER, 20, 0);

        assert!(!report.soak_passed);
        assert!(has_blocker(&report, "candidate_generation_excessive"));
        paths.cleanup();
    }

    #[test]
    fn report_is_deterministic() {
        let paths = FixturePaths::new("deterministic_report");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let config = paths.config();

        let first = build_soak_report(&config, 3, 1, 0);
        let second = build_soak_report(&config, 3, 1, 0);

        assert_eq!(first, second);
        paths.cleanup();
    }

    fn has_blocker(report: &PaperSoakReport, code: &str) -> bool {
        report.blockers.iter().any(|blocker| blocker.code == code)
    }

    fn has_warning(report: &PaperSoakReport, code: &str) -> bool {
        report.warnings.iter().any(|warning| warning.code == code)
    }

    fn position(id: &str) -> PaperPosition {
        PaperPosition {
            position_id: id.to_string(),
            symbol: Symbol::new("BTCUSDT").unwrap(),
            direction: SignalDirection::Long,
            entry_price: dec!(100),
            mark_price: dec!(100),
            notional: dec!(60),
            quantity: dec!(0.6),
            unrealized_pnl_usdt: dec!(0),
            opened_at_tick: 1,
            candidate_id: "audit-test".to_string(),
        }
    }

    fn trade(executable: bool, real_order_id: bool) -> PaperTrade {
        PaperTrade {
            trade_id: "paper-test".to_string(),
            tick_id: 1,
            timestamp_ms: 1,
            symbol: Symbol::new("BTCUSDT").unwrap(),
            direction: SignalDirection::Long,
            price: dec!(100),
            notional: dec!(60),
            quantity: dec!(0.6),
            fees_usdt: dec!(0.06),
            realized_pnl_usdt: dec!(-0.06),
            executable,
            real_order_id: real_order_id.then(|| "real-order".to_string()),
            candidate_id: "audit-test".to_string(),
        }
    }

    fn write_log(path: &Path, trades: &[PaperTrade]) {
        let raw = trades
            .iter()
            .map(|trade| serde_json::to_string(trade).unwrap())
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(path, format!("{raw}\n")).unwrap();
    }

    struct FixturePaths {
        dir: PathBuf,
        state: PathBuf,
        log: PathBuf,
    }

    impl FixturePaths {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir()
                .join(format!("rustquanteth-soak-{name}-{}", std::process::id()));
            fs::create_dir_all(&dir).unwrap();
            Self {
                state: dir.join("paper_state.json"),
                log: dir.join("paper_trades.jsonl"),
                dir,
            }
        }

        fn config(&self) -> PaperSoakConfig {
            PaperSoakConfig {
                ticks: 3,
                interval_seconds: 0,
                state_path: self.state.display().to_string(),
                log_path: self.log.display().to_string(),
                ..Default::default()
            }
        }

        fn cleanup(&self) {
            let _ = fs::remove_file(&self.state);
            let _ = fs::remove_file(&self.log);
            let _ = fs::remove_dir(&self.dir);
        }
    }
}
