use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use backtest::{event_loader, event_replay};
use domain::{
    AppError, AppResult, BacktestConfig, CanaryBlocker, CanaryCheckResult, CanaryCheckStatus,
    CanaryReadinessConfig, CanaryReadinessReport, EngineConfig, PaperEngineState, PaperTrade,
};
use rust_decimal::Decimal;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanaryReadinessInputs {
    pub paper_state_path: PathBuf,
    pub paper_log_path: PathBuf,
    pub backtest_input_path: PathBuf,
}

pub fn evaluate_readiness(
    engine_config: &EngineConfig,
    readiness_config: &CanaryReadinessConfig,
    inputs: &CanaryReadinessInputs,
) -> CanaryReadinessReport {
    let mut checks = vec![
        safety_config_check(engine_config, readiness_config),
        paper_state_check(&inputs.paper_state_path),
        paper_log_check(&inputs.paper_log_path),
        backtest_replay_check(&inputs.backtest_input_path),
        forbidden_capability_scan(
            Path::new(&readiness_config.workspace_root),
            &readiness_config.source_scan_paths,
        ),
        git_hygiene_check(Path::new(&readiness_config.workspace_root)),
        manual_gate_check(readiness_config),
    ];

    let blockers = checks
        .iter()
        .flat_map(|check| check.blockers.clone())
        .collect::<Vec<_>>();
    let warnings = checks
        .iter_mut()
        .flat_map(|check| check.warnings.clone())
        .collect::<Vec<_>>();
    let all_checks_pass = checks
        .iter()
        .all(|check| check.status == CanaryCheckStatus::Pass);
    let ready = all_checks_pass && readiness_config.manual_live_gate_present;

    CanaryReadinessReport {
        ready,
        checks,
        blockers,
        warnings,
        summary: if ready {
            "canary prerequisites passed; external manual gate is present".to_string()
        } else {
            "canary is not ready; audit-only readiness did not satisfy every gate".to_string()
        },
        live_trading_allowed: false,
        executable_order_capability: false,
    }
}

pub fn safety_config_check(
    engine_config: &EngineConfig,
    readiness_config: &CanaryReadinessConfig,
) -> CanaryCheckResult {
    let mut blockers = Vec::new();

    if engine_config.safety.allow_live_trading {
        blockers.push(blocker(
            "live_trading_enabled",
            "config safety.allow_live_trading must be false",
        ));
    }
    if readiness_config.live_orders_enabled {
        blockers.push(blocker(
            "live_orders_enabled",
            "canary readiness cannot enable live order capability",
        ));
    }
    if engine_config.safety.allow_live_orders {
        blockers.push(blocker(
            "live_orders_enabled",
            "config safety.allow_live_orders must be false",
        ));
    }
    if engine_config.safety.allow_signed_endpoints {
        blockers.push(blocker(
            "signed_endpoints_enabled",
            "config safety.allow_signed_endpoints must be false",
        ));
    }
    if engine_config.safety.allow_api_key_loading {
        blockers.push(blocker(
            "api_key_loading_enabled",
            "config safety.allow_api_key_loading must be false",
        ));
    }
    if engine_config.safety.allow_live_100x {
        blockers.push(blocker(
            "live_100x_enabled",
            "config safety.allow_live_100x must be false",
        ));
    }
    if readiness_config.withdrawal_enabled {
        blockers.push(blocker(
            "withdrawal_enabled",
            "canary readiness cannot enable withdrawal capability",
        ));
    }
    if engine_config.safety.allow_withdrawals {
        blockers.push(blocker(
            "withdrawal_enabled",
            "config safety.allow_withdrawals must be false",
        ));
    }
    if engine_config.safety.allow_leverage_changes {
        blockers.push(blocker(
            "leverage_changes_enabled",
            "config safety.allow_leverage_changes must be false",
        ));
    }
    if engine_config.safety.max_live_micro_notional_usdt > Decimal::ZERO {
        blockers.push(blocker(
            "live_micro_notional_enabled",
            "config max_live_micro_notional_usdt must remain 0",
        ));
    }
    if !engine_config.safety.manual_confirmation_required {
        blockers.push(blocker(
            "manual_confirmation_not_required",
            "manual confirmation must remain required",
        ));
    }
    if !engine_config.safety.two_step_confirmation_required {
        blockers.push(blocker(
            "two_step_confirmation_not_required",
            "two-step confirmation must remain required",
        ));
    }
    if engine_config.safety.max_leverage > readiness_config.max_allowed_leverage {
        blockers.push(blocker(
            "max_leverage_too_high",
            "config max leverage must be at or below the canary cap",
        ));
    }

    check_result(
        "safety_config_check",
        blockers,
        Vec::new(),
        "safety flags remain non-live and leverage capped",
    )
}

