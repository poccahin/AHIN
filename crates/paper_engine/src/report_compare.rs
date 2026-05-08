use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

use domain::{
    PaperSoakBlocker, PaperSoakComparisonBlocker, PaperSoakComparisonReport,
    PaperSoakComparisonWarning, PaperSoakErrorReason, PaperSoakMetricDelta, PaperSoakReport,
};
use rust_decimal::Decimal;

use crate::paper_state;

const REJECTION_MATERIAL_DELTA: i64 = 5;

pub fn compare_report_files(
    baseline_path: impl AsRef<Path>,
    candidate_path: impl AsRef<Path>,
) -> PaperSoakComparisonReport {
    let baseline_path = baseline_path.as_ref();
    let candidate_path = candidate_path.as_ref();
    let mut blockers = Vec::new();

    let baseline = read_report(baseline_path, "baseline", &mut blockers);
    let candidate = read_report(candidate_path, "candidate", &mut blockers);

    match (baseline, candidate) {
        (Some(baseline), Some(candidate)) => compare_reports(
            baseline_path,
            candidate_path,
            &baseline,
            &candidate,
            blockers,
        ),
        _ => finalize_report(
            baseline_path,
            candidate_path,
            ComparisonParts {
                blockers,
                ..Default::default()
            },
        ),
    }
}

pub fn compare_reports(
    baseline_path: &Path,
    candidate_path: &Path,
    baseline: &PaperSoakReport,
    candidate: &PaperSoakReport,
    mut blockers: Vec<PaperSoakComparisonBlocker>,
) -> PaperSoakComparisonReport {
    let mut warnings = Vec::new();

    let metric_deltas = metric_deltas(baseline, candidate);
    let rejection_breakdown_delta = map_delta(
        &baseline.rejection_breakdown_by_reason,
        &candidate.rejection_breakdown_by_reason,
    );
    let signal_grade_distribution_delta = map_delta(
        &baseline.signal_grade_distribution,
        &candidate.signal_grade_distribution,
    );
    let signal_direction_distribution_delta = map_delta(
        &baseline.signal_direction_distribution,
        &candidate.signal_direction_distribution,
    );

    add_blockers(candidate, baseline, &mut blockers);
    add_warnings(
        baseline,
        candidate,
        &rejection_breakdown_delta,
        &mut warnings,
    );

    finalize_report(
        baseline_path,
        candidate_path,
        ComparisonParts {
            metric_deltas,
            rejection_breakdown_delta,
            signal_grade_distribution_delta,
            signal_direction_distribution_delta,
            warnings,
            blockers,
        },
    )
}

fn read_report(
    path: &Path,
    label: &str,
    blockers: &mut Vec<PaperSoakComparisonBlocker>,
) -> Option<PaperSoakReport> {
    if let Err(err) = paper_state::ensure_local_file_path(path) {
        blockers.push(blocker(
            format!("{label}_report_unreadable"),
            format!("{label} report path is invalid: {err}"),
        ));
        return None;
    }

    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(err) => {
            blockers.push(blocker(
                format!("{label}_report_unreadable"),
                format!(
                    "{label} report is missing or unreadable: {} ({err})",
                    path.display()
                ),
            ));
            return None;
        }
    };

    match serde_json::from_str::<PaperSoakReport>(&raw) {
        Ok(mut report) => {
            normalize_legacy_loop_error_fields(&mut report);
            Some(report)
        }
        Err(err) => {
            blockers.push(blocker(
                format!("{label}_report_parse_failed"),
                format!("{label} report JSON parse failed: {err}"),
            ));
            None
        }
    }
}

fn normalize_legacy_loop_error_fields(report: &mut PaperSoakReport) {
    let ticks_failed = report.ticks_failed.max(report.errors_count);
    if ticks_failed == 0 {
        return;
    }

    if report.ticks_failed == 0 {
        report.ticks_failed = ticks_failed;
    }
    if report.error_rate == Decimal::ZERO {
        let denominator = report
            .ticks_requested
            .max(report.ticks_processed.saturating_add(ticks_failed))
            .max(1);
        report.error_rate = Decimal::from(ticks_failed) / Decimal::from(denominator);
    }
    if report.transient_error_count == 0 && report.fatal_error_count == 0 {
        report.transient_error_count = ticks_failed;
    }
    if report.error_breakdown_by_reason.is_empty() {
        report.error_breakdown_by_reason.insert(
            PaperSoakErrorReason::TransientMarketDataError
                .as_key()
                .to_string(),
            ticks_failed,
        );
    }
}

