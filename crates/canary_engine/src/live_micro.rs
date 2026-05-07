use std::{
    env, fs,
    path::{Path, PathBuf},
};

use domain::{
    ApiPermissionAuditReport, CanaryCheckStatus, CanaryReadinessReport, EngineConfig,
    LiveGateConfig, LiveGateDecision, LiveGateReason, LiveMicroReadinessReport,
    ManualConfirmationState, PaperSoakReport,
};
use rust_decimal::Decimal;

use crate::readiness;

pub const MANUAL_CONFIRMATION_ENV: &str = "RUSTQUANTETH_LIVE_MICRO_CONFIRM";
pub const SECOND_CONFIRMATION_ENV: &str = "RUSTQUANTETH_LIVE_MICRO_CONFIRM_STEP_2";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveMicroReadinessInputs {
    pub workspace_root: PathBuf,
    pub canary_report_path: PathBuf,
    pub paper_soak_report_path: PathBuf,
    pub source_scan_paths: Vec<String>,
}

impl Default for LiveMicroReadinessInputs {
    fn default() -> Self {
        Self {
            workspace_root: PathBuf::from("."),
            canary_report_path: PathBuf::from("data/paper/canary_readiness.json"),
            paper_soak_report_path: PathBuf::from("data/paper/soak_report.json"),
            source_scan_paths: default_source_scan_paths(),
        }
    }
}

pub fn evaluate_live_micro_readiness(
    engine_config: &EngineConfig,
    inputs: &LiveMicroReadinessInputs,
) -> LiveMicroReadinessReport {
    let gate_config = live_gate_config_from_engine(engine_config);
    let manual_state = read_manual_confirmation_state(&gate_config);
    evaluate_live_micro_readiness_with_manual_state(engine_config, inputs, manual_state)
}

pub fn evaluate_live_micro_readiness_with_manual_state(
    engine_config: &EngineConfig,
    inputs: &LiveMicroReadinessInputs,
    manual_state: ManualConfirmationState,
) -> LiveMicroReadinessReport {
    let gate_config = live_gate_config_from_engine(engine_config);
    let mut reasons = Vec::new();
    let mut warnings = Vec::new();

    push_reason(&mut reasons, LiveGateReason::DefaultSafeMode);
    inspect_gate_config(&gate_config, &manual_state, &mut reasons);

    let api_permission_audit = audit_api_permissions(
        &gate_config,
        &inputs.workspace_root,
        &inputs.source_scan_paths,
    );
    if api_permission_audit.blocked {
        push_reason(&mut reasons, LiveGateReason::ApiPermissionAuditBlocked);
    }
    if !api_permission_audit.forbidden_patterns_found.is_empty() {
        push_reason(&mut reasons, LiveGateReason::ForbiddenCapabilityFound);
    }

    let canary = inspect_canary_report(&inputs.canary_report_path, &mut warnings);
    if !canary.available {
        push_reason(&mut reasons, LiveGateReason::CanaryReadinessMissing);
    } else if canary.ready != Some(true) {
        push_reason(&mut reasons, LiveGateReason::CanaryReadinessNotReady);
    }

    let paper_soak = inspect_paper_soak_report(&inputs.paper_soak_report_path, &mut warnings);
    if !paper_soak.available {
        push_reason(&mut reasons, LiveGateReason::PaperSoakReportMissing);
    } else if paper_soak.passed != Some(true) {
        push_reason(&mut reasons, LiveGateReason::PaperSoakNotPassed);
    }

    let git_hygiene_ok = inspect_git_hygiene(&inputs.workspace_root, &mut warnings);
    if git_hygiene_ok == Some(false) {
        push_reason(&mut reasons, LiveGateReason::GitHygieneBlocked);
    }

    // Phase 9 deliberately has no executable order capability. A future live phase
    // must add a separate audited implementation instead of reusing this scaffold.
    let executable_order_capability = false;
    push_reason(&mut reasons, LiveGateReason::NoExecutableOrderCapability);

    let live_micro_ready = false;
    let blockers = reasons
        .iter()
        .map(|reason| reason_key(*reason).to_string())
        .collect::<Vec<_>>();

    let gate_decision = LiveGateDecision {
        live_micro_ready,
        live_trading_allowed: gate_config.allow_live_trading,
        live_orders_allowed: gate_config.allow_live_orders,
        signed_endpoints_allowed: gate_config.allow_signed_endpoints,
        reasons: reasons.clone(),
        summary: "live micro scaffold is audit-only; executable live trading remains disabled"
            .to_string(),
    };

    LiveMicroReadinessReport {
        live_micro_ready,
        live_trading_allowed: gate_config.allow_live_trading,
        live_orders_allowed: gate_config.allow_live_orders,
        signed_endpoints_allowed: gate_config.allow_signed_endpoints,
        api_key_loading_allowed: gate_config.allow_api_key_loading,
        withdrawals_allowed: gate_config.allow_withdrawals,
        leverage_changes_allowed: gate_config.allow_leverage_changes,
        executable_order_capability,
        gate_decision,
        api_permission_audit,
        manual_confirmation: manual_state,
        canary_readiness_available: canary.available,
        canary_ready: canary.ready,
        paper_soak_report_available: paper_soak.available,
        paper_soak_passed: paper_soak.passed,
        git_hygiene_ok,
        reasons,
        blockers,
        warnings,
        summary: "live micro readiness is blocked by design; no live orders or signed endpoints are available"
            .to_string(),
    }
}

