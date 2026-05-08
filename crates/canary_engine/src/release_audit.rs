use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use domain::{
    AppError, AppResult, CanaryBlocker, CanaryReadinessConfig, EngineConfig, LiveGateReason,
    LiveMicroReadinessReport, PaperSoakReport, ReleaseAuditBlocker, ReleaseAuditCheck,
    ReleaseAuditConfig, ReleaseAuditReport, ReleaseAuditWarning,
};

use crate::{
    live_micro::{self, LiveMicroReadinessInputs},
    readiness::{self, CanaryReadinessInputs},
};

pub fn run_release_audit(
    engine_config: &EngineConfig,
    config: &ReleaseAuditConfig,
) -> AppResult<ReleaseAuditReport> {
    let report = generate_release_audit_report(engine_config, config);
    if let Some(output) = config.output.as_deref() {
        write_release_audit_report(Path::new(output), &report)?;
    }
    Ok(report)
}

pub fn generate_release_audit_report(
    engine_config: &EngineConfig,
    config: &ReleaseAuditConfig,
) -> ReleaseAuditReport {
    let workspace_root = Path::new(&config.workspace_root);
    let git_commit = git_commit(workspace_root);
    let git_clean = git_clean(workspace_root);

    let mut checks = vec![
        config_safety_check(engine_config),
        health_check_summary(engine_config),
        forbidden_capability_check(engine_config, config),
        canary_readiness_check(engine_config, config),
    ];

    let live_micro_inputs = LiveMicroReadinessInputs {
        workspace_root: workspace_root.to_path_buf(),
        canary_report_path: PathBuf::from("data/paper/canary_readiness.json"),
        paper_soak_report_path: PathBuf::from(&config.soak_report),
        source_scan_paths: config.source_scan_paths.clone(),
    };
    let live_micro_report =
        live_micro::evaluate_live_micro_readiness(engine_config, &live_micro_inputs);
    checks.push(live_micro_release_check(&live_micro_report));
    checks.push(soak_report_check(Path::new(&config.soak_report)));
    checks.push(git_check(git_clean));

    let mut blockers = checks
        .iter()
        .flat_map(|check| check.blockers.clone())
        .collect::<Vec<_>>();
    let warnings = checks
        .iter()
        .flat_map(|check| check.warnings.clone())
        .collect::<Vec<_>>();

    if git_clean != Some(true) && !has_blocker(&blockers, "git_dirty") && git_clean == Some(false) {
        blockers.push(blocker(
            "git_dirty",
            "release audit requires a clean git worktree",
        ));
    }

    let release_ready = blockers.is_empty() && git_clean == Some(true);
    let health_check_summary = summary_for(&checks, "health_check");
    let canary_readiness_summary = summary_for(&checks, "canary_readiness");
    let live_micro_readiness_summary = summary_for(&checks, "live_micro_readiness");
    let soak_report_summary = summary_for(&checks, "soak_report");
    let forbidden_capability_scan_summary = summary_for(&checks, "forbidden_capability_scan");

    ReleaseAuditReport {
        git_commit,
        git_clean,
        config_safety_flags: config_safety_flags(engine_config),
        health_check_summary,
        canary_readiness_summary,
        live_micro_readiness_summary,
        soak_report_summary,
        forbidden_capability_scan_summary,
        validation_commands_expected: config.validation_commands_expected.clone(),
        release_ready,
        checks,
        blockers,
        warnings,
        summary: if release_ready {
            "release audit passed; repository is research/paper/audit-only".to_string()
        } else {
            "release audit is not ready; review blockers and warnings".to_string()
        },
    }
}

pub fn write_release_audit_report(path: &Path, report: &ReleaseAuditReport) -> AppResult<()> {
    ensure_local_file_path(path)?;
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|err| {
            AppError::Config(format!(
                "failed to create release audit output directory {}: {err}",
                parent.display()
            ))
        })?;
    }
    let raw = serde_json::to_string_pretty(report)
        .map_err(|err| AppError::Config(format!("failed to render release audit JSON: {err}")))?;
    fs::write(path, raw).map_err(|err| {
        AppError::Config(format!(
            "failed to write release audit report {}: {err}",
            path.display()
        ))
    })
}

