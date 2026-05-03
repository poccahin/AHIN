use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

use domain::{
    PaperSoakComparisonBlocker, PaperSoakComparisonReport, PaperSoakComparisonWarning,
    PaperSoakMetricDelta, PaperSoakReport,
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
        Ok(report) => Some(report),
        Err(err) => {
            blockers.push(blocker(
                format!("{label}_report_parse_failed"),
                format!("{label} report JSON parse failed: {err}"),
            ));
            None
        }
    }
}

fn add_blockers(
    candidate: &PaperSoakReport,
    baseline: &PaperSoakReport,
    blockers: &mut Vec<PaperSoakComparisonBlocker>,
) {
    if !candidate.blockers.is_empty() {
        blockers.push(blocker(
            "candidate_report_blockers",
            format!(
                "candidate report contains {} soak blockers",
                candidate.blockers.len()
            ),
        ));
    }
    if !candidate.soak_passed {
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

    use domain::{PaperSoakBlocker, PaperSoakWarning};
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