pub fn live_gate_config_from_engine(engine_config: &EngineConfig) -> LiveGateConfig {
    LiveGateConfig {
        allow_live_trading: engine_config.safety.allow_live_trading,
        allow_live_orders: engine_config.safety.allow_live_orders,
        allow_signed_endpoints: engine_config.safety.allow_signed_endpoints,
        allow_api_key_loading: engine_config.safety.allow_api_key_loading,
        allow_withdrawals: engine_config.safety.allow_withdrawals,
        allow_leverage_changes: engine_config.safety.allow_leverage_changes,
        max_live_micro_notional_usdt: engine_config.safety.max_live_micro_notional_usdt,
        manual_confirmation_required: engine_config.safety.manual_confirmation_required,
        two_step_confirmation_required: engine_config.safety.two_step_confirmation_required,
    }
}

pub fn read_manual_confirmation_state(config: &LiveGateConfig) -> ManualConfirmationState {
    ManualConfirmationState {
        manual_confirmation_required: config.manual_confirmation_required,
        two_step_confirmation_required: config.two_step_confirmation_required,
        manual_confirmation_env: MANUAL_CONFIRMATION_ENV.to_string(),
        second_confirmation_env: SECOND_CONFIRMATION_ENV.to_string(),
        manual_confirmation_present: env::var_os(MANUAL_CONFIRMATION_ENV).is_some(),
        second_confirmation_present: env::var_os(SECOND_CONFIRMATION_ENV).is_some(),
    }
}

pub fn audit_api_permissions(
    config: &LiveGateConfig,
    workspace_root: &Path,
    source_scan_paths: &[String],
) -> ApiPermissionAuditReport {
    let mut forbidden_patterns_found =
        scan_forbidden_capabilities(workspace_root, source_scan_paths);
    forbidden_patterns_found.sort();
    forbidden_patterns_found.dedup();

    let blocked = config.allow_api_key_loading
        || config.allow_signed_endpoints
        || config.allow_withdrawals
        || config.allow_leverage_changes
        || !forbidden_patterns_found.is_empty();

    ApiPermissionAuditReport {
        api_key_loading_allowed: config.allow_api_key_loading,
        signed_endpoints_allowed: config.allow_signed_endpoints,
        withdrawals_allowed: config.allow_withdrawals,
        leverage_changes_allowed: config.allow_leverage_changes,
        forbidden_patterns_found,
        blocked,
        summary: if blocked {
            "API permission audit found disabled flags or forbidden capability evidence".to_string()
        } else {
            "API permission audit found no key loading, signed endpoint, withdrawal, or leverage-change capability"
                .to_string()
        },
    }
}