pub fn live_micro_release_check(report: &LiveMicroReadinessReport) -> ReleaseAuditCheck {
    let mut blockers = Vec::new();
    let mut warnings = Vec::new();

    if report.live_micro_ready {
        blockers.push(blocker(
            "live_micro_ready_unexpected",
            "live micro readiness must remain false in Phase 9",
        ));
    }
    if report.live_trading_allowed {
        blockers.push(blocker(
            "live_trading_allowed",
            "live trading must not be allowed",
        ));
    }
    if report.live_orders_allowed {
        blockers.push(blocker(
            "live_orders_allowed",
            "live orders must not be allowed",
        ));
    }
    if report.signed_endpoints_allowed {
        blockers.push(blocker(
            "signed_endpoints_allowed",
            "signed/private endpoints must not be allowed",
        ));
    }
    if report.api_key_loading_allowed {
        blockers.push(blocker(
            "api_key_loading_allowed",
            "API key loading must not be allowed",
        ));
    }
    if report.withdrawals_allowed {
        blockers.push(blocker(
            "withdrawals_allowed",
            "withdrawal execution must not be allowed",
        ));
    }
    if report.leverage_changes_allowed {
        blockers.push(blocker(
            "leverage_changes_allowed",
            "leverage-changing logic must not be allowed",
        ));
    }
    if report.executable_order_capability {
        blockers.push(blocker(
            "executable_order_capability",
            "no executable order capability may exist",
        ));
    }
    for reason in expected_live_micro_reasons() {
        if !report.reasons.contains(&reason) {
            blockers.push(blocker(
                "live_micro_expected_reason_missing",
                format!("live micro readiness is missing expected reason {reason:?}"),
            ));
        }
    }
    if !report.canary_readiness_available {
        warnings.push(warning(
            "live_micro_canary_report_not_loaded",
            "live micro readiness did not load a canary readiness report; release audit evaluates canary separately",
        ));
    }

    release_check(
        "live_micro_readiness",
        blockers,
        warnings,
        "live micro readiness is false by design with no executable capability",
    )
}

fn config_safety_check(engine_config: &EngineConfig) -> ReleaseAuditCheck {
    let blockers = match engine_config.validate_safety() {
        Ok(()) => Vec::new(),
        Err(err) => vec![blocker(
            "config_safety_failed",
            format!("config safety validation failed: {err}"),
        )],
    };

    release_check(
        "config_safety",
        blockers,
        Vec::new(),
        "config safety flags are locked to research/paper/audit-only",
    )
}

fn health_check_summary(engine_config: &EngineConfig) -> ReleaseAuditCheck {
    let mut blockers = Vec::new();
    if let Err(err) = engine_config.validate_safety() {
        blockers.push(blocker(
            "health_check_config_failed",
            format!("health check config safety failed: {err}"),
        ));
    }
    if !engine_config.execution.dry_run && engine_config.execution.mode.allows_real_orders() {
        blockers.push(blocker(
            "health_check_live_execution_mode",
            "execution mode must not allow real orders",
        ));
    }

    release_check(
        "health_check",
        blockers,
        Vec::new(),
        "health check safety preconditions pass; no live execution mode is available",
    )
}

fn forbidden_capability_check(
    engine_config: &EngineConfig,
    config: &ReleaseAuditConfig,
) -> ReleaseAuditCheck {
    let gate_config = live_micro::live_gate_config_from_engine(engine_config);
    let audit = live_micro::audit_api_permissions(
        &gate_config,
        Path::new(&config.workspace_root),
        &config.source_scan_paths,
    );
    let blockers = if audit.blocked {
        vec![blocker("forbidden_capability_found", audit.summary.clone())]
    } else {
        Vec::new()
    };
    let warnings = audit
        .forbidden_patterns_found
        .iter()
        .map(|finding| warning("forbidden_pattern", finding.clone()))
        .collect();

    release_check(
        "forbidden_capability_scan",
        blockers,
        warnings,
        "source scan found no live-order, signed endpoint, withdrawal, leverage-change, or API key loading capability",
    )
}