pub fn paper_state_check(path: impl AsRef<Path>) -> CanaryCheckResult {
    let path = path.as_ref();
    let mut blockers = Vec::new();
    let mut warnings = Vec::new();

    match ensure_local_file_path(path) {
        Ok(()) => {}
        Err(err) => blockers.push(blocker("paper_state_not_local", err.to_string())),
    }

    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(err) => {
            blockers.push(blocker(
                "paper_state_missing",
                format!("paper state file is required: {} ({err})", path.display()),
            ));
            return check_result(
                "paper_state_check",
                blockers,
                warnings,
                "paper state file missing or unreadable",
            );
        }
    };

    let state = match serde_json::from_str::<PaperEngineState>(&raw) {
        Ok(state) => state,
        Err(err) => {
            blockers.push(blocker(
                "paper_state_parse_failed",
                format!("paper state JSON parse failed: {err}"),
            ));
            return check_result(
                "paper_state_check",
                blockers,
                warnings,
                "paper state file did not parse",
            );
        }
    };

    if state.account_equity_usdt < Decimal::ZERO {
        blockers.push(blocker(
            "negative_paper_equity",
            "paper account equity must not be negative",
        ));
    }
    if has_duplicate_open_position(&state) {
        blockers.push(blocker(
            "duplicate_open_position",
            "paper state contains duplicate open position ids or symbol-direction pairs",
        ));
    }

    match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(value) => {
            if contains_executable_true(&value) {
                blockers.push(blocker(
                    "paper_state_executable_trade",
                    "paper state must not contain executable=true",
                ));
            }
            if contains_real_order_id(&value) {
                blockers.push(blocker(
                    "paper_state_real_order_id",
                    "paper state must not contain a real_order_id value",
                ));
            }
        }
        Err(err) => warnings.push(format!(
            "paper state JSON value scan skipped after parse error: {err}"
        )),
    }

    check_result(
        "paper_state_check",
        blockers,
        warnings,
        "paper state exists, parses, and contains no executable/live identifiers",
    )
}

pub fn paper_log_check(path: impl AsRef<Path>) -> CanaryCheckResult {
    let path = path.as_ref();
    let mut blockers = Vec::new();
    let mut warnings = Vec::new();

    match ensure_local_file_path(path) {
        Ok(()) => {}
        Err(err) => blockers.push(blocker("paper_log_not_local", err.to_string())),
    }

    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(err) => {
            blockers.push(blocker(
                "paper_log_missing",
                format!("paper trade log is required: {} ({err})", path.display()),
            ));
            return check_result(
                "paper_log_check",
                blockers,
                warnings,
                "paper trade log missing or unreadable",
            );
        }
    };

    let mut trades = 0_u64;
    for (idx, line) in raw.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let trade = match serde_json::from_str::<PaperTrade>(line) {
            Ok(trade) => trade,
            Err(err) => {
                blockers.push(blocker(
                    "paper_log_parse_failed",
                    format!("paper trade log line {} failed to parse: {err}", idx + 1),
                ));
                continue;
            }
        };
        trades += 1;
        if trade.executable {
            blockers.push(blocker(
                "paper_log_executable_trade",
                format!("paper trade line {} has executable=true", idx + 1),
            ));
        }
        if trade.real_order_id.is_some() {
            blockers.push(blocker(
                "paper_log_real_order_id",
                format!("paper trade line {} contains real_order_id", idx + 1),
            ));
        }
    }
    if trades == 0 {
        warnings.push("paper trade log contains zero trades".to_string());
    }

    check_result(
        "paper_log_check",
        blockers,
        warnings,
        "paper trade log parses and contains only simulated trades",
    )
}