fn inspect_gate_config(
    config: &LiveGateConfig,
    manual_state: &ManualConfirmationState,
    reasons: &mut Vec<LiveGateReason>,
) {
    if !config.allow_live_trading {
        push_reason(reasons, LiveGateReason::LiveTradingDisabled);
    }
    if !config.allow_live_orders {
        push_reason(reasons, LiveGateReason::LiveOrdersDisabled);
    }
    if !config.allow_signed_endpoints {
        push_reason(reasons, LiveGateReason::SignedEndpointsDisabled);
    }
    if !config.allow_api_key_loading {
        push_reason(reasons, LiveGateReason::ApiKeyLoadingDisabled);
    }
    if !config.allow_withdrawals {
        push_reason(reasons, LiveGateReason::WithdrawalsDisabled);
    }
    if !config.allow_leverage_changes {
        push_reason(reasons, LiveGateReason::LeverageChangesDisabled);
    }
    if config.max_live_micro_notional_usdt <= Decimal::ZERO {
        push_reason(reasons, LiveGateReason::MaxLiveMicroNotionalZero);
    }
    if config.manual_confirmation_required && !manual_state.manual_confirmation_present {
        push_reason(reasons, LiveGateReason::ManualConfirmationAbsent);
    }
    if config.two_step_confirmation_required && !manual_state.second_confirmation_present {
        push_reason(reasons, LiveGateReason::SecondConfirmationAbsent);
    }
}

fn inspect_canary_report(path: &Path, warnings: &mut Vec<String>) -> OptionalCanaryReport {
    match fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str::<CanaryReadinessReport>(&raw) {
            Ok(report) => OptionalCanaryReport {
                available: true,
                ready: Some(report.ready),
            },
            Err(err) => {
                warnings.push(format!(
                    "canary readiness report could not be parsed: {} ({err})",
                    path.display()
                ));
                OptionalCanaryReport {
                    available: false,
                    ready: None,
                }
            }
        },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => OptionalCanaryReport {
            available: false,
            ready: None,
        },
        Err(err) => {
            warnings.push(format!(
                "canary readiness report could not be read: {} ({err})",
                path.display()
            ));
            OptionalCanaryReport {
                available: false,
                ready: None,
            }
        }
    }
}

fn inspect_paper_soak_report(path: &Path, warnings: &mut Vec<String>) -> OptionalPaperSoakReport {
    match fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str::<PaperSoakReport>(&raw) {
            Ok(report) => OptionalPaperSoakReport {
                available: true,
                passed: Some(report.soak_passed),
            },
            Err(err) => {
                warnings.push(format!(
                    "paper soak report could not be parsed: {} ({err})",
                    path.display()
                ));
                OptionalPaperSoakReport {
                    available: false,
                    passed: None,
                }
            }
        },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => OptionalPaperSoakReport {
            available: false,
            passed: None,
        },
        Err(err) => {
            warnings.push(format!(
                "paper soak report could not be read: {} ({err})",
                path.display()
            ));
            OptionalPaperSoakReport {
                available: false,
                passed: None,
            }
        }
    }
}

fn inspect_git_hygiene(workspace_root: &Path, warnings: &mut Vec<String>) -> Option<bool> {
    let result = readiness::git_hygiene_check(workspace_root);
    warnings.extend(result.warnings);
    match result.status {
        CanaryCheckStatus::Pass | CanaryCheckStatus::Warn => Some(true),
        CanaryCheckStatus::Fail => Some(false),
    }
}

fn scan_forbidden_capabilities(workspace_root: &Path, scan_paths: &[String]) -> Vec<String> {
    let mut findings = Vec::new();
    for scan_path in scan_paths {
        let path = workspace_root.join(scan_path);
        if let Ok(files) = collect_rs_files(&path) {
            for file in files {
                if let Ok(raw) = fs::read_to_string(&file) {
                    scan_source_file(&file, &raw, &mut findings);
                }
            }
        }
    }
    findings
}