fn canary_readiness_check(
    engine_config: &EngineConfig,
    config: &ReleaseAuditConfig,
) -> ReleaseAuditCheck {
    let readiness_config = CanaryReadinessConfig {
        workspace_root: config.workspace_root.clone(),
        source_scan_paths: config.source_scan_paths.clone(),
        ..Default::default()
    };
    let inputs = CanaryReadinessInputs {
        paper_state_path: PathBuf::from(&config.paper_state),
        paper_log_path: PathBuf::from(&config.paper_log),
        backtest_input_path: PathBuf::from(&config.backtest_input),
    };
    let report = readiness::evaluate_readiness(engine_config, &readiness_config, &inputs);
    let expected_only = canary_has_only_expected_manual_gate_blocker(&report.blockers);
    let blockers = if expected_only
        && !report.live_trading_allowed
        && !report.executable_order_capability
    {
        Vec::new()
    } else {
        vec![blocker(
            "canary_readiness_unexpected_blocker",
            format!(
                "canary readiness must have only expected manual-live-gate blocker; observed {} blockers",
                report.blockers.len()
            ),
        )]
    };
    let warnings = report
        .warnings
        .iter()
        .map(|message| warning("canary_warning", message.clone()))
        .collect();

    release_check(
        "canary_readiness",
        blockers,
        warnings,
        "canary readiness has only the expected manual-live-gate blocker",
    )
}

fn soak_report_check(path: &Path) -> ReleaseAuditCheck {
    let mut warnings = Vec::new();
    let mut blockers = Vec::new();

    match fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str::<PaperSoakReport>(&raw) {
            Ok(report) => {
                if !report.soak_passed {
                    warnings.push(warning(
                        "soak_report_not_passed",
                        "paper soak report did not pass; review diagnostics before release",
                    ));
                }
                if report.paper_trades_count > 0 || report.open_positions_count > 0 {
                    warnings.push(warning(
                        "soak_report_has_paper_activity",
                        "paper soak report contains simulated paper activity",
                    ));
                }
                if report.blockers.iter().any(|blocker| {
                    blocker.code.contains("executable") || blocker.code.contains("real_order_id")
                }) {
                    blockers.push(blocker(
                        "soak_report_live_order_evidence",
                        "soak report contains executable or real_order_id evidence",
                    ));
                }
            }
            Err(err) => warnings.push(warning(
                "soak_report_parse_failed",
                format!(
                    "soak report could not be parsed: {} ({err})",
                    path.display()
                ),
            )),
        },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => warnings.push(warning(
            "soak_report_missing",
            format!("soak report missing: {}", path.display()),
        )),
        Err(err) => warnings.push(warning(
            "soak_report_unreadable",
            format!("soak report unreadable: {} ({err})", path.display()),
        )),
    }

    release_check(
        "soak_report",
        blockers,
        warnings,
        "paper soak report inspected; missing or transient soak issues are advisory",
    )
}

fn git_check(git_clean: Option<bool>) -> ReleaseAuditCheck {
    let mut blockers = Vec::new();
    let mut warnings = Vec::new();
    match git_clean {
        Some(true) => {}
        Some(false) => blockers.push(blocker(
            "git_dirty",
            "git worktree must be clean for release readiness",
        )),
        None => warnings.push(warning(
            "git_status_unavailable",
            "git status unavailable; release readiness cannot be proven clean",
        )),
    }

    release_check("git_hygiene", blockers, warnings, "git worktree is clean")
}

fn canary_has_only_expected_manual_gate_blocker(blockers: &[CanaryBlocker]) -> bool {
    blockers.len() == 1 && blockers[0].code == "manual_live_gate_absent"
}

fn expected_live_micro_reasons() -> Vec<LiveGateReason> {
    vec![
        LiveGateReason::LiveOrdersDisabled,
        LiveGateReason::ManualConfirmationAbsent,
        LiveGateReason::SecondConfirmationAbsent,
        LiveGateReason::NoExecutableOrderCapability,
    ]
}

fn git_commit(workspace_root: &Path) -> Option<String> {
    let output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(workspace_root)
        .stderr(Stdio::null())
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|commit| !commit.is_empty())
}

fn git_clean(workspace_root: &Path) -> Option<bool> {
    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(workspace_root)
        .stderr(Stdio::null())
        .output()
        .ok()?;
    output.status.success().then_some(output.stdout.is_empty())
}