pub fn backtest_replay_check(path: impl AsRef<Path>) -> CanaryCheckResult {
    let path = path.as_ref();
    let mut blockers = Vec::new();
    let warnings = Vec::new();

    match ensure_local_file_path(path) {
        Ok(()) => {}
        Err(err) => blockers.push(blocker("backtest_input_not_local", err.to_string())),
    }

    match event_loader::load_jsonl_events(path)
        .and_then(|events| event_replay::replay_events(&events, &BacktestConfig::default()))
    {
        Ok(report) => {
            if report.events_processed == 0 {
                blockers.push(blocker(
                    "backtest_empty",
                    "backtest replay must process at least one event",
                ));
            }
            for decision in &report.decisions {
                if let Some(trade) = &decision.simulated_trade {
                    if trade.executable {
                        blockers.push(blocker(
                            "backtest_executable_trade",
                            "backtest simulated trade must not be executable",
                        ));
                    }
                    if trade.real_order_id.is_some() {
                        blockers.push(blocker(
                            "backtest_real_order_id",
                            "backtest simulated trade must not contain real_order_id",
                        ));
                    }
                }
            }
        }
        Err(err) => blockers.push(blocker(
            "backtest_replay_failed",
            format!("backtest replay check failed: {err}"),
        )),
    }

    check_result(
        "backtest_replay_check",
        blockers,
        warnings,
        "backtest input replays and simulated trades remain non-executable",
    )
}

pub fn forbidden_capability_scan(
    workspace_root: &Path,
    scan_paths: &[String],
) -> CanaryCheckResult {
    let mut blockers = Vec::new();
    let mut warnings = Vec::new();

    for scan_path in scan_paths {
        let path = workspace_root.join(scan_path);
        match collect_rs_files(&path) {
            Ok(files) => {
                for file in files {
                    match fs::read_to_string(&file) {
                        Ok(raw) => scan_source_file(&file, &raw, &mut blockers),
                        Err(err) => {
                            warnings.push(format!("source scan skipped {}: {err}", file.display()))
                        }
                    }
                }
            }
            Err(err) => warnings.push(format!("source scan skipped {}: {err}", path.display())),
        }
    }

    check_result(
        "forbidden_capability_scan",
        blockers,
        warnings,
        "source scan found no obvious live-order, signed, withdrawal, key, or leverage endpoints",
    )
}

pub fn git_hygiene_check(workspace_root: &Path) -> CanaryCheckResult {
    let mut blockers = Vec::new();
    let mut warnings = Vec::new();

    match Command::new("git")
        .args(["check-ignore", "-q", "target"])
        .current_dir(workspace_root)
        .stderr(Stdio::null())
        .status()
    {
        Ok(status) if status.success() => {}
        Ok(_) => blockers.push(blocker(
            "target_not_ignored",
            "target/ must be ignored by git",
        )),
        Err(err) => warnings.push(format!(
            "manual git ignore check required; git check-ignore failed: {err}"
        )),
    }

    match Command::new("git")
        .args(["ls-files", "target"])
        .current_dir(workspace_root)
        .stderr(Stdio::null())
        .output()
    {
        Ok(output) if output.status.success() && output.stdout.is_empty() => {}
        Ok(output) if output.status.success() => blockers.push(blocker(
            "target_tracked",
            "target/ files must not be tracked by git",
        )),
        Ok(output) => warnings.push(format!(
            "manual target tracking check required; git ls-files exited with {}",
            output.status
        )),
        Err(err) => warnings.push(format!(
            "manual target tracking check required; git ls-files failed: {err}"
        )),
    }

    check_result(
        "git_hygiene_check",
        blockers,
        warnings,
        "target/ is ignored and not tracked, when git checks are available",
    )
}

fn manual_gate_check(config: &CanaryReadinessConfig) -> CanaryCheckResult {
    let blockers = if config.manual_live_gate_present {
        Vec::new()
    } else {
        vec![blocker(
            "manual_live_gate_absent",
            "Phase 8 intentionally has no manual live canary gate flag",
        )]
    };

    check_result(
        "manual_gate_check",
        blockers,
        Vec::new(),
        "future manual live canary gate is absent in Phase 8 by design",
    )
}

fn scan_source_file(file: &Path, raw: &str, blockers: &mut Vec<CanaryBlocker>) {
    let lowered = raw.to_ascii_lowercase();
    let patterns = [
        ("signed_order_endpoint", "/fapi/v1/order"),
        ("spot_order_endpoint", "/api/v3/order"),
        ("leverage_endpoint", "/fapi/v1/leverage"),
        ("withdrawal_endpoint", "/sapi/v1/capital/withdraw"),
        ("withdrawal_endpoint", "/withdraw/apply"),
        ("api_key_env", "binance_api_key"),
        ("api_secret_env", "binance_api_secret"),
        ("api_secret_env", "api_secret"),
        ("secret_key_env", "secret_key"),
        ("signed_header", "x-mbx-apikey"),
        ("signature_param", "signature="),
        ("real_order_id_assignment", "real_order_id: some"),
        ("real_order_id_assignment", "real_order_id = some"),
    ];

    for (code, pattern) in patterns {
        if lowered.contains(pattern) {
            blockers.push(blocker(
                code,
                format!("forbidden pattern `{pattern}` found in {}", file.display()),
            ));
        }
    }
}