fn scan_source_file(file: &Path, raw: &str, findings: &mut Vec<String>) {
    let lowered = raw.to_ascii_lowercase();
    for (code, pattern) in banned_patterns() {
        if lowered.contains(&pattern) {
            findings.push(format!("{code}:{}", file.display()));
        }
    }
}

fn banned_patterns() -> Vec<(&'static str, String)> {
    vec![
        ("signed_order_endpoint", ["/fapi/v1/", "order"].concat()),
        ("spot_order_endpoint", ["/api/v3/", "order"].concat()),
        ("leverage_endpoint", ["/fapi/v1/", "leverage"].concat()),
        (
            "withdrawal_endpoint",
            ["/sapi/v1/capital/", "withdraw"].concat(),
        ),
        ("withdrawal_endpoint", ["/withdraw/", "apply"].concat()),
        ("api_key_env", ["binance_", "api_key"].concat()),
        ("api_secret_env", ["binance_", "api_secret"].concat()),
        ("api_secret_env", ["api_", "secret"].concat()),
        ("secret_key_env", ["secret_", "key"].concat()),
        ("signed_header", ["x-mbx-", "apikey"].concat()),
        ("signature_param", ["signature", "="].concat()),
        (
            "real_order_id_assignment",
            ["real_order_id", ": some"].concat(),
        ),
        (
            "real_order_id_assignment",
            ["real_order_id", " = some"].concat(),
        ),
    ]
}

fn collect_rs_files(path: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    if path.is_file() {
        if path.extension().is_some_and(|extension| extension == "rs") {
            files.push(path.to_path_buf());
        }
        return Ok(files);
    }
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let child = entry.path();
        if child.is_dir() {
            files.extend(collect_rs_files(&child)?);
        } else if child.extension().is_some_and(|extension| extension == "rs") {
            files.push(child);
        }
    }
    Ok(files)
}

fn default_source_scan_paths() -> Vec<String> {
    vec![
        "crates/backtest/src".to_string(),
        "crates/cost_engine/src".to_string(),
        "crates/domain/src".to_string(),
        "crates/exchange/src".to_string(),
        "crates/execution_engine/src".to_string(),
        "crates/feature_engine/src".to_string(),
        "crates/market_data/src".to_string(),
        "crates/paper_engine/src".to_string(),
        "crates/risk_engine/src".to_string(),
        "crates/signal_engine/src".to_string(),
        "crates/state_engine/src".to_string(),
        "crates/withdrawal_engine/src".to_string(),
        "crates/cli/src".to_string(),
    ]
}

fn push_reason(reasons: &mut Vec<LiveGateReason>, reason: LiveGateReason) {
    if !reasons.contains(&reason) {
        reasons.push(reason);
    }
}