fn add_blockers(
    candidate: &PaperSoakReport,
    baseline: &PaperSoakReport,
    blockers: &mut Vec<PaperSoakComparisonBlocker>,
) {
    let untolerated_blockers = untolerated_candidate_blockers(candidate);
    if !untolerated_blockers.is_empty() {
        blockers.push(blocker(
            "candidate_report_blockers",
            format!(
                "candidate report contains {} soak blockers",
                untolerated_blockers.len()
            ),
        ));
    }
    if untolerated_blockers
        .iter()
        .any(|candidate_blocker| is_loop_error_blocker(&candidate_blocker.code))
    {
        blockers.push(blocker(
            "candidate_loop_error_blocker",
            "candidate report contains blocking loop error diagnostics",
        ));
    }
    if !candidate.soak_passed && !candidate_has_only_tolerated_loop_blockers(candidate) {
        blockers.push(blocker(
            "candidate_soak_failed",
            "candidate report has soak_passed=false",
        ));
    }
    if candidate.candidate_pressure_ratio > pressure_blocker_threshold()
        && candidate.candidate_pressure_ratio > baseline.candidate_pressure_ratio
    {
        blockers.push(blocker(
            "candidate_pressure_ratio_blocker",
            "candidate pressure ratio increased above the comparison blocker threshold",
        ));
    }
    if contains_live_order_evidence(candidate) {
        blockers.push(blocker(
            "candidate_live_order_evidence",
            "candidate report contains executable or real_order_id evidence",
        ));
    }
}

fn add_warnings(
    baseline: &PaperSoakReport,
    candidate: &PaperSoakReport,
    rejection_breakdown_delta: &BTreeMap<String, i64>,
    warnings: &mut Vec<PaperSoakComparisonWarning>,
) {
    let pressure_delta = candidate.candidate_pressure_ratio - baseline.candidate_pressure_ratio;
    if pressure_delta > pressure_warning_delta() {
        warnings.push(warning(
            "candidate_pressure_ratio_increased",
            "candidate pressure ratio increased materially",
        ));
    }
    if baseline.paper_trades_count == 0 && candidate.paper_trades_count == 0 {
        warnings.push(warning(
            "zero_paper_trades_in_both_reports",
            "baseline and candidate both contain zero paper trades",
        ));
    }
    if candidate.paper_equity_drift < baseline.paper_equity_drift {
        warnings.push(warning(
            "paper_equity_drift_worsened",
            "candidate paper equity drift is worse than baseline",
        ));
    }
    if rejection_breakdown_delta
        .values()
        .any(|delta| delta.abs() >= REJECTION_MATERIAL_DELTA)
    {
        warnings.push(warning(
            "rejection_breakdown_changed_materially",
            "candidate rejection breakdown changed materially",
        ));
    }
    if candidate_has_tolerated_legacy_loop_blocker(candidate) {
        warnings.push(warning(
            "candidate_legacy_transient_loop_errors_tolerated",
            "candidate report has legacy low-rate transient loop errors that were tolerated",
        ));
    }
}

fn untolerated_candidate_blockers(candidate: &PaperSoakReport) -> Vec<&PaperSoakBlocker> {
    candidate
        .blockers
        .iter()
        .filter(|candidate_blocker| !candidate_blocker_tolerated(candidate, candidate_blocker))
        .collect()
}

fn candidate_has_only_tolerated_loop_blockers(candidate: &PaperSoakReport) -> bool {
    !candidate.blockers.is_empty()
        && candidate
            .blockers
            .iter()
            .all(|candidate_blocker| candidate_blocker_tolerated(candidate, candidate_blocker))
}