fn collect_rs_files(path: &Path) -> AppResult<Vec<PathBuf>> {
    let mut files = Vec::new();
    if path.is_file() {
        if path.extension().is_some_and(|extension| extension == "rs") {
            files.push(path.to_path_buf());
        }
        return Ok(files);
    }

    for entry in fs::read_dir(path)
        .map_err(|err| AppError::Config(format!("failed to read {}: {err}", path.display())))?
    {
        let entry = entry.map_err(|err| {
            AppError::Config(format!("failed to read entry in {}: {err}", path.display()))
        })?;
        let child = entry.path();
        if child.is_dir() {
            files.extend(collect_rs_files(&child)?);
        } else if child.extension().is_some_and(|extension| extension == "rs") {
            files.push(child);
        }
    }
    Ok(files)
}

fn contains_executable_true(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(map) => map.iter().any(|(key, value)| {
            (key == "executable" && value == &serde_json::Value::Bool(true))
                || contains_executable_true(value)
        }),
        serde_json::Value::Array(values) => values.iter().any(contains_executable_true),
        _ => false,
    }
}

fn contains_real_order_id(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(map) => map.iter().any(|(key, value)| {
            (key == "real_order_id" && !value.is_null()) || contains_real_order_id(value)
        }),
        serde_json::Value::Array(values) => values.iter().any(contains_real_order_id),
        _ => false,
    }
}

fn has_duplicate_open_position(state: &PaperEngineState) -> bool {
    let mut position_ids = BTreeSet::new();
    let mut symbol_direction_pairs = BTreeSet::new();
    state.positions.iter().any(|position| {
        !position_ids.insert(position.position_id.clone())
            || !symbol_direction_pairs.insert(format!(
                "{}::{:?}",
                position.symbol.as_str(),
                position.direction
            ))
    })
}

fn ensure_local_file_path(path: &Path) -> AppResult<()> {
    let raw = path.as_os_str().to_string_lossy();
    if raw.trim().is_empty() || raw.contains("://") || path.file_name().is_none() {
        return Err(AppError::Config(format!(
            "path must be a local file path: {}",
            path.display()
        )));
    }
    Ok(())
}

fn check_result(
    name: impl Into<String>,
    blockers: Vec<CanaryBlocker>,
    warnings: Vec<String>,
    pass_summary: &'static str,
) -> CanaryCheckResult {
    let status = if !blockers.is_empty() {
        CanaryCheckStatus::Fail
    } else if !warnings.is_empty() {
        CanaryCheckStatus::Warn
    } else {
        CanaryCheckStatus::Pass
    };
    let summary = match status {
        CanaryCheckStatus::Pass => pass_summary.to_string(),
        CanaryCheckStatus::Warn => "check passed with warnings".to_string(),
        CanaryCheckStatus::Fail => "check failed with blockers".to_string(),
    };

    CanaryCheckResult {
        name: name.into(),
        status,
        blockers,
        warnings,
        summary,
    }
}