fn config_safety_flags(engine_config: &EngineConfig) -> BTreeMap<String, String> {
    BTreeMap::from([
        (
            "allow_live_trading".to_string(),
            engine_config.safety.allow_live_trading.to_string(),
        ),
        (
            "allow_live_orders".to_string(),
            engine_config.safety.allow_live_orders.to_string(),
        ),
        (
            "allow_signed_endpoints".to_string(),
            engine_config.safety.allow_signed_endpoints.to_string(),
        ),
        (
            "allow_api_key_loading".to_string(),
            engine_config.safety.allow_api_key_loading.to_string(),
        ),
        (
            "allow_withdrawals".to_string(),
            engine_config.safety.allow_withdrawals.to_string(),
        ),
        (
            "allow_leverage_changes".to_string(),
            engine_config.safety.allow_leverage_changes.to_string(),
        ),
        (
            "max_live_micro_notional_usdt".to_string(),
            engine_config
                .safety
                .max_live_micro_notional_usdt
                .to_string(),
        ),
    ])
}

fn release_check(
    name: impl Into<String>,
    blockers: Vec<ReleaseAuditBlocker>,
    warnings: Vec<ReleaseAuditWarning>,
    pass_summary: &'static str,
) -> ReleaseAuditCheck {
    let passed = blockers.is_empty();
    ReleaseAuditCheck {
        name: name.into(),
        passed,
        summary: if passed {
            pass_summary.to_string()
        } else {
            "release audit check failed".to_string()
        },
        blockers,
        warnings,
    }
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

fn summary_for(checks: &[ReleaseAuditCheck], name: &str) -> String {
    checks
        .iter()
        .find(|check| check.name == name)
        .map(|check| check.summary.clone())
        .unwrap_or_else(|| "check not run".to_string())
}

fn has_blocker(blockers: &[ReleaseAuditBlocker], code: &str) -> bool {
    blockers.iter().any(|blocker| blocker.code == code)
}

fn blocker(code: impl Into<String>, message: impl Into<String>) -> ReleaseAuditBlocker {
    ReleaseAuditBlocker {
        code: code.into(),
        message: message.into(),
    }
}

fn warning(code: impl Into<String>, message: impl Into<String>) -> ReleaseAuditWarning {
    ReleaseAuditWarning {
        code: code.into(),
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use domain::{ManualConfirmationState, PaperEngineState, PaperTrade};
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn safe_default_config_passes_safety_check() {
        let check = config_safety_check(&EngineConfig::default());

        assert!(check.passed);
        assert!(check.blockers.is_empty());
    }

    #[test]
    fn forbidden_live_order_pattern_blocks_release() {
        let dir = fixture_dir("forbidden_release_scan");
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("bad.rs");
        fs::write(&source, ["/fapi/v1/", "order"].concat()).unwrap();
        let mut config = ReleaseAuditConfig {
            workspace_root: dir.display().to_string(),
            source_scan_paths: vec!["bad.rs".to_string()],
            ..minimal_config(&dir)
        };
        config.output = None;

        let report = generate_release_audit_report(&EngineConfig::default(), &config);

        assert!(has_blocker(&report.blockers, "forbidden_capability_found"));
        assert!(!report.release_ready);
        let _ = fs::remove_file(source);
        let _ = fs::remove_dir(dir);
    }

    #[test]
    fn missing_soak_report_warns_not_blocks() {
        let dir = fixture_dir("missing_soak_warns");
        fs::create_dir_all(&dir).unwrap();
        write_safe_inputs(&dir);
        let mut config = minimal_config(&dir);
        config.soak_report = dir.join("missing_soak.json").display().to_string();

        let report = generate_release_audit_report(&EngineConfig::default(), &config);

        assert!(
            report
                .warnings
                .iter()
                .any(|warning| warning.code == "soak_report_missing")
        );
        assert!(!has_blocker(&report.blockers, "soak_report_missing"));
        cleanup_dir(&dir);
    }

    #[test]
    fn dirty_git_blocks_release_when_available() {
        if !git_available() {
            return;
        }
        let dir = fixture_dir("dirty_git");
        fs::create_dir_all(&dir).unwrap();
        if !init_dirty_git_repo(&dir) {
            cleanup_dir(&dir);
            return;
        }
        write_safe_inputs(&dir);
        let config = minimal_config(&dir);

        let report = generate_release_audit_report(&EngineConfig::default(), &config);

        assert_eq!(report.git_clean, Some(false));
        assert!(has_blocker(&report.blockers, "git_dirty"));
        cleanup_dir(&dir);
    }

    #[test]
    fn live_micro_ready_true_blocks_release() {
        let mut live_report = safe_live_micro_report();
        live_report.live_micro_ready = true;

        let check = live_micro_release_check(&live_report);

        assert!(!check.passed);
        assert!(
            check
                .blockers
                .iter()
                .any(|blocker| blocker.code == "live_micro_ready_unexpected")
        );
    }

    #[test]
    fn release_report_writes_local_json() {
        let dir = fixture_dir("write_release_json");
        fs::create_dir_all(&dir).unwrap();
        let output = dir.join("release_audit_report.json");
        let report = minimal_report();

        write_release_audit_report(&output, &report).unwrap();

        let raw = fs::read_to_string(&output).unwrap();
        assert!(raw.contains("\"release_ready\""));
        cleanup_dir(&dir);
    }

    #[test]
    fn output_path_is_local_only() {
        let report = minimal_report();

        let err = write_release_audit_report(Path::new("https://example.com/report.json"), &report)
            .unwrap_err();

        assert!(err.to_string().contains("local file path"));
    }

    fn minimal_config(dir: &Path) -> ReleaseAuditConfig {
        ReleaseAuditConfig {
            workspace_root: dir.display().to_string(),
            backtest_input: dir.join("events.jsonl").display().to_string(),
            paper_state: dir.join("paper_state.json").display().to_string(),
            paper_log: dir.join("paper_trades.jsonl").display().to_string(),
            soak_report: dir.join("soak.json").display().to_string(),
            output: None,
            source_scan_paths: Vec::new(),
            validation_commands_expected: Vec::new(),
        }
    }

    fn write_safe_inputs(dir: &Path) {
        fs::write(
            dir.join("paper_state.json"),
            serde_json::to_string(&PaperEngineState::default()).unwrap(),
        )
        .unwrap();
        fs::write(dir.join("paper_trades.jsonl"), safe_trade_jsonl()).unwrap();
        fs::write(dir.join("events.jsonl"), neutral_event_jsonl()).unwrap();
        fs::write(
            dir.join("soak.json"),
            serde_json::to_string(&safe_soak_report()).unwrap(),
        )
        .unwrap();
    }

    fn safe_trade_jsonl() -> String {
        let trade = PaperTrade {
            trade_id: "paper-1".to_string(),
            tick_id: 1,
            timestamp_ms: 1,
            symbol: domain::Symbol::new("BTCUSDT").unwrap(),
            direction: domain::SignalDirection::Long,
            price: dec!(100),
            notional: dec!(60),
            quantity: dec!(0.6),
            fees_usdt: dec!(0.06),
            realized_pnl_usdt: dec!(-0.06),
            executable: false,
            real_order_id: None,
            candidate_id: "audit-test".to_string(),
        };
        format!("{}\n", serde_json::to_string(&trade).unwrap())
    }

    fn neutral_event_jsonl() -> &'static str {
        r#"{"sequence":1,"timestamp_ms":1,"exchange":"offline","symbol":"BTCUSDT","mark_price":"100","index_price":"100","funding_rate":"0","open_interest":"1000","bid_levels":[{"price":"99.99","quantity":"100"}],"ask_levels":[{"price":"100.01","quantity":"100"}]}"#
    }

    fn safe_soak_report() -> PaperSoakReport {
        PaperSoakReport {
            ticks_requested: 1,
            ticks_processed: 1,
            state_valid: true,
            paper_log_valid: true,
            duplicate_positions_count: 0,
            candidate_decisions_evaluated: 1,
            candidate_generated_count: 0,
            min_ticks_for_candidate_pressure_blocker: 20,
            paper_trades_count: 0,
            open_positions_count: 0,
            realized_pnl_usdt: dec!(0),
            unrealized_pnl_usdt: dec!(0),
            errors_count: 0,
            error_rate: dec!(0),
            max_consecutive_errors: 0,
            transient_error_count: 0,
            fatal_error_count: 0,
            error_breakdown_by_reason: Default::default(),
            ticks_failed: 0,
            endpoint_error_breakdown: Default::default(),
            error_windows: Vec::new(),
            fresh_ticks: 1,
            stale_ticks: 0,
            failed_ticks: 0,
            stale_fallback_count: 0,
            max_stale_age_seconds: 0,
            data_freshness_score: dec!(1),
            critical_endpoint_error_count: 0,
            noncritical_endpoint_error_count: 0,
            critical_fallback_used_count: 0,
            critical_fallback_failed_count: 0,
            mark_price_primary_error_count: 0,
            mark_price_fallback_used_count: 0,
            mark_price_fallback_failed_count: 0,
            orderbook_error_count: 0,
            consecutive_critical_error_windows: Vec::new(),
            signal_grade_distribution: Default::default(),
            signal_direction_distribution: Default::default(),
            rejection_breakdown_by_reason: Default::default(),
            yi_hexagram_distribution: Default::default(),
            yi_action_bias_distribution: Default::default(),
            yi_reason_breakdown: Default::default(),
            god_turnpoint_evaluated_count: 0,
            god_turnpoint_allowed_count: 0,
            god_turnpoint_blocker_breakdown: Default::default(),
            god_turnpoint_warning_breakdown: Default::default(),
            god_signal_pressure_ratio: dec!(0),
            degraded_yi_evaluation_count: 0,
            candidate_pressure_ratio: dec!(0),
            avg_signal_strength: dec!(0),
            max_signal_strength: dec!(0),
            avg_edge_after_cost_ratio: None,
            state_mutation_count: 0,
            paper_equity_start: dec!(200),
            paper_equity_end: dec!(200),
            paper_equity_drift: dec!(0),
            duration_seconds: 0,
            ticks_per_minute: dec!(0),
            warnings: Vec::new(),
            blockers: Vec::new(),
            soak_passed: true,
        }
    }

    fn safe_live_micro_report() -> LiveMicroReadinessReport {
        LiveMicroReadinessReport {
            live_micro_ready: false,
            live_trading_allowed: false,
            live_orders_allowed: false,
            signed_endpoints_allowed: false,
            api_key_loading_allowed: false,
            withdrawals_allowed: false,
            leverage_changes_allowed: false,
            executable_order_capability: false,
            gate_decision: domain::LiveGateDecision {
                live_micro_ready: false,
                live_trading_allowed: false,
                live_orders_allowed: false,
                signed_endpoints_allowed: false,
                reasons: expected_live_micro_reasons(),
                summary: "test".to_string(),
            },
            api_permission_audit: domain::ApiPermissionAuditReport {
                api_key_loading_allowed: false,
                signed_endpoints_allowed: false,
                withdrawals_allowed: false,
                leverage_changes_allowed: false,
                forbidden_patterns_found: Vec::new(),
                blocked: false,
                summary: "test".to_string(),
            },
            manual_confirmation: ManualConfirmationState {
                manual_confirmation_required: true,
                two_step_confirmation_required: true,
                manual_confirmation_env: "one".to_string(),
                second_confirmation_env: "two".to_string(),
                manual_confirmation_present: false,
                second_confirmation_present: false,
            },
            canary_readiness_available: false,
            canary_ready: None,
            paper_soak_report_available: true,
            paper_soak_passed: Some(true),
            git_hygiene_ok: Some(true),
            reasons: expected_live_micro_reasons(),
            blockers: Vec::new(),
            warnings: Vec::new(),
            summary: "test".to_string(),
        }
    }

    fn minimal_report() -> ReleaseAuditReport {
        ReleaseAuditReport {
            git_commit: None,
            git_clean: Some(true),
            config_safety_flags: BTreeMap::new(),
            health_check_summary: "ok".to_string(),
            canary_readiness_summary: "ok".to_string(),
            live_micro_readiness_summary: "ok".to_string(),
            soak_report_summary: "ok".to_string(),
            forbidden_capability_scan_summary: "ok".to_string(),
            validation_commands_expected: Vec::new(),
            release_ready: false,
            checks: Vec::new(),
            blockers: Vec::new(),
            warnings: Vec::new(),
            summary: "test".to_string(),
        }
    }

    fn git_available() -> bool {
        Command::new("git")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    }

    fn init_dirty_git_repo(dir: &Path) -> bool {
        if !Command::new("git")
            .arg("init")
            .current_dir(dir)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
        {
            return false;
        }
        fs::write(dir.join("tracked.txt"), "clean\n").unwrap();
        if !Command::new("git")
            .args(["add", "tracked.txt"])
            .current_dir(dir)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
        {
            return false;
        }
        if !Command::new("git")
            .args([
                "-c",
                "user.email=test@example.com",
                "-c",
                "user.name=Test",
                "commit",
                "-m",
                "init",
            ])
            .current_dir(dir)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
        {
            return false;
        }
        fs::write(dir.join("tracked.txt"), "dirty\n").unwrap();
        true
    }

    fn fixture_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "rustquanteth-release-audit-{name}-{}",
            std::process::id()
        ))
    }

    fn cleanup_dir(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }
}