fn candidate_has_tolerated_legacy_loop_blocker(candidate: &PaperSoakReport) -> bool {
    candidate
        .blockers
        .iter()
        .any(|candidate_blocker| candidate_blocker_tolerated(candidate, candidate_blocker))
}

fn candidate_blocker_tolerated(
    candidate: &PaperSoakReport,
    candidate_blocker: &PaperSoakBlocker,
) -> bool {
    candidate_blocker.code == "paper_loop_errors" && is_low_rate_transient_loop_report(candidate)
}

fn is_low_rate_transient_loop_report(candidate: &PaperSoakReport) -> bool {
    let ticks_failed = candidate.ticks_failed.max(candidate.errors_count);
    if ticks_failed == 0 {
        return false;
    }
    let denominator = candidate
        .ticks_requested
        .max(candidate.ticks_processed.saturating_add(ticks_failed))
        .max(1);
    let inferred_error_rate = Decimal::from(ticks_failed) / Decimal::from(denominator);
    let error_rate = if candidate.error_rate > Decimal::ZERO {
        candidate.error_rate
    } else {
        inferred_error_rate
    };

    error_rate <= Decimal::new(1, 3)
        && candidate.max_consecutive_errors <= 2
        && candidate.fatal_error_count == 0
        && candidate.candidate_generated_count == 0
        && candidate.paper_trades_count == 0
        && candidate.open_positions_count == 0
        && candidate.state_mutation_count == 0
        && !contains_live_order_evidence(candidate)
}

fn is_loop_error_blocker(code: &str) -> bool {
    matches!(
        code,
        "paper_loop_errors"
            | "loop_error_rate_excessive"
            | "consecutive_loop_errors"
            | "critical_failed_tick_rate_excessive"
            | "consecutive_critical_endpoint_errors"
            | "fatal_loop_error"
            | "state_mutation_on_failed_tick"
            | "forbidden_capability_error"
    )
}

fn metric_deltas(
    baseline: &PaperSoakReport,
    candidate: &PaperSoakReport,
) -> Vec<PaperSoakMetricDelta> {
    vec![
        bool_delta("soak_passed", baseline.soak_passed, candidate.soak_passed),
        count_delta(
            "blockers_count",
            baseline.blockers.len() as u64,
            candidate.blockers.len() as u64,
        ),
        count_delta(
            "warnings_count",
            baseline.warnings.len() as u64,
            candidate.warnings.len() as u64,
        ),
        count_delta(
            "errors_count",
            baseline.errors_count,
            candidate.errors_count,
        ),
        decimal_delta("error_rate", baseline.error_rate, candidate.error_rate),
        count_delta(
            "max_consecutive_errors",
            baseline.max_consecutive_errors,
            candidate.max_consecutive_errors,
        ),
        count_delta(
            "transient_error_count",
            baseline.transient_error_count,
            candidate.transient_error_count,
        ),
        count_delta(
            "fatal_error_count",
            baseline.fatal_error_count,
            candidate.fatal_error_count,
        ),
        count_delta(
            "ticks_failed",
            baseline.ticks_failed,
            candidate.ticks_failed,
        ),
        decimal_delta(
            "candidate_pressure_ratio",
            baseline.candidate_pressure_ratio,
            candidate.candidate_pressure_ratio,
        ),
        count_delta(
            "candidate_generated_count",
            baseline.candidate_generated_count,
            candidate.candidate_generated_count,
        ),
        count_delta(
            "paper_trades_count",
            baseline.paper_trades_count,
            candidate.paper_trades_count,
        ),
        count_delta(
            "open_positions_count",
            baseline.open_positions_count,
            candidate.open_positions_count,
        ),
        decimal_delta(
            "avg_signal_strength",
            baseline.avg_signal_strength,
            candidate.avg_signal_strength,
        ),
        decimal_delta(
            "max_signal_strength",
            baseline.max_signal_strength,
            candidate.max_signal_strength,
        ),
        optional_decimal_delta(
            "avg_edge_after_cost_ratio",
            baseline.avg_edge_after_cost_ratio,
            candidate.avg_edge_after_cost_ratio,
        ),
        decimal_delta(
            "paper_equity_drift",
            baseline.paper_equity_drift,
            candidate.paper_equity_drift,
        ),
    ]
}