fn blocker(code: impl Into<String>, message: impl Into<String>) -> CanaryBlocker {
    CanaryBlocker {
        code: code.into(),
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use domain::{PaperEngineState, PaperPosition, PaperTrade, SignalDirection, Symbol};
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn missing_paper_state_creates_blocker() {
        let result = paper_state_check(fixture_path("missing_state.json"));

        assert!(has_blocker(&result, "paper_state_missing"));
    }

    #[test]
    fn executable_true_in_paper_log_creates_blocker() {
        let path = fixture_path("executable_log.jsonl");
        let mut trade = safe_trade();
        trade.executable = true;
        write_jsonl(&path, &[trade]);

        let result = paper_log_check(&path);

        assert!(has_blocker(&result, "paper_log_executable_trade"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn real_order_id_in_paper_log_creates_blocker() {
        let path = fixture_path("real_order_log.jsonl");
        let mut trade = safe_trade();
        trade.real_order_id = Some("real-order-123".to_string());
        write_jsonl(&path, &[trade]);

        let result = paper_log_check(&path);

        assert!(has_blocker(&result, "paper_log_real_order_id"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn negative_paper_equity_creates_blocker() {
        let path = fixture_path("negative_state.json");
        let state = PaperEngineState {
            account_equity_usdt: dec!(-1),
            ..Default::default()
        };
        fs::write(&path, serde_json::to_string(&state).unwrap()).unwrap();

        let result = paper_state_check(&path);

        assert!(has_blocker(&result, "negative_paper_equity"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn safe_files_pass_their_individual_checks() {
        let state_path = fixture_path("safe_state.json");
        let log_path = fixture_path("safe_log.jsonl");
        let state = PaperEngineState {
            positions: vec![safe_position()],
            ..Default::default()
        };
        fs::write(&state_path, serde_json::to_string(&state).unwrap()).unwrap();
        write_jsonl(&log_path, &[safe_trade()]);

        let state_result = paper_state_check(&state_path);
        let log_result = paper_log_check(&log_path);

        assert_eq!(state_result.status, CanaryCheckStatus::Pass);
        assert_eq!(log_result.status, CanaryCheckStatus::Pass);
        let _ = fs::remove_file(state_path);
        let _ = fs::remove_file(log_path);
    }

    #[test]
    fn forbidden_pattern_scan_catches_banned_strings() {
        let dir = fixture_dir("forbidden_scan");
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("bad.rs");
        fs::write(&source, "let _ = std::env::var(\"BINANCE_API_KEY\");").unwrap();

        let result = forbidden_capability_scan(&dir, &["bad.rs".to_string()]);

        assert!(has_blocker(&result, "api_key_env"));
        let _ = fs::remove_file(source);
        let _ = fs::remove_dir(dir);
    }

    #[test]
    fn readiness_remains_false_without_manual_live_gate() {
        let dir = fixture_dir("readiness_false");
        fs::create_dir_all(&dir).unwrap();
        let state_path = dir.join("paper_state.json");
        let log_path = dir.join("paper_trades.jsonl");
        let backtest_path = dir.join("events.jsonl");
        fs::write(
            &state_path,
            serde_json::to_string(&PaperEngineState::default()).unwrap(),
        )
        .unwrap();
        write_jsonl(&log_path, &[safe_trade()]);
        fs::write(&backtest_path, neutral_event_jsonl()).unwrap();
        let readiness_config = CanaryReadinessConfig {
            workspace_root: dir.display().to_string(),
            source_scan_paths: Vec::new(),
            ..Default::default()
        };
        let inputs = CanaryReadinessInputs {
            paper_state_path: state_path.clone(),
            paper_log_path: log_path.clone(),
            backtest_input_path: backtest_path.clone(),
        };

        let report = evaluate_readiness(&EngineConfig::default(), &readiness_config, &inputs);

        assert!(!report.ready);
        assert!(
            report
                .blockers
                .iter()
                .any(|blocker| blocker.code == "manual_live_gate_absent")
        );
        let _ = fs::remove_file(state_path);
        let _ = fs::remove_file(log_path);
        let _ = fs::remove_file(backtest_path);
        let _ = fs::remove_dir(dir);
    }

    fn has_blocker(result: &CanaryCheckResult, code: &str) -> bool {
        result.blockers.iter().any(|blocker| blocker.code == code)
    }

    fn safe_position() -> PaperPosition {
        PaperPosition {
            position_id: "paper-position-1".to_string(),
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

    fn safe_trade() -> PaperTrade {
        PaperTrade {
            trade_id: "paper-1".to_string(),
            tick_id: 1,
            timestamp_ms: 1,
            symbol: Symbol::new("BTCUSDT").unwrap(),
            direction: SignalDirection::Long,
            price: dec!(100),
            notional: dec!(60),
            quantity: dec!(0.6),
            fees_usdt: dec!(0.06),
            realized_pnl_usdt: dec!(-0.06),
            executable: false,
            real_order_id: None,
            candidate_id: "audit-test".to_string(),
        }
    }

    fn write_jsonl(path: &Path, trades: &[PaperTrade]) {
        let raw = trades
            .iter()
            .map(|trade| serde_json::to_string(trade).unwrap())
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(path, format!("{raw}\n")).unwrap();
    }

    fn neutral_event_jsonl() -> &'static str {
        r#"{"sequence":1,"timestamp_ms":1,"exchange":"offline","symbol":"BTCUSDT","mark_price":"100","index_price":"100","funding_rate":"0","open_interest":"1000","bid_levels":[{"price":"99.99","quantity":"100"}],"ask_levels":[{"price":"100.01","quantity":"100"}]}"#
    }

    fn fixture_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("rustquanteth-canary-{name}-{}", std::process::id()))
    }

    fn fixture_dir(name: &str) -> PathBuf {
        fixture_path(name)
    }
}