fn reason_key(reason: LiveGateReason) -> &'static str {
    match reason {
        LiveGateReason::DefaultSafeMode => "default_safe_mode",
        LiveGateReason::LiveTradingDisabled => "live_trading_disabled",
        LiveGateReason::LiveOrdersDisabled => "live_orders_disabled",
        LiveGateReason::SignedEndpointsDisabled => "signed_endpoints_disabled",
        LiveGateReason::ApiKeyLoadingDisabled => "api_key_loading_disabled",
        LiveGateReason::WithdrawalsDisabled => "withdrawals_disabled",
        LiveGateReason::LeverageChangesDisabled => "leverage_changes_disabled",
        LiveGateReason::MaxLiveMicroNotionalZero => "max_live_micro_notional_zero",
        LiveGateReason::ManualConfirmationAbsent => "manual_confirmation_absent",
        LiveGateReason::SecondConfirmationAbsent => "second_confirmation_absent",
        LiveGateReason::CanaryReadinessMissing => "canary_readiness_missing",
        LiveGateReason::CanaryReadinessNotReady => "canary_readiness_not_ready",
        LiveGateReason::PaperSoakReportMissing => "paper_soak_report_missing",
        LiveGateReason::PaperSoakNotPassed => "paper_soak_not_passed",
        LiveGateReason::GitHygieneBlocked => "git_hygiene_blocked",
        LiveGateReason::ForbiddenCapabilityFound => "forbidden_capability_found",
        LiveGateReason::ApiPermissionAuditBlocked => "api_permission_audit_blocked",
        LiveGateReason::NoExecutableOrderCapability => "no_executable_order_capability",
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct OptionalCanaryReport {
    available: bool,
    ready: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct OptionalPaperSoakReport {
    available: bool,
    passed: Option<bool>,
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use domain::{
        CanaryReadinessReport, ManualConfirmationState, PaperSoakReport, PaperSoakWarning,
    };
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn default_config_blocks_live_micro() {
        let report = evaluate_live_micro_readiness_with_manual_state(
            &EngineConfig::default(),
            &empty_inputs("default_blocks"),
            absent_manual_state(),
        );

        assert!(!report.live_micro_ready);
        assert!(!report.live_trading_allowed);
        assert!(!report.live_orders_allowed);
        assert!(has_reason(
            &report,
            LiveGateReason::ManualConfirmationAbsent
        ));
        assert!(has_reason(&report, LiveGateReason::LiveOrdersDisabled));
    }

    #[test]
    fn allow_live_orders_false_blocks_live_micro() {
        let report = evaluate_live_micro_readiness_with_manual_state(
            &EngineConfig::default(),
            &empty_inputs("orders_disabled"),
            confirmed_manual_state(),
        );

        assert!(!report.live_orders_allowed);
        assert!(has_reason(&report, LiveGateReason::LiveOrdersDisabled));
    }

    #[test]
    fn signed_endpoints_withdrawals_and_leverage_changes_disabled_by_default() {
        let report = evaluate_live_micro_readiness_with_manual_state(
            &EngineConfig::default(),
            &empty_inputs("capabilities_disabled"),
            confirmed_manual_state(),
        );

        assert!(!report.signed_endpoints_allowed);
        assert!(!report.withdrawals_allowed);
        assert!(!report.leverage_changes_allowed);
        assert!(has_reason(&report, LiveGateReason::SignedEndpointsDisabled));
        assert!(has_reason(&report, LiveGateReason::WithdrawalsDisabled));
        assert!(has_reason(&report, LiveGateReason::LeverageChangesDisabled));
    }

    #[test]
    fn api_key_loading_disabled_by_default() {
        let report = evaluate_live_micro_readiness_with_manual_state(
            &EngineConfig::default(),
            &empty_inputs("api_key_loading_disabled"),
            confirmed_manual_state(),
        );

        assert!(!report.api_key_loading_allowed);
        assert!(!report.api_permission_audit.api_key_loading_allowed);
        assert!(has_reason(&report, LiveGateReason::ApiKeyLoadingDisabled));
    }

    #[test]
    fn missing_manual_confirmation_blocks() {
        let report = evaluate_live_micro_readiness_with_manual_state(
            &EngineConfig::default(),
            &empty_inputs("missing_manual"),
            absent_manual_state(),
        );

        assert!(has_reason(
            &report,
            LiveGateReason::ManualConfirmationAbsent
        ));
    }

    #[test]
    fn missing_second_confirmation_blocks() {
        let mut manual_state = confirmed_manual_state();
        manual_state.second_confirmation_present = false;

        let report = evaluate_live_micro_readiness_with_manual_state(
            &EngineConfig::default(),
            &empty_inputs("missing_second"),
            manual_state,
        );

        assert!(has_reason(
            &report,
            LiveGateReason::SecondConfirmationAbsent
        ));
    }

    #[test]
    fn forbidden_capability_scan_catches_banned_patterns() {
        let dir = fixture_dir("live_forbidden_scan");
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("bad.rs");
        fs::write(&source, ["/fapi/v1/", "order"].concat()).unwrap();
        let config = LiveGateConfig::default();

        let audit = audit_api_permissions(&config, &dir, &["bad.rs".to_string()]);

        assert!(audit.blocked);
        assert!(
            audit
                .forbidden_patterns_found
                .iter()
                .any(|finding| finding.contains("signed_order_endpoint"))
        );
        let _ = fs::remove_file(source);
        let _ = fs::remove_dir(dir);
    }

    #[test]
    fn clean_reports_still_not_ready_without_manual_gate() {
        let dir = fixture_dir("clean_reports_without_manual");
        fs::create_dir_all(&dir).unwrap();
        let canary_path = dir.join("canary.json");
        let soak_path = dir.join("soak.json");
        fs::write(
            &canary_path,
            serde_json::to_string(&clean_canary_report()).unwrap(),
        )
        .unwrap();
        fs::write(
            &soak_path,
            serde_json::to_string(&clean_soak_report()).unwrap(),
        )
        .unwrap();
        let inputs = LiveMicroReadinessInputs {
            workspace_root: dir.clone(),
            canary_report_path: canary_path.clone(),
            paper_soak_report_path: soak_path.clone(),
            source_scan_paths: Vec::new(),
        };

        let report = evaluate_live_micro_readiness_with_manual_state(
            &EngineConfig::default(),
            &inputs,
            absent_manual_state(),
        );

        assert!(!report.live_micro_ready);
        assert_eq!(report.canary_ready, Some(true));
        assert_eq!(report.paper_soak_passed, Some(true));
        assert!(has_reason(
            &report,
            LiveGateReason::ManualConfirmationAbsent
        ));
        let _ = fs::remove_file(canary_path);
        let _ = fs::remove_file(soak_path);
        let _ = fs::remove_dir(dir);
    }

    #[test]
    fn no_executable_order_id_can_be_produced() {
        let report = evaluate_live_micro_readiness_with_manual_state(
            &EngineConfig::default(),
            &empty_inputs("no_executable_order"),
            confirmed_manual_state(),
        );

        assert!(!report.executable_order_capability);
        assert!(has_reason(
            &report,
            LiveGateReason::NoExecutableOrderCapability
        ));
    }

    fn has_reason(report: &LiveMicroReadinessReport, reason: LiveGateReason) -> bool {
        report.reasons.contains(&reason)
    }

    fn absent_manual_state() -> ManualConfirmationState {
        ManualConfirmationState {
            manual_confirmation_required: true,
            two_step_confirmation_required: true,
            manual_confirmation_env: MANUAL_CONFIRMATION_ENV.to_string(),
            second_confirmation_env: SECOND_CONFIRMATION_ENV.to_string(),
            manual_confirmation_present: false,
            second_confirmation_present: false,
        }
    }

    fn confirmed_manual_state() -> ManualConfirmationState {
        ManualConfirmationState {
            manual_confirmation_present: true,
            second_confirmation_present: true,
            ..absent_manual_state()
        }
    }

    fn empty_inputs(name: &str) -> LiveMicroReadinessInputs {
        let dir = fixture_dir(name);
        LiveMicroReadinessInputs {
            workspace_root: dir,
            canary_report_path: PathBuf::from(format!("{name}-missing-canary.json")),
            paper_soak_report_path: PathBuf::from(format!("{name}-missing-soak.json")),
            source_scan_paths: Vec::new(),
        }
    }

    fn clean_canary_report() -> CanaryReadinessReport {
        CanaryReadinessReport {
            ready: true,
            checks: Vec::new(),
            blockers: Vec::new(),
            warnings: Vec::new(),
            summary: "clean test canary".to_string(),
            live_trading_allowed: false,
            executable_order_capability: false,
        }
    }

    fn clean_soak_report() -> PaperSoakReport {
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
            signal_grade_distribution: Default::default(),
            signal_direction_distribution: Default::default(),
            rejection_breakdown_by_reason: Default::default(),
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
            warnings: vec![PaperSoakWarning {
                code: "zero_paper_trades".to_string(),
                message: "paper soak completed with zero paper trades".to_string(),
            }],
            blockers: Vec::new(),
            soak_passed: true,
        }
    }

    fn fixture_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "rustquanteth-live-micro-{name}-{}",
            std::process::id()
        ))
    }
}