fn pressure_warning_delta() -> Decimal {
    Decimal::new(5, 2)
}

fn pressure_blocker_threshold() -> Decimal {
    Decimal::new(5, 1)
}

fn bool_delta(metric: &str, baseline: bool, candidate: bool) -> PaperSoakMetricDelta {
    PaperSoakMetricDelta {
        metric: metric.to_string(),
        baseline: baseline.to_string(),
        candidate: candidate.to_string(),
        delta: None,
    }
}

fn count_delta(metric: &str, baseline: u64, candidate: u64) -> PaperSoakMetricDelta {
    decimal_delta(metric, Decimal::from(baseline), Decimal::from(candidate))
}

fn decimal_delta(metric: &str, baseline: Decimal, candidate: Decimal) -> PaperSoakMetricDelta {
    PaperSoakMetricDelta {
        metric: metric.to_string(),
        baseline: baseline.to_string(),
        candidate: candidate.to_string(),
        delta: Some(candidate - baseline),
    }
}

fn optional_decimal_delta(
    metric: &str,
    baseline: Option<Decimal>,
    candidate: Option<Decimal>,
) -> PaperSoakMetricDelta {
    PaperSoakMetricDelta {
        metric: metric.to_string(),
        baseline: baseline.map_or_else(|| "null".to_string(), |value| value.to_string()),
        candidate: candidate.map_or_else(|| "null".to_string(), |value| value.to_string()),
        delta: baseline
            .zip(candidate)
            .map(|(baseline, candidate)| candidate - baseline),
    }
}

fn map_delta(
    baseline: &BTreeMap<String, u64>,
    candidate: &BTreeMap<String, u64>,
) -> BTreeMap<String, i64> {
    let keys = baseline
        .keys()
        .chain(candidate.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    keys.into_iter()
        .map(|key| {
            let baseline = *baseline.get(&key).unwrap_or(&0) as i64;
            let candidate = *candidate.get(&key).unwrap_or(&0) as i64;
            (key, candidate - baseline)
        })
        .collect()
}

fn contains_live_order_evidence(report: &PaperSoakReport) -> bool {
    report.blockers.iter().any(|blocker| {
        contains_live_order_marker(&blocker.code) || contains_live_order_marker(&blocker.message)
    }) || report.warnings.iter().any(|warning| {
        contains_live_order_marker(&warning.code) || contains_live_order_marker(&warning.message)
    })
}

fn contains_live_order_marker(value: &str) -> bool {
    let lowered = value.to_ascii_lowercase();
    lowered.contains("executable")
        || lowered.contains("real_order_id")
        || lowered.contains("real order id")
}

#[derive(Debug, Default)]
struct ComparisonParts {
    metric_deltas: Vec<PaperSoakMetricDelta>,
    rejection_breakdown_delta: BTreeMap<String, i64>,
    signal_grade_distribution_delta: BTreeMap<String, i64>,
    signal_direction_distribution_delta: BTreeMap<String, i64>,
    warnings: Vec<PaperSoakComparisonWarning>,
    blockers: Vec<PaperSoakComparisonBlocker>,
}

fn finalize_report(
    baseline_path: &Path,
    candidate_path: &Path,
    parts: ComparisonParts,
) -> PaperSoakComparisonReport {
    let comparison_passed = parts.blockers.is_empty();
    let summary = if comparison_passed {
        "paper soak comparison passed; candidate report has no blocking regressions".to_string()
    } else {
        "paper soak comparison blocked; candidate report requires review".to_string()
    };

    PaperSoakComparisonReport {
        baseline_path: baseline_path.display().to_string(),
        candidate_path: candidate_path.display().to_string(),
        comparison_passed,
        metric_deltas: parts.metric_deltas,
        rejection_breakdown_delta: parts.rejection_breakdown_delta,
        signal_grade_distribution_delta: parts.signal_grade_distribution_delta,
        signal_direction_distribution_delta: parts.signal_direction_distribution_delta,
        warnings: parts.warnings,
        blockers: parts.blockers,
        summary,
    }
}

fn warning(code: impl Into<String>, message: impl Into<String>) -> PaperSoakComparisonWarning {
    PaperSoakComparisonWarning {
        code: code.into(),
        message: message.into(),
    }
}

fn blocker(code: impl Into<String>, message: impl Into<String>) -> PaperSoakComparisonBlocker {
    PaperSoakComparisonBlocker {
        code: code.into(),
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use domain::{PaperSoakBlocker, PaperSoakErrorReason, PaperSoakWarning};
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn compares_two_valid_reports() {
        let paths = FixturePaths::new("valid_reports");
        write_report(&paths.baseline, &report(dec!(0.1), 1, 1, dec!(0)));
        write_report(&paths.candidate, &report(dec!(0.12), 2, 1, dec!(0.1)));

        let comparison = compare_report_files(&paths.baseline, &paths.candidate);

        assert!(comparison.comparison_passed);
        assert!(comparison.blockers.is_empty());
        assert_eq!(
            metric_delta(&comparison, "candidate_generated_count"),
            Some(dec!(1))
        );
        assert_eq!(comparison.signal_grade_distribution_delta["a_plus"], 1);
        paths.cleanup();
    }

    #[test]
    fn missing_baseline_blocks() {
        let paths = FixturePaths::new("missing_baseline");
        write_report(&paths.candidate, &report(dec!(0.1), 1, 1, dec!(0)));

        let comparison = compare_report_files(&paths.baseline, &paths.candidate);

        assert!(!comparison.comparison_passed);
        assert!(has_blocker(&comparison, "baseline_report_unreadable"));
        paths.cleanup();
    }

    #[test]
    fn missing_candidate_blocks() {
        let paths = FixturePaths::new("missing_candidate");
        write_report(&paths.baseline, &report(dec!(0.1), 1, 1, dec!(0)));

        let comparison = compare_report_files(&paths.baseline, &paths.candidate);

        assert!(!comparison.comparison_passed);
        assert!(has_blocker(&comparison, "candidate_report_unreadable"));
        paths.cleanup();
    }

    #[test]
    fn candidate_with_blockers_blocks_comparison() {
        let paths = FixturePaths::new("candidate_blockers");
        write_report(&paths.baseline, &report(dec!(0.1), 1, 1, dec!(0)));
        let mut candidate = report(dec!(0.1), 1, 1, dec!(0));
        candidate.soak_passed = false;
        candidate.blockers.push(PaperSoakBlocker {
            code: "paper_log_executable_trade".to_string(),
            message: "paper log line has executable=true".to_string(),
        });
        write_report(&paths.candidate, &candidate);

        let comparison = compare_report_files(&paths.baseline, &paths.candidate);

        assert!(!comparison.comparison_passed);
        assert!(has_blocker(&comparison, "candidate_report_blockers"));
        assert!(has_blocker(&comparison, "candidate_soak_failed"));
        assert!(has_blocker(&comparison, "candidate_live_order_evidence"));
        paths.cleanup();
    }

    #[test]
    fn pressure_increase_warning_works() {
        let paths = FixturePaths::new("pressure_warning");
        write_report(&paths.baseline, &report(dec!(0.1), 1, 1, dec!(0)));
        write_report(&paths.candidate, &report(dec!(0.2), 2, 2, dec!(0)));

        let comparison = compare_report_files(&paths.baseline, &paths.candidate);

        assert!(comparison.comparison_passed);
        assert!(has_warning(
            &comparison,
            "candidate_pressure_ratio_increased"
        ));
        paths.cleanup();
    }

    #[test]
    fn low_rate_transient_loop_warnings_do_not_block_comparison() {
        let paths = FixturePaths::new("low_rate_transient_warning");
        write_report(&paths.baseline, &report(dec!(0), 0, 0, dec!(0)));
        write_report(&paths.candidate, &low_rate_transient_warning_report());

        let comparison = compare_report_files(&paths.baseline, &paths.candidate);

        assert!(comparison.comparison_passed);
        assert!(comparison.blockers.is_empty());
        assert_eq!(metric_delta(&comparison, "ticks_failed"), Some(dec!(3)));
        paths.cleanup();
    }

    #[test]
    fn legacy_low_rate_paper_loop_error_blocker_is_tolerated() {
        let paths = FixturePaths::new("legacy_low_rate_transient_blocker");
        write_report(&paths.baseline, &report(dec!(0), 0, 0, dec!(0)));
        let mut candidate = low_rate_transient_warning_report();
        candidate.soak_passed = false;
        candidate.error_rate = dec!(0);
        candidate.max_consecutive_errors = 0;
        candidate.transient_error_count = 0;
        candidate.error_breakdown_by_reason.clear();
        candidate.ticks_failed = 0;
        candidate.blockers.push(PaperSoakBlocker {
            code: "paper_loop_errors".to_string(),
            message: "paper loop errors: 3".to_string(),
        });
        write_report(&paths.candidate, &candidate);

        let comparison = compare_report_files(&paths.baseline, &paths.candidate);

        assert!(comparison.comparison_passed);
        assert!(!has_blocker(&comparison, "candidate_report_blockers"));
        assert!(!has_blocker(&comparison, "candidate_soak_failed"));
        assert_eq!(metric_delta(&comparison, "ticks_failed"), Some(dec!(3)));
        assert!(metric_delta(&comparison, "error_rate").unwrap() > dec!(0));
        assert!(has_warning(
            &comparison,
            "candidate_legacy_transient_loop_errors_tolerated"
        ));
        paths.cleanup();
    }

    #[test]
    fn fatal_loop_blocker_blocks_comparison() {
        let paths = FixturePaths::new("fatal_loop_blocker");
        write_report(&paths.baseline, &report(dec!(0), 0, 0, dec!(0)));
        let mut candidate = report(dec!(0), 0, 0, dec!(0));
        candidate.soak_passed = false;
        candidate.errors_count = 1;
        candidate.ticks_failed = 1;
        candidate.fatal_error_count = 1;
        candidate.error_breakdown_by_reason.insert(
            PaperSoakErrorReason::StatePersistenceError
                .as_key()
                .to_string(),
            1,
        );
        candidate.blockers.push(PaperSoakBlocker {
            code: "fatal_loop_error".to_string(),
            message: "paper soak observed 1 fatal loop errors".to_string(),
        });
        write_report(&paths.candidate, &candidate);

        let comparison = compare_report_files(&paths.baseline, &paths.candidate);

        assert!(!comparison.comparison_passed);
        assert!(has_blocker(&comparison, "candidate_report_blockers"));
        assert!(has_blocker(&comparison, "candidate_loop_error_blocker"));
        assert!(has_blocker(&comparison, "candidate_soak_failed"));
        paths.cleanup();
    }

    #[test]
    fn deterministic_output() {
        let paths = FixturePaths::new("deterministic");
        write_report(&paths.baseline, &report(dec!(0.1), 1, 1, dec!(0)));
        write_report(&paths.candidate, &report(dec!(0.2), 2, 2, dec!(-0.1)));

        let first = compare_report_files(&paths.baseline, &paths.candidate);
        let second = compare_report_files(&paths.baseline, &paths.candidate);

        assert_eq!(first, second);
        paths.cleanup();
    }

    fn metric_delta(report: &PaperSoakComparisonReport, metric: &str) -> Option<Decimal> {
        report
            .metric_deltas
            .iter()
            .find(|delta| delta.metric == metric)
            .and_then(|delta| delta.delta)
    }

    fn has_blocker(report: &PaperSoakComparisonReport, code: &str) -> bool {
        report.blockers.iter().any(|blocker| blocker.code == code)
    }

    fn has_warning(report: &PaperSoakComparisonReport, code: &str) -> bool {
        report.warnings.iter().any(|warning| warning.code == code)
    }

    fn report(
        pressure: Decimal,
        candidates: u64,
        trades: u64,
        equity_drift: Decimal,
    ) -> PaperSoakReport {
        PaperSoakReport {
            ticks_requested: 10,
            ticks_processed: 10,
            state_valid: true,
            paper_log_valid: true,
            duplicate_positions_count: 0,
            candidate_decisions_evaluated: 10,
            candidate_generated_count: candidates,
            min_ticks_for_candidate_pressure_blocker: 20,
            paper_trades_count: trades,
            open_positions_count: trades.min(1),
            realized_pnl_usdt: dec!(0),
            unrealized_pnl_usdt: dec!(0),
            errors_count: 0,
            error_rate: dec!(0),
            max_consecutive_errors: 0,
            transient_error_count: 0,
            fatal_error_count: 0,
            error_breakdown_by_reason: BTreeMap::new(),
            ticks_failed: 0,
            endpoint_error_breakdown: BTreeMap::new(),
            error_windows: Vec::new(),
            fresh_ticks: 10,
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
            signal_grade_distribution: BTreeMap::from([
                ("a_plus".to_string(), candidates),
                ("c".to_string(), 10_u64.saturating_sub(candidates)),
            ]),
            signal_direction_distribution: BTreeMap::from([
                ("long".to_string(), candidates),
                ("neutral".to_string(), 10_u64.saturating_sub(candidates)),
            ]),
            rejection_breakdown_by_reason: BTreeMap::from([(
                "order.signal_grade_too_low".to_string(),
                10_u64.saturating_sub(candidates),
            )]),
            yi_hexagram_distribution: BTreeMap::new(),
            yi_action_bias_distribution: BTreeMap::new(),
            yi_reason_breakdown: BTreeMap::new(),
            god_turnpoint_evaluated_count: 0,
            god_turnpoint_allowed_count: 0,
            god_turnpoint_blocker_breakdown: BTreeMap::new(),
            god_turnpoint_warning_breakdown: BTreeMap::new(),
            god_signal_pressure_ratio: dec!(0),
            degraded_yi_evaluation_count: 0,
            candidate_pressure_ratio: pressure,
            avg_signal_strength: dec!(65),
            max_signal_strength: dec!(90),
            avg_edge_after_cost_ratio: Some(dec!(3.5)),
            state_mutation_count: trades,
            paper_equity_start: dec!(200),
            paper_equity_end: dec!(200) + equity_drift,
            paper_equity_drift: equity_drift,
            duration_seconds: 600,
            ticks_per_minute: dec!(1),
            warnings: if trades == 0 {
                vec![PaperSoakWarning {
                    code: "zero_paper_trades".to_string(),
                    message: "paper soak completed with zero paper trades".to_string(),
                }]
            } else {
                Vec::new()
            },
            blockers: Vec::new(),
            soak_passed: true,
        }
    }

    fn low_rate_transient_warning_report() -> PaperSoakReport {
        let mut report = report(dec!(0), 0, 0, dec!(0));
        report.ticks_requested = 5_760;
        report.ticks_processed = 5_757;
        report.candidate_decisions_evaluated = 5_757;
        report.errors_count = 3;
        report.error_rate = dec!(0.0005208333333333333333333333);
        report.max_consecutive_errors = 1;
        report.transient_error_count = 3;
        report.ticks_failed = 3;
        report.error_breakdown_by_reason = BTreeMap::from([(
            PaperSoakErrorReason::TransientMarketDataError
                .as_key()
                .to_string(),
            3,
        )]);
        report.warnings.push(PaperSoakWarning {
            code: "transient_loop_errors".to_string(),
            message: "3 low-rate transient loop errors were tolerated".to_string(),
        });
        report
    }

    fn write_report(path: &Path, report: &PaperSoakReport) {
        let raw = serde_json::to_string_pretty(report).unwrap();
        fs::write(path, raw).unwrap();
    }

    struct FixturePaths {
        dir: PathBuf,
        baseline: PathBuf,
        candidate: PathBuf,
    }

    impl FixturePaths {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "rustquanteth-report-compare-{name}-{}",
                std::process::id()
            ));
            fs::create_dir_all(&dir).unwrap();
            Self {
                baseline: dir.join("baseline.json"),
                candidate: dir.join("candidate.json"),
                dir,
            }
        }

        fn cleanup(&self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }
}
