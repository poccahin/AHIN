use std::{collections::BTreeMap, fs, path::Path};

use domain::{
    AppError, AppResult, DecisionReason, DryRunOrderCandidate, OrderCandidateDecision,
    OrderCandidateReason, PaperEngineState, PaperSoakBlocker, PaperSoakConfig,
    PaperSoakEndpointErrorReason, PaperSoakErrorReason, PaperSoakErrorWindow, PaperSoakReport,
    PaperSoakWarning, PaperTrade, RiskBudgetDecision, RiskDecisionReason, SignalDecision,
    SignalDirection, SignalGrade,
};
use rust_decimal::Decimal;

use crate::paper_state;

pub const MIN_TICKS_FOR_CANDIDATE_PRESSURE_BLOCKER: u64 = 20;
pub const MIN_TICKS_FOR_CANDIDATE_PRESSURE_WARNING: u64 = 100;
pub const FUNDING_RATE_STALE_MAX_AGE_SECONDS: u64 = 15 * 60;
pub const OPEN_INTEREST_STALE_MAX_AGE_SECONDS: u64 = 5 * 60;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct PaperSoakRunMetrics {
    pub decisions: Vec<PaperSoakDecisionRecord>,
    pub loop_errors: Vec<PaperSoakErrorRecord>,
    pub endpoint_errors: Vec<PaperSoakEndpointErrorRecord>,
    pub paper_equity_start: Decimal,
    pub paper_equity_end: Decimal,
    pub duration_seconds: u64,
    pub state_mutation_count: u64,
    pub state_mutation_without_candidate_or_fill_count: u64,
    pub state_mutation_on_failed_tick_count: u64,
    pub max_consecutive_errors: u64,
    pub current_consecutive_errors: u64,
    pub fresh_ticks: u64,
    pub stale_ticks: u64,
    pub stale_fallback_count: u64,
    pub max_stale_age_seconds: u64,
}

impl PaperSoakRunMetrics {
    pub fn record_successful_tick(&mut self) {
        self.current_consecutive_errors = 0;
    }

    pub fn record_fresh_market_data_tick(&mut self) {
        self.fresh_ticks += 1;
        self.record_successful_tick();
    }

    pub fn record_stale_market_data_tick(&mut self, fallback_count: u64, max_age_seconds: u64) {
        self.stale_ticks += 1;
        self.stale_fallback_count += fallback_count;
        self.max_stale_age_seconds = self.max_stale_age_seconds.max(max_age_seconds);
        self.record_successful_tick();
    }

    pub fn record_loop_error(&mut self, input: PaperSoakLoopErrorInput) {
        if input.state_mutated {
            self.state_mutation_on_failed_tick_count += 1;
        }
        self.current_consecutive_errors += 1;
        self.max_consecutive_errors = self
            .max_consecutive_errors
            .max(self.current_consecutive_errors);
        self.loop_errors.push(PaperSoakErrorRecord {
            reason: input.reason,
            message: input.message,
            state_mutated: input.state_mutated,
        });
    }

    pub fn record_endpoint_error(&mut self, input: PaperSoakEndpointErrorInput) {
        self.endpoint_errors.push(PaperSoakEndpointErrorRecord {
            tick_index: input.tick_index,
            reason: input.reason,
            critical: input.critical,
            stale_fallback_used: input.stale_fallback_used,
        });
    }

    pub fn record_decision(&mut self, input: PaperSoakDecisionInput<'_>) {
        if input.state_mutated {
            self.state_mutation_count += 1;
        }
        if input.state_mutated_without_candidate_or_fill {
            self.state_mutation_without_candidate_or_fill_count += 1;
        }
        self.decisions.push(PaperSoakDecisionRecord {
            signal_decision: input.signal_decision.clone(),
            risk_decision: input.risk_decision.clone(),
            candidate_decision: input.candidate_decision.clone(),
            edge_after_cost_ratio: input.edge_after_cost_ratio,
            paper_fill_generated: input.paper_fill_generated,
            state_mutated: input.state_mutated,
            state_mutated_without_candidate_or_fill: input.state_mutated_without_candidate_or_fill,
        });
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaperSoakErrorRecord {
    pub reason: PaperSoakErrorReason,
    pub message: String,
    pub state_mutated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaperSoakLoopErrorInput {
    pub reason: PaperSoakErrorReason,
    pub message: String,
    pub state_mutated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PaperSoakEndpointErrorRecord {
    pub tick_index: u64,
    pub reason: PaperSoakEndpointErrorReason,
    pub critical: bool,
    pub stale_fallback_used: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PaperSoakEndpointErrorInput {
    pub tick_index: u64,
    pub reason: PaperSoakEndpointErrorReason,
    pub critical: bool,
    pub stale_fallback_used: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct PaperSoakDecisionInput<'a> {
    pub signal_decision: &'a SignalDecision,
    pub risk_decision: &'a RiskBudgetDecision,
    pub candidate_decision: &'a OrderCandidateDecision,
    pub edge_after_cost_ratio: Option<Decimal>,
    pub paper_fill_generated: bool,
    pub state_mutated: bool,
    pub state_mutated_without_candidate_or_fill: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PaperSoakDecisionRecord {
    pub signal_decision: SignalDecision,
    pub risk_decision: RiskBudgetDecision,
    pub candidate_decision: OrderCandidateDecision,
    pub edge_after_cost_ratio: Option<Decimal>,
    pub paper_fill_generated: bool,
    pub state_mutated: bool,
    pub state_mutated_without_candidate_or_fill: bool,
}

pub fn is_audit_only_candidate_generated(decision: &OrderCandidateDecision) -> bool {
    decision.candidate_generated
        && decision
            .candidate
            .as_ref()
            .is_some_and(DryRunOrderCandidate::invariant_safe)
}

pub fn build_soak_report(
    config: &PaperSoakConfig,
    ticks_processed: u64,
    candidate_generated_count: u64,
    errors_count: u64,
) -> PaperSoakReport {
    build_soak_report_with_metrics(
        config,
        ticks_processed,
        candidate_generated_count,
        errors_count,
        &PaperSoakRunMetrics::default(),
    )
}

pub fn build_soak_report_with_metrics(
    config: &PaperSoakConfig,
    ticks_processed: u64,
    candidate_generated_count: u64,
    errors_count: u64,
    metrics: &PaperSoakRunMetrics,
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

    let quality = quality_metrics(config, ticks_processed, candidate_generated_count, metrics);
    let loop_errors = loop_error_metrics(config, ticks_processed, errors_count, metrics);
    let data_reliability = data_reliability_metrics(ticks_processed, &loop_errors, metrics);
    add_quality_findings(&quality, metrics, &mut warnings, &mut blockers);
    add_loop_error_findings(&loop_errors, metrics, &mut warnings, &mut blockers);
    add_data_reliability_findings(&data_reliability, &mut warnings, &mut blockers);

    let soak_passed = blockers.is_empty();

    PaperSoakReport {
        ticks_requested: config.ticks,
        ticks_processed,
        state_valid,
        paper_log_valid,
        duplicate_positions_count,
        candidate_decisions_evaluated: quality.candidate_decisions_evaluated,
        candidate_generated_count: quality.candidate_generated_count,
        min_ticks_for_candidate_pressure_blocker: MIN_TICKS_FOR_CANDIDATE_PRESSURE_BLOCKER,
        paper_trades_count,
        open_positions_count,
        realized_pnl_usdt,
        unrealized_pnl_usdt,
        errors_count: loop_errors.ticks_failed,
        error_rate: loop_errors.error_rate,
        max_consecutive_errors: loop_errors.max_consecutive_errors,
        transient_error_count: loop_errors.transient_error_count,
        fatal_error_count: loop_errors.fatal_error_count,
        error_breakdown_by_reason: loop_errors.error_breakdown_by_reason,
        ticks_failed: loop_errors.ticks_failed,
        endpoint_error_breakdown: data_reliability.endpoint_error_breakdown,
        error_windows: data_reliability.error_windows,
        fresh_ticks: data_reliability.fresh_ticks,
        stale_ticks: data_reliability.stale_ticks,
        failed_ticks: data_reliability.failed_ticks,
        stale_fallback_count: data_reliability.stale_fallback_count,
        max_stale_age_seconds: data_reliability.max_stale_age_seconds,
        data_freshness_score: data_reliability.data_freshness_score,
        signal_grade_distribution: quality.signal_grade_distribution,
        signal_direction_distribution: quality.signal_direction_distribution,
        rejection_breakdown_by_reason: quality.rejection_breakdown_by_reason,
        candidate_pressure_ratio: quality.candidate_pressure_ratio,
        avg_signal_strength: quality.avg_signal_strength,
        max_signal_strength: quality.max_signal_strength,
        avg_edge_after_cost_ratio: quality.avg_edge_after_cost_ratio,
        state_mutation_count: metrics.state_mutation_count,
        paper_equity_start: metrics.paper_equity_start,
        paper_equity_end: metrics.paper_equity_end,
        paper_equity_drift: metrics.paper_equity_end - metrics.paper_equity_start,
        duration_seconds: metrics.duration_seconds,
        ticks_per_minute: ticks_per_minute(ticks_processed, metrics.duration_seconds),
        warnings,
        blockers,
        soak_passed,
    }
}

pub fn persist_report_if_configured(
    config: &PaperSoakConfig,
    mut report: PaperSoakReport,
) -> PaperSoakReport {
    if let Some(report_path) = config.report_path.as_deref()
        && let Err(blocker) = persist_report(Path::new(report_path), &report)
    {
        report.blockers.push(blocker);
        report.soak_passed = false;
    }
    report
}

fn persist_report(path: &Path, report: &PaperSoakReport) -> Result<(), PaperSoakBlocker> {
    paper_state::ensure_local_file_path(path).map_err(|err| {
        blocker(
            "soak_report_path_unreadable",
            format!("soak report path is invalid: {err}"),
        )
    })?;
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|err| {
            blocker(
                "soak_report_path_unreadable",
                format!(
                    "soak report parent directory is not writable: {} ({err})",
                    parent.display()
                ),
            )
        })?;
    }
    let raw = serde_json::to_string_pretty(report).map_err(|err| {
        blocker(
            "soak_report_render_failed",
            format!("soak report JSON render failed: {err}"),
        )
    })?;
    fs::write(path, raw).map_err(|err| {
        blocker(
            "soak_report_path_unreadable",
            format!(
                "soak report path is not writable: {} ({err})",
                path.display()
            ),
        )
    })
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

fn add_quality_findings(
    quality: &ComputedQualityMetrics,
    metrics: &PaperSoakRunMetrics,
    warnings: &mut Vec<PaperSoakWarning>,
    blockers: &mut Vec<PaperSoakBlocker>,
) {
    if quality.ticks_processed == 0 {
        warnings.push(warning(
            "zero_ticks_processed",
            "paper soak processed zero ticks",
        ));
        return;
    }
    if quality.candidate_generated_count > quality.ticks_processed {
        blockers.push(blocker(
            "candidate_count_exceeds_ticks",
            "candidate_generated_count cannot exceed ticks_processed",
        ));
        return;
    }

    if quality.candidate_pressure_ratio > quality.candidate_blocker_ratio {
        if quality.ticks_processed >= MIN_TICKS_FOR_CANDIDATE_PRESSURE_BLOCKER {
            blockers.push(blocker(
                "candidate_pressure_excessive",
                "candidate pressure ratio exceeded blocker threshold",
            ));
        } else {
            warnings.push(warning(
                "candidate_pressure_excessive_short_sample",
                "candidate pressure ratio exceeded blocker threshold, but sample is too short to block",
            ));
        }
    } else if quality.ticks_processed >= MIN_TICKS_FOR_CANDIDATE_PRESSURE_WARNING
        && quality.candidate_pressure_ratio > quality.candidate_warning_ratio
    {
        warnings.push(warning(
            "candidate_pressure_high",
            "candidate pressure ratio exceeded warning threshold",
        ));
    }

    let a_plus_without_fills = metrics
        .decisions
        .iter()
        .filter(|record| {
            record.signal_decision.packet.grade == SignalGrade::APlus
                && !record.paper_fill_generated
        })
        .count();
    if a_plus_without_fills >= 2 {
        warnings.push(warning(
            "repeated_a_plus_without_paper_fills",
            "repeated A+ signals occurred without simulated paper fills",
        ));
    }

    if metrics.state_mutation_without_candidate_or_fill_count > 0 {
        blockers.push(blocker(
            "state_mutation_without_candidate_or_fill",
            format!(
                "{} ticks mutated structural paper state without a candidate or fill",
                metrics.state_mutation_without_candidate_or_fill_count
            ),
        ));
    }

    let invalid_fills_without_candidate = metrics
        .decisions
        .iter()
        .filter(|record| {
            record.paper_fill_generated
                && !is_audit_only_candidate_generated(&record.candidate_decision)
        })
        .count();
    if invalid_fills_without_candidate > 0 {
        blockers.push(blocker(
            "invalid_paper_fill_without_candidate",
            format!(
                "{invalid_fills_without_candidate} paper fills occurred without a valid generated audit-only candidate"
            ),
        ));
    }
}

fn add_loop_error_findings(
    loop_errors: &ComputedLoopErrorMetrics,
    metrics: &PaperSoakRunMetrics,
    warnings: &mut Vec<PaperSoakWarning>,
    blockers: &mut Vec<PaperSoakBlocker>,
) {
    if loop_errors.ticks_failed == 0 {
        return;
    }

    if loop_errors.fatal_error_count > 0 {
        blockers.push(blocker(
            "fatal_loop_error",
            format!(
                "paper soak observed {} fatal loop errors",
                loop_errors.fatal_error_count
            ),
        ));
    }
    if loop_errors
        .error_breakdown_by_reason
        .contains_key(PaperSoakErrorReason::ForbiddenCapabilityError.as_key())
    {
        blockers.push(blocker(
            "forbidden_capability_error",
            "paper soak observed a forbidden capability error",
        ));
    }
    if metrics.state_mutation_on_failed_tick_count > 0 {
        blockers.push(blocker(
            "state_mutation_on_failed_tick",
            format!(
                "{} failed ticks mutated structural paper state",
                metrics.state_mutation_on_failed_tick_count
            ),
        ));
    }
    if loop_errors.error_rate > excessive_error_rate_threshold() {
        blockers.push(blocker(
            "loop_error_rate_excessive",
            "paper soak loop error rate exceeded tolerance",
        ));
    }
    if loop_errors.max_consecutive_errors >= 3 {
        blockers.push(blocker(
            "consecutive_loop_errors",
            "paper soak observed three or more consecutive loop errors",
        ));
    }

    let has_loop_blocker = blockers.iter().any(|blocker| {
        matches!(
            blocker.code.as_str(),
            "fatal_loop_error"
                | "forbidden_capability_error"
                | "state_mutation_on_failed_tick"
                | "loop_error_rate_excessive"
                | "consecutive_loop_errors"
        )
    });
    if !has_loop_blocker
        && loop_errors.error_rate <= low_rate_transient_error_threshold()
        && loop_errors.max_consecutive_errors <= 2
        && loop_errors.fatal_error_count == 0
    {
        warnings.push(warning(
            "transient_loop_errors",
            format!(
                "{} low-rate transient loop errors were tolerated",
                loop_errors.ticks_failed
            ),
        ));
    }
}

fn add_data_reliability_findings(
    data_reliability: &ComputedDataReliabilityMetrics,
    warnings: &mut Vec<PaperSoakWarning>,
    blockers: &mut Vec<PaperSoakBlocker>,
) {
    if data_reliability.stale_fallback_count == 0 {
        return;
    }

    if data_reliability.stale_fallback_ratio > Decimal::new(15, 2) {
        blockers.push(blocker(
            "stale_fallback_ratio_excessive",
            "stale market-data fallback ratio exceeded blocker threshold",
        ));
    } else if data_reliability.stale_fallback_ratio > Decimal::new(5, 2) {
        warnings.push(warning(
            "stale_fallback_ratio_high",
            "stale market-data fallback ratio exceeded warning threshold",
        ));
    } else {
        warnings.push(warning(
            "stale_market_data_fallback_used",
            format!(
                "{} non-critical market-data stale fallbacks were used",
                data_reliability.stale_fallback_count
            ),
        ));
    }
}

fn quality_metrics(
    config: &PaperSoakConfig,
    ticks_processed: u64,
    candidate_generated_count: u64,
    metrics: &PaperSoakRunMetrics,
) -> ComputedQualityMetrics {
    let mut signal_grade_distribution = BTreeMap::new();
    let mut signal_direction_distribution = BTreeMap::new();
    let mut rejection_breakdown_by_reason = BTreeMap::new();
    let mut total_signal_strength = Decimal::ZERO;
    let mut max_signal_strength = Decimal::ZERO;
    let mut total_edge_after_cost_ratio = Decimal::ZERO;
    let mut edge_after_cost_ratio_count = 0_u64;
    let candidate_decisions_evaluated = metrics.decisions.len() as u64;
    let safe_candidate_generated_count = if metrics.decisions.is_empty() {
        candidate_generated_count
    } else {
        metrics
            .decisions
            .iter()
            .filter(|record| is_audit_only_candidate_generated(&record.candidate_decision))
            .count() as u64
    };

    for record in &metrics.decisions {
        increment(
            &mut signal_grade_distribution,
            signal_grade_key(record.signal_decision.packet.grade),
        );
        increment(
            &mut signal_direction_distribution,
            signal_direction_key(record.signal_decision.packet.direction),
        );
        total_signal_strength += record.signal_decision.packet.final_strength;
        max_signal_strength = max_signal_strength.max(record.signal_decision.packet.final_strength);
        if let Some(edge_after_cost_ratio) = record.edge_after_cost_ratio {
            total_edge_after_cost_ratio += edge_after_cost_ratio;
            edge_after_cost_ratio_count += 1;
        }

        if !record.candidate_decision.candidate_generated {
            for reason in &record.signal_decision.reasons {
                increment(
                    &mut rejection_breakdown_by_reason,
                    signal_reason_key(*reason),
                );
            }
            for reason in &record.risk_decision.reasons {
                increment(&mut rejection_breakdown_by_reason, risk_reason_key(*reason));
            }
            for reason in &record.candidate_decision.reasons {
                increment(
                    &mut rejection_breakdown_by_reason,
                    order_candidate_reason_key(*reason),
                );
            }
        }
    }

    let decisions_count = Decimal::from(metrics.decisions.len() as u64);
    let candidate_pressure_ratio = if ticks_processed == 0 {
        Decimal::ZERO
    } else {
        Decimal::from(safe_candidate_generated_count) / Decimal::from(ticks_processed)
    };
    let avg_signal_strength = if metrics.decisions.is_empty() {
        Decimal::ZERO
    } else {
        total_signal_strength / decisions_count
    };
    let avg_edge_after_cost_ratio = if edge_after_cost_ratio_count == 0 {
        None
    } else {
        Some(total_edge_after_cost_ratio / Decimal::from(edge_after_cost_ratio_count))
    };

    ComputedQualityMetrics {
        ticks_processed,
        candidate_decisions_evaluated,
        candidate_generated_count: safe_candidate_generated_count,
        candidate_warning_ratio: config.candidate_warning_ratio,
        candidate_blocker_ratio: config.candidate_blocker_ratio,
        signal_grade_distribution,
        signal_direction_distribution,
        rejection_breakdown_by_reason,
        candidate_pressure_ratio,
        avg_signal_strength,
        max_signal_strength,
        avg_edge_after_cost_ratio,
    }
}

fn loop_error_metrics(
    config: &PaperSoakConfig,
    ticks_processed: u64,
    errors_count: u64,
    metrics: &PaperSoakRunMetrics,
) -> ComputedLoopErrorMetrics {
    let mut error_breakdown_by_reason = BTreeMap::new();
    let mut fatal_error_count = 0_u64;

    if metrics.loop_errors.is_empty() {
        if errors_count > 0 {
            error_breakdown_by_reason.insert(
                PaperSoakErrorReason::TransientMarketDataError
                    .as_key()
                    .to_string(),
                errors_count,
            );
        }
    } else {
        for error in &metrics.loop_errors {
            increment(&mut error_breakdown_by_reason, error.reason.as_key());
            if error.reason.is_fatal() {
                fatal_error_count += 1;
            }
        }
    }

    let ticks_failed = if metrics.loop_errors.is_empty() {
        errors_count
    } else {
        metrics.loop_errors.len() as u64
    };
    let denominator = config
        .ticks
        .max(ticks_processed.saturating_add(ticks_failed))
        .max(1);
    let error_rate = Decimal::from(ticks_failed) / Decimal::from(denominator);
    let max_consecutive_errors = if metrics.loop_errors.is_empty() {
        errors_count
    } else {
        metrics.max_consecutive_errors
    };
    let transient_error_count = ticks_failed.saturating_sub(fatal_error_count);

    ComputedLoopErrorMetrics {
        ticks_failed,
        error_rate,
        max_consecutive_errors,
        transient_error_count,
        fatal_error_count,
        error_breakdown_by_reason,
    }
}

fn data_reliability_metrics(
    ticks_processed: u64,
    loop_errors: &ComputedLoopErrorMetrics,
    metrics: &PaperSoakRunMetrics,
) -> ComputedDataReliabilityMetrics {
    let mut endpoint_error_breakdown = BTreeMap::new();
    for error in &metrics.endpoint_errors {
        increment(&mut endpoint_error_breakdown, error.reason.as_key());
    }

    let fresh_ticks = if metrics.fresh_ticks == 0 && metrics.stale_ticks == 0 {
        ticks_processed
    } else {
        metrics.fresh_ticks
    };
    let stale_ticks = metrics.stale_ticks;
    let failed_ticks = loop_errors.ticks_failed;
    let stale_fallback_count = metrics.stale_fallback_count;
    let denominator = fresh_ticks
        .saturating_add(stale_ticks)
        .saturating_add(failed_ticks);
    let data_freshness_score = if denominator == 0 {
        Decimal::ZERO
    } else {
        let fresh_weight = Decimal::from(fresh_ticks);
        let stale_weight = Decimal::from(stale_ticks) * Decimal::new(75, 2);
        (fresh_weight + stale_weight) / Decimal::from(denominator)
    };
    let stale_fallback_ratio = if denominator == 0 {
        Decimal::ZERO
    } else {
        Decimal::from(stale_fallback_count) / Decimal::from(denominator)
    };

    ComputedDataReliabilityMetrics {
        endpoint_error_breakdown,
        error_windows: error_windows(&metrics.endpoint_errors),
        fresh_ticks,
        stale_ticks,
        failed_ticks,
        stale_fallback_count,
        max_stale_age_seconds: metrics.max_stale_age_seconds,
        data_freshness_score,
        stale_fallback_ratio,
    }
}

fn error_windows(errors: &[PaperSoakEndpointErrorRecord]) -> Vec<PaperSoakErrorWindow> {
    let mut sorted = errors.to_vec();
    sorted.sort_by_key(|error| (error.reason.as_key(), error.critical, error.tick_index));
    let mut windows: Vec<PaperSoakErrorWindow> = Vec::new();

    for error in sorted {
        let reason = error.reason.as_key().to_string();
        if let Some(window) = windows.last_mut()
            && window.reason == reason
            && window.critical == error.critical
            && window.end_tick.saturating_add(1) == error.tick_index
        {
            window.end_tick = error.tick_index;
            window.length += 1;
            continue;
        }
        windows.push(PaperSoakErrorWindow {
            reason,
            start_tick: error.tick_index,
            end_tick: error.tick_index,
            length: 1,
            critical: error.critical,
        });
    }

    windows
}

pub fn endpoint_allows_stale_fallback(
    reason: PaperSoakEndpointErrorReason,
    age_seconds: u64,
) -> bool {
    match reason {
        PaperSoakEndpointErrorReason::FundingRateError => {
            age_seconds <= FUNDING_RATE_STALE_MAX_AGE_SECONDS
        }
        PaperSoakEndpointErrorReason::OpenInterestError => {
            age_seconds <= OPEN_INTEREST_STALE_MAX_AGE_SECONDS
        }
        PaperSoakEndpointErrorReason::MarkPriceError
        | PaperSoakEndpointErrorReason::OrderbookDepthError
        | PaperSoakEndpointErrorReason::FeatureSnapshotError
        | PaperSoakEndpointErrorReason::HttpTimeout
        | PaperSoakEndpointErrorReason::HttpRateLimit
        | PaperSoakEndpointErrorReason::HttpStatusError
        | PaperSoakEndpointErrorReason::ParseError => false,
    }
}

pub fn endpoint_error_is_critical(reason: PaperSoakEndpointErrorReason) -> bool {
    matches!(
        reason,
        PaperSoakEndpointErrorReason::MarkPriceError
            | PaperSoakEndpointErrorReason::OrderbookDepthError
            | PaperSoakEndpointErrorReason::FeatureSnapshotError
    )
}

#[derive(Debug, Clone, PartialEq)]
struct ComputedQualityMetrics {
    ticks_processed: u64,
    candidate_decisions_evaluated: u64,
    candidate_generated_count: u64,
    candidate_warning_ratio: Decimal,
    candidate_blocker_ratio: Decimal,
    signal_grade_distribution: BTreeMap<String, u64>,
    signal_direction_distribution: BTreeMap<String, u64>,
    rejection_breakdown_by_reason: BTreeMap<String, u64>,
    candidate_pressure_ratio: Decimal,
    avg_signal_strength: Decimal,
    max_signal_strength: Decimal,
    avg_edge_after_cost_ratio: Option<Decimal>,
}

#[derive(Debug, Clone, PartialEq)]
struct ComputedLoopErrorMetrics {
    ticks_failed: u64,
    error_rate: Decimal,
    max_consecutive_errors: u64,
    transient_error_count: u64,
    fatal_error_count: u64,
    error_breakdown_by_reason: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, PartialEq)]
struct ComputedDataReliabilityMetrics {
    endpoint_error_breakdown: BTreeMap<String, u64>,
    error_windows: Vec<PaperSoakErrorWindow>,
    fresh_ticks: u64,
    stale_ticks: u64,
    failed_ticks: u64,
    stale_fallback_count: u64,
    max_stale_age_seconds: u64,
    data_freshness_score: Decimal,
    stale_fallback_ratio: Decimal,
}

pub fn classify_loop_error(err: &AppError) -> PaperSoakErrorReason {
    match err {
        AppError::HttpRequest { reason, .. } => {
            if reason.to_ascii_lowercase().contains("timeout")
                || reason.to_ascii_lowercase().contains("timed out")
            {
                PaperSoakErrorReason::TimeoutError
            } else {
                PaperSoakErrorReason::TransientMarketDataError
            }
        }
        AppError::HttpStatus { status, .. } => match *status {
            408 => PaperSoakErrorReason::TimeoutError,
            418 | 429 => PaperSoakErrorReason::RateLimitError,
            _ => PaperSoakErrorReason::TransientMarketDataError,
        },
        AppError::ResponseParse { .. } => PaperSoakErrorReason::ParseError,
        AppError::ExecutionRejected(_) | AppError::RiskRejected(_) | AppError::CostRejected(_) => {
            PaperSoakErrorReason::InvariantViolation
        }
        AppError::UnsafeConfig(_) | AppError::LeverageTooHigh { .. } => {
            PaperSoakErrorReason::ForbiddenCapabilityError
        }
        AppError::Config(message) => classify_config_error(message),
        AppError::Exchange(_) | AppError::Reconciliation(_) => {
            PaperSoakErrorReason::TransientMarketDataError
        }
        AppError::InvalidSymbol(_) | AppError::NonPositive { .. } => {
            PaperSoakErrorReason::InvariantViolation
        }
    }
}

fn classify_config_error(message: &str) -> PaperSoakErrorReason {
    let lowered = message.to_ascii_lowercase();
    if lowered.contains("forbidden")
        || lowered.contains("api key")
        || lowered.contains("secret")
        || lowered.contains("signed")
        || lowered.contains("withdraw")
        || lowered.contains("live order")
    {
        PaperSoakErrorReason::ForbiddenCapabilityError
    } else if lowered.contains("write")
        || lowered.contains("persist")
        || lowered.contains("append")
        || lowered.contains("paper state")
        || lowered.contains("paper log")
    {
        PaperSoakErrorReason::StatePersistenceError
    } else if lowered.contains("parse") {
        PaperSoakErrorReason::ParseError
    } else {
        PaperSoakErrorReason::TransientMarketDataError
    }
}

fn low_rate_transient_error_threshold() -> Decimal {
    Decimal::new(1, 3)
}

fn excessive_error_rate_threshold() -> Decimal {
    Decimal::new(5, 3)
}

fn ticks_per_minute(ticks_processed: u64, duration_seconds: u64) -> Decimal {
    if duration_seconds == 0 {
        return Decimal::ZERO;
    }
    (Decimal::from(ticks_processed) * Decimal::from(60)) / Decimal::from(duration_seconds)
}

fn increment(map: &mut BTreeMap<String, u64>, key: &'static str) {
    *map.entry(key.to_string()).or_insert(0) += 1;
}

fn signal_grade_key(grade: SignalGrade) -> &'static str {
    match grade {
        SignalGrade::APlus => "a_plus",
        SignalGrade::A => "a",
        SignalGrade::B => "b",
        SignalGrade::C => "c",
        SignalGrade::D => "d",
        SignalGrade::F => "f",
    }
}

fn signal_direction_key(direction: SignalDirection) -> &'static str {
    match direction {
        SignalDirection::Long => "long",
        SignalDirection::Short => "short",
        SignalDirection::Neutral => "neutral",
    }
}

fn signal_reason_key(reason: DecisionReason) -> &'static str {
    match reason {
        DecisionReason::ResearchOnlyMode => "signal.research_only_mode",
        DecisionReason::HighCost => "signal.high_cost",
        DecisionReason::LowLiquidity => "signal.low_liquidity",
        DecisionReason::NeutralSignal => "signal.neutral_signal",
        DecisionReason::InsufficientStrength => "signal.insufficient_strength",
        DecisionReason::CrowdedLong => "signal.crowded_long",
        DecisionReason::CrowdedShort => "signal.crowded_short",
    }
}

fn risk_reason_key(reason: RiskDecisionReason) -> &'static str {
    match reason {
        RiskDecisionReason::ResearchOnlyMode => "risk.research_only_mode",
        RiskDecisionReason::SignalNotAllowed => "risk.signal_not_allowed",
        RiskDecisionReason::WeakSignal => "risk.weak_signal",
        RiskDecisionReason::DailySoftStop => "risk.daily_soft_stop",
        RiskDecisionReason::DailyHardStop => "risk.daily_hard_stop",
        RiskDecisionReason::WeeklyStop => "risk.weekly_stop",
        RiskDecisionReason::TrendDisabledBelowEquity => "risk.trend_disabled_below_equity",
        RiskDecisionReason::PaperModeBelowEquity => "risk.paper_mode_below_equity",
        RiskDecisionReason::GrossNotionalCapExceeded => "risk.gross_notional_cap_exceeded",
        RiskDecisionReason::LiquidationBufferTooSmall => "risk.liquidation_buffer_too_small",
        RiskDecisionReason::RiskChecksPassed => "risk.risk_checks_passed",
        RiskDecisionReason::MaxLossPerSignalCapped => "risk.max_loss_per_signal_capped",
        RiskDecisionReason::NoExecutableOrderGenerated => "risk.no_executable_order_generated",
    }
}

fn order_candidate_reason_key(reason: OrderCandidateReason) -> &'static str {
    match reason {
        OrderCandidateReason::DryRunOnly => "order.dry_run_only",
        OrderCandidateReason::NoExecutableOrderGenerated => "order.no_executable_order_generated",
        OrderCandidateReason::SignalRejected => "order.signal_rejected",
        OrderCandidateReason::RiskRejected => "order.risk_rejected",
        OrderCandidateReason::ResearchOnlyMode => "order.research_only_mode",
        OrderCandidateReason::SignalGradeTooLow => "order.signal_grade_too_low",
        OrderCandidateReason::SignalStrengthTooLow => "order.signal_strength_too_low",
        OrderCandidateReason::EdgeAfterCostTooLow => "order.edge_after_cost_too_low",
        OrderCandidateReason::AuditOnly => "order.audit_only",
        OrderCandidateReason::SizingCappedByInitialNotional => {
            "order.sizing_capped_by_initial_notional"
        }
        OrderCandidateReason::SizingCappedByGrossNotional => {
            "order.sizing_capped_by_gross_notional"
        }
        OrderCandidateReason::SizingCappedByMaxLoss => "order.sizing_capped_by_max_loss",
        OrderCandidateReason::CandidateGenerated => "order.candidate_generated",
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

    use domain::{
        AccountRiskState, CandidateSizingConfig, DecisionReason, DryRunOrderCandidate,
        MarketRegime, OrderCandidateDecision, OrderCandidateReason, PaperEngineState,
        PaperPosition, PaperSoakEndpointErrorReason, PaperSoakErrorReason, PaperTrade, Price,
        RiskBudgetConfig, RiskBudgetDecision, RiskDecisionReason, SignalDecision, SignalDirection,
        SignalGrade, SignalPacket, Symbol,
    };
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
    fn three_ticks_with_full_candidate_pressure_warns_only() {
        let paths = FixturePaths::new("short_candidate_pressure");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let run_metrics = metrics(vec![
            record(
                SignalGrade::APlus,
                SignalDirection::Short,
                dec!(92),
                true,
                true,
            ),
            record(
                SignalGrade::APlus,
                SignalDirection::Short,
                dec!(93),
                true,
                false,
            ),
            record(
                SignalGrade::APlus,
                SignalDirection::Short,
                dec!(94),
                true,
                false,
            ),
        ]);

        let report = build_soak_report_with_metrics(&paths.config(), 3, 0, 0, &run_metrics);

        assert!(report.soak_passed);
        assert_eq!(report.candidate_decisions_evaluated, 3);
        assert_eq!(report.candidate_generated_count, 3);
        assert_eq!(report.candidate_pressure_ratio, dec!(1));
        assert!(has_warning(
            &report,
            "candidate_pressure_excessive_short_sample"
        ));
        paths.cleanup();
    }

    #[test]
    fn twenty_ticks_with_excessive_candidate_pressure_blocks_soak() {
        let paths = FixturePaths::new("twenty_tick_candidate_blocker");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let mut records = Vec::new();
        for _ in 0..11 {
            records.push(record(
                SignalGrade::APlus,
                SignalDirection::Short,
                dec!(92),
                true,
                false,
            ));
        }
        for _ in 0..9 {
            records.push(rejected_record());
        }
        let run_metrics = metrics(records);

        let report = build_soak_report_with_metrics(&paths.config(), 20, 0, 0, &run_metrics);

        assert!(!report.soak_passed);
        assert_eq!(report.candidate_generated_count, 11);
        assert_eq!(report.candidate_pressure_ratio, dec!(0.55));
        assert!(has_blocker(&report, "candidate_pressure_excessive"));
        paths.cleanup();
    }

    #[test]
    fn one_hundred_ticks_with_elevated_candidate_pressure_warns() {
        let paths = FixturePaths::new("hundred_tick_candidate_warning");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let mut records = Vec::new();
        for _ in 0..30 {
            records.push(record(
                SignalGrade::APlus,
                SignalDirection::Short,
                dec!(92),
                true,
                false,
            ));
        }
        for _ in 0..70 {
            records.push(rejected_record());
        }
        let run_metrics = metrics(records);

        let report = build_soak_report_with_metrics(&paths.config(), 100, 0, 0, &run_metrics);

        assert!(report.soak_passed);
        assert_eq!(report.candidate_generated_count, 30);
        assert_eq!(report.candidate_pressure_ratio, dec!(0.3));
        assert!(has_warning(&report, "candidate_pressure_high"));
        paths.cleanup();
    }

    #[test]
    fn evaluated_decisions_without_generated_candidate_do_not_increment_generated_count() {
        let paths = FixturePaths::new("evaluated_without_candidate");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let run_metrics = metrics(vec![
            rejected_record(),
            rejected_record(),
            rejected_record(),
        ]);

        let report = build_soak_report_with_metrics(&paths.config(), 3, 3, 0, &run_metrics);

        assert_eq!(report.candidate_decisions_evaluated, 3);
        assert_eq!(report.candidate_generated_count, 0);
        assert_eq!(report.candidate_pressure_ratio, dec!(0));
        assert!(report.soak_passed);
        paths.cleanup();
    }

    #[test]
    fn candidate_pressure_ratio_is_deterministic() {
        let paths = FixturePaths::new("candidate_ratio_deterministic");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let run_metrics = metrics(vec![
            record(
                SignalGrade::APlus,
                SignalDirection::Short,
                dec!(92),
                true,
                false,
            ),
            rejected_record(),
            record(
                SignalGrade::APlus,
                SignalDirection::Short,
                dec!(93),
                true,
                false,
            ),
            rejected_record(),
        ]);

        let first = build_soak_report_with_metrics(&paths.config(), 4, 0, 0, &run_metrics);
        let second = build_soak_report_with_metrics(&paths.config(), 4, 0, 0, &run_metrics);

        assert_eq!(
            first.candidate_pressure_ratio,
            second.candidate_pressure_ratio
        );
        assert_eq!(first.candidate_pressure_ratio, dec!(0.5));
        paths.cleanup();
    }

    #[test]
    fn three_transient_errors_over_long_soak_warn_only() {
        let paths = FixturePaths::new("low_rate_transient_errors");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let mut config = paths.config();
        config.ticks = 5_760;
        let run_metrics = nonconsecutive_loop_errors(&[
            PaperSoakErrorReason::TransientMarketDataError,
            PaperSoakErrorReason::TimeoutError,
            PaperSoakErrorReason::RateLimitError,
        ]);

        let report = build_soak_report_with_metrics(&config, 5_757, 0, 3, &run_metrics);

        assert!(report.soak_passed);
        assert_eq!(report.ticks_failed, 3);
        assert_eq!(report.errors_count, 3);
        assert!(report.error_rate <= dec!(0.001));
        assert_eq!(report.max_consecutive_errors, 1);
        assert_eq!(report.transient_error_count, 3);
        assert_eq!(report.fatal_error_count, 0);
        assert_eq!(report.error_breakdown_by_reason["timeout_error"], 1);
        assert_eq!(report.error_breakdown_by_reason["rate_limit_error"], 1);
        assert!(has_warning(&report, "transient_loop_errors"));
        assert!(report.blockers.is_empty());
        paths.cleanup();
    }

    #[test]
    fn excessive_loop_error_rate_blocks_soak() {
        let paths = FixturePaths::new("loop_error_rate_excessive");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let mut config = paths.config();
        config.ticks = 100;
        let run_metrics =
            nonconsecutive_loop_errors(&[PaperSoakErrorReason::TransientMarketDataError]);

        let report = build_soak_report_with_metrics(&config, 99, 0, 1, &run_metrics);

        assert!(!report.soak_passed);
        assert!(report.error_rate > dec!(0.005));
        assert!(has_blocker(&report, "loop_error_rate_excessive"));
        paths.cleanup();
    }

    #[test]
    fn three_consecutive_loop_errors_block_soak() {
        let paths = FixturePaths::new("consecutive_loop_errors");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let mut config = paths.config();
        config.ticks = 1_000;
        let run_metrics = consecutive_loop_errors(&[
            PaperSoakErrorReason::TransientMarketDataError,
            PaperSoakErrorReason::TimeoutError,
            PaperSoakErrorReason::RateLimitError,
        ]);

        let report = build_soak_report_with_metrics(&config, 997, 0, 3, &run_metrics);

        assert!(!report.soak_passed);
        assert_eq!(report.max_consecutive_errors, 3);
        assert!(has_blocker(&report, "consecutive_loop_errors"));
        paths.cleanup();
    }

    #[test]
    fn fatal_state_persistence_error_blocks_soak() {
        let paths = FixturePaths::new("fatal_state_persistence_error");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let mut config = paths.config();
        config.ticks = 1_000;
        let run_metrics =
            nonconsecutive_loop_errors(&[PaperSoakErrorReason::StatePersistenceError]);

        let report = build_soak_report_with_metrics(&config, 999, 0, 1, &run_metrics);

        assert!(!report.soak_passed);
        assert_eq!(report.fatal_error_count, 1);
        assert_eq!(report.transient_error_count, 0);
        assert!(has_blocker(&report, "fatal_loop_error"));
        paths.cleanup();
    }

    #[test]
    fn failed_tick_does_not_mutate_state_generate_candidate_or_fill() {
        let paths = FixturePaths::new("failed_tick_no_mutation");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        fs::write(&paths.log, "").unwrap();
        let mut config = paths.config();
        config.ticks = 1_000;
        let run_metrics =
            nonconsecutive_loop_errors(&[PaperSoakErrorReason::TransientMarketDataError]);

        let report = build_soak_report_with_metrics(&config, 0, 0, 1, &run_metrics);

        assert!(report.soak_passed);
        assert_eq!(report.ticks_failed, 1);
        assert_eq!(report.candidate_generated_count, 0);
        assert_eq!(report.candidate_pressure_ratio, dec!(0));
        assert_eq!(report.paper_trades_count, 0);
        assert_eq!(report.open_positions_count, 0);
        assert_eq!(report.state_mutation_count, 0);
        assert!(has_warning(&report, "zero_paper_trades"));
        assert!(has_warning(&report, "transient_loop_errors"));
        paths.cleanup();
    }

    #[test]
    fn state_mutation_on_failed_tick_blocks_soak() {
        let paths = FixturePaths::new("state_mutation_on_failed_tick");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let mut config = paths.config();
        config.ticks = 1_000;
        let mut run_metrics = metrics(Vec::new());
        run_metrics.record_loop_error(PaperSoakLoopErrorInput {
            reason: PaperSoakErrorReason::TransientMarketDataError,
            message: "simulated read-only fetch failed".to_string(),
            state_mutated: true,
        });

        let report = build_soak_report_with_metrics(&config, 999, 0, 1, &run_metrics);

        assert!(!report.soak_passed);
        assert!(has_blocker(&report, "state_mutation_on_failed_tick"));
        paths.cleanup();
    }

    #[test]
    fn error_breakdown_is_deterministic() {
        let paths = FixturePaths::new("error_breakdown_deterministic");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let mut config = paths.config();
        config.ticks = 1_000;
        let run_metrics = nonconsecutive_loop_errors(&[
            PaperSoakErrorReason::TimeoutError,
            PaperSoakErrorReason::RateLimitError,
            PaperSoakErrorReason::TimeoutError,
        ]);

        let first = build_soak_report_with_metrics(&config, 997, 0, 3, &run_metrics);
        let second = build_soak_report_with_metrics(&config, 997, 0, 3, &run_metrics);

        assert_eq!(
            first.error_breakdown_by_reason,
            second.error_breakdown_by_reason
        );
        assert_eq!(first.error_breakdown_by_reason["timeout_error"], 2);
        assert_eq!(first.error_breakdown_by_reason["rate_limit_error"], 1);
        paths.cleanup();
    }

    #[test]
    fn endpoint_error_breakdown_identifies_failing_endpoint() {
        let paths = FixturePaths::new("endpoint_error_breakdown");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        fs::write(&paths.log, "").unwrap();
        let mut run_metrics = metrics(Vec::new());
        run_metrics.record_endpoint_error(PaperSoakEndpointErrorInput {
            tick_index: 7,
            reason: PaperSoakEndpointErrorReason::OpenInterestError,
            critical: false,
            stale_fallback_used: true,
        });
        run_metrics.record_stale_market_data_tick(1, 60);

        let report = build_soak_report_with_metrics(&paths.config(), 1, 0, 0, &run_metrics);

        assert_eq!(report.endpoint_error_breakdown["open_interest_error"], 1);
        assert_eq!(report.error_windows.len(), 1);
        assert_eq!(report.error_windows[0].reason, "open_interest_error");
        assert!(!report.error_windows[0].critical);
        paths.cleanup();
    }

    #[test]
    fn consecutive_open_interest_errors_use_stale_fallback_without_loop_blocker() {
        let paths = FixturePaths::new("open_interest_stale_fallback");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        fs::write(&paths.log, "").unwrap();
        let mut config = paths.config();
        config.ticks = 5_760;
        let mut run_metrics = metrics(Vec::new());
        run_metrics.fresh_ticks = 5_713;
        for tick_index in 0..47 {
            run_metrics.record_endpoint_error(PaperSoakEndpointErrorInput {
                tick_index,
                reason: PaperSoakEndpointErrorReason::OpenInterestError,
                critical: false,
                stale_fallback_used: true,
            });
            run_metrics.record_stale_market_data_tick(1, 60);
        }

        let report = build_soak_report_with_metrics(&config, 5_760, 0, 0, &run_metrics);

        assert!(report.soak_passed);
        assert_eq!(report.fresh_ticks, 5_713);
        assert_eq!(report.stale_ticks, 47);
        assert_eq!(report.failed_ticks, 0);
        assert_eq!(report.ticks_failed, 0);
        assert_eq!(report.stale_fallback_count, 47);
        assert_eq!(report.endpoint_error_breakdown["open_interest_error"], 47);
        assert!(has_warning(&report, "stale_market_data_fallback_used"));
        assert!(!has_blocker(&report, "consecutive_loop_errors"));
        assert!(!has_blocker(&report, "loop_error_rate_excessive"));
        paths.cleanup();
    }

    #[test]
    fn mark_price_error_fails_tick_without_candidate_or_fill() {
        let paths = FixturePaths::new("mark_price_error_failed_tick");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        fs::write(&paths.log, "").unwrap();
        let mut config = paths.config();
        config.ticks = 1_000;
        let mut run_metrics = metrics(Vec::new());
        run_metrics.record_endpoint_error(PaperSoakEndpointErrorInput {
            tick_index: 0,
            reason: PaperSoakEndpointErrorReason::MarkPriceError,
            critical: true,
            stale_fallback_used: false,
        });
        run_metrics.record_loop_error(PaperSoakLoopErrorInput {
            reason: PaperSoakErrorReason::TransientMarketDataError,
            message: "mark price fetch failed".to_string(),
            state_mutated: false,
        });

        let report = build_soak_report_with_metrics(&config, 999, 0, 1, &run_metrics);

        assert!(report.soak_passed);
        assert_eq!(report.failed_ticks, 1);
        assert_eq!(report.candidate_generated_count, 0);
        assert_eq!(report.paper_trades_count, 0);
        assert_eq!(report.open_positions_count, 0);
        assert_eq!(report.endpoint_error_breakdown["mark_price_error"], 1);
        assert!(report.error_windows[0].critical);
        paths.cleanup();
    }

    #[test]
    fn orderbook_depth_error_fails_tick_without_state_mutation() {
        let paths = FixturePaths::new("orderbook_depth_error_failed_tick");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        fs::write(&paths.log, "").unwrap();
        let mut config = paths.config();
        config.ticks = 1_000;
        let mut run_metrics = metrics(Vec::new());
        run_metrics.record_endpoint_error(PaperSoakEndpointErrorInput {
            tick_index: 0,
            reason: PaperSoakEndpointErrorReason::OrderbookDepthError,
            critical: true,
            stale_fallback_used: false,
        });
        run_metrics.record_loop_error(PaperSoakLoopErrorInput {
            reason: PaperSoakErrorReason::TransientMarketDataError,
            message: "orderbook depth fetch failed".to_string(),
            state_mutated: false,
        });

        let report = build_soak_report_with_metrics(&config, 999, 0, 1, &run_metrics);

        assert!(report.soak_passed);
        assert_eq!(report.failed_ticks, 1);
        assert_eq!(report.state_mutation_count, 0);
        assert_eq!(report.endpoint_error_breakdown["orderbook_depth_error"], 1);
        assert!(report.error_windows[0].critical);
        paths.cleanup();
    }

    #[test]
    fn stale_fallback_older_than_limit_fails_tick() {
        let paths = FixturePaths::new("stale_fallback_too_old");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        fs::write(&paths.log, "").unwrap();
        let mut config = paths.config();
        config.ticks = 1_000;
        assert!(!endpoint_allows_stale_fallback(
            PaperSoakEndpointErrorReason::OpenInterestError,
            OPEN_INTEREST_STALE_MAX_AGE_SECONDS + 1
        ));
        let mut run_metrics = metrics(Vec::new());
        run_metrics.record_endpoint_error(PaperSoakEndpointErrorInput {
            tick_index: 0,
            reason: PaperSoakEndpointErrorReason::OpenInterestError,
            critical: false,
            stale_fallback_used: false,
        });
        run_metrics.record_loop_error(PaperSoakLoopErrorInput {
            reason: PaperSoakErrorReason::TransientMarketDataError,
            message: "open interest stale fallback expired".to_string(),
            state_mutated: false,
        });

        let report = build_soak_report_with_metrics(&config, 999, 0, 1, &run_metrics);

        assert!(report.soak_passed);
        assert_eq!(report.failed_ticks, 1);
        assert_eq!(report.stale_fallback_count, 0);
        assert_eq!(report.endpoint_error_breakdown["open_interest_error"], 1);
        paths.cleanup();
    }

    #[test]
    fn max_consecutive_critical_errors_blocks_soak() {
        let paths = FixturePaths::new("consecutive_critical_endpoint_errors");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        fs::write(&paths.log, "").unwrap();
        let mut config = paths.config();
        config.ticks = 1_000;
        let mut run_metrics = metrics(Vec::new());
        for tick_index in 0..3 {
            run_metrics.record_endpoint_error(PaperSoakEndpointErrorInput {
                tick_index,
                reason: PaperSoakEndpointErrorReason::MarkPriceError,
                critical: true,
                stale_fallback_used: false,
            });
            run_metrics.record_loop_error(PaperSoakLoopErrorInput {
                reason: PaperSoakErrorReason::TransientMarketDataError,
                message: "critical market data failed".to_string(),
                state_mutated: false,
            });
        }

        let report = build_soak_report_with_metrics(&config, 997, 0, 3, &run_metrics);

        assert!(!report.soak_passed);
        assert_eq!(report.max_consecutive_errors, 3);
        assert_eq!(report.error_windows.len(), 1);
        assert_eq!(report.error_windows[0].length, 3);
        assert!(report.error_windows[0].critical);
        assert!(has_blocker(&report, "consecutive_loop_errors"));
        paths.cleanup();
    }

    #[test]
    fn data_freshness_score_is_deterministic() {
        let paths = FixturePaths::new("data_freshness_score");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        fs::write(&paths.log, "").unwrap();
        let mut run_metrics = metrics(Vec::new());
        run_metrics.fresh_ticks = 8;
        run_metrics.record_stale_market_data_tick(1, 60);
        run_metrics.record_stale_market_data_tick(1, 120);

        let first = build_soak_report_with_metrics(&paths.config(), 10, 0, 0, &run_metrics);
        let second = build_soak_report_with_metrics(&paths.config(), 10, 0, 0, &run_metrics);

        assert_eq!(first.data_freshness_score, second.data_freshness_score);
        assert_eq!(first.data_freshness_score, dec!(0.95));
        assert_eq!(first.stale_fallback_count, 2);
        assert_eq!(first.max_stale_age_seconds, 120);
        paths.cleanup();
    }

    #[test]
    fn grade_distribution_is_deterministic() {
        let paths = FixturePaths::new("grade_distribution");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let metrics = metrics(vec![
            record(
                SignalGrade::APlus,
                SignalDirection::Long,
                dec!(92),
                true,
                true,
            ),
            record(
                SignalGrade::F,
                SignalDirection::Neutral,
                dec!(20),
                false,
                false,
            ),
        ]);

        let first = build_soak_report_with_metrics(&paths.config(), 2, 1, 0, &metrics);
        let second = build_soak_report_with_metrics(&paths.config(), 2, 1, 0, &metrics);

        assert_eq!(
            first.signal_grade_distribution,
            second.signal_grade_distribution
        );
        assert_eq!(first.signal_grade_distribution["a_plus"], 1);
        assert_eq!(first.signal_grade_distribution["f"], 1);
        assert_eq!(first.signal_direction_distribution["long"], 1);
        assert_eq!(first.signal_direction_distribution["neutral"], 1);
        paths.cleanup();
    }

    #[test]
    fn rejection_breakdown_is_deterministic() {
        let paths = FixturePaths::new("rejection_breakdown");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let metrics = metrics(vec![rejected_record()]);

        let first = build_soak_report_with_metrics(&paths.config(), 1, 0, 0, &metrics);
        let second = build_soak_report_with_metrics(&paths.config(), 1, 0, 0, &metrics);

        assert_eq!(
            first.rejection_breakdown_by_reason,
            second.rejection_breakdown_by_reason
        );
        assert_eq!(
            first.rejection_breakdown_by_reason["signal.neutral_signal"],
            1
        );
        assert_eq!(first.rejection_breakdown_by_reason["risk.weak_signal"], 1);
        assert_eq!(
            first.rejection_breakdown_by_reason["order.signal_rejected"],
            1
        );
        assert_eq!(
            first.rejection_breakdown_by_reason["order.signal_grade_too_low"],
            1
        );
        assert_eq!(
            first.rejection_breakdown_by_reason["order.signal_strength_too_low"],
            1
        );
        assert_eq!(
            first.rejection_breakdown_by_reason["order.edge_after_cost_too_low"],
            1
        );
        assert!(!first.rejection_breakdown_by_reason.is_empty());
        paths.cleanup();
    }

    #[test]
    fn low_edge_rejection_breakdown_is_counted() {
        let paths = FixturePaths::new("low_edge_rejection_breakdown");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let metrics = metrics(vec![low_edge_rejected_record()]);

        let report = build_soak_report_with_metrics(&paths.config(), 1, 0, 0, &metrics);

        assert_eq!(report.candidate_generated_count, 0);
        assert_eq!(
            report.rejection_breakdown_by_reason["order.edge_after_cost_too_low"],
            1
        );
        paths.cleanup();
    }

    #[test]
    fn report_path_writes_local_json() {
        let paths = FixturePaths::new("report_path_write");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let mut config = paths.config();
        config.report_path = Some(paths.report.display().to_string());

        let report = crate::paper_soak::finalize_report_with_metrics(
            &config,
            1,
            0,
            0,
            metrics(vec![rejected_record()]),
        );

        assert!(report.soak_passed);
        let persisted = fs::read_to_string(&paths.report).unwrap();
        assert!(persisted.contains("\"ticks_processed\": 1"));
        paths.cleanup();
    }

    #[test]
    fn unreadable_report_path_blocks_soak() {
        let paths = FixturePaths::new("bad_report_path");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let mut config = paths.config();
        config.report_path = Some("https://example.com/soak_report.json".to_string());

        let report = crate::paper_soak::finalize_report_with_metrics(
            &config,
            1,
            0,
            0,
            metrics(vec![rejected_record()]),
        );

        assert!(!report.soak_passed);
        assert!(has_blocker(&report, "soak_report_path_unreadable"));
        paths.cleanup();
    }

    #[test]
    fn state_mutation_anomaly_blocks_soak() {
        let paths = FixturePaths::new("state_mutation_anomaly");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let mut run_metrics = metrics(vec![rejected_record()]);
        run_metrics.state_mutation_count = 1;
        run_metrics.state_mutation_without_candidate_or_fill_count = 1;

        let report = build_soak_report_with_metrics(&paths.config(), 1, 0, 0, &run_metrics);

        assert!(!report.soak_passed);
        assert_eq!(report.state_mutation_count, 1);
        assert!(has_blocker(
            &report,
            "state_mutation_without_candidate_or_fill"
        ));
        paths.cleanup();
    }

    #[test]
    fn invalid_paper_fill_without_candidate_blocks_soak() {
        let paths = FixturePaths::new("invalid_fill_without_candidate");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let mut invalid_record = rejected_record();
        invalid_record.paper_fill_generated = true;
        invalid_record.state_mutated = true;
        let run_metrics = metrics(vec![invalid_record]);

        let report = build_soak_report_with_metrics(&paths.config(), 1, 0, 0, &run_metrics);

        assert!(!report.soak_passed);
        assert!(has_blocker(&report, "invalid_paper_fill_without_candidate"));
        paths.cleanup();
    }

    #[test]
    fn repeated_a_plus_without_paper_fills_warns() {
        let paths = FixturePaths::new("a_plus_without_fills");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let run_metrics = metrics(vec![
            record(
                SignalGrade::APlus,
                SignalDirection::Long,
                dec!(92),
                true,
                false,
            ),
            record(
                SignalGrade::APlus,
                SignalDirection::Short,
                dec!(90),
                true,
                false,
            ),
        ]);

        let report = build_soak_report_with_metrics(&paths.config(), 2, 2, 0, &run_metrics);

        assert!(has_warning(&report, "repeated_a_plus_without_paper_fills"));
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

    #[test]
    fn long_soak_report_remains_deterministic_under_mock_ticks() {
        let paths = FixturePaths::new("long_deterministic_report");
        write_state_for_test(&paths.state, &PaperEngineState::default()).unwrap();
        write_log(&paths.log, &[trade(false, false)]);
        let mut run_metrics = metrics(vec![
            record(
                SignalGrade::APlus,
                SignalDirection::Short,
                dec!(91),
                true,
                true,
            ),
            rejected_record(),
            record(SignalGrade::A, SignalDirection::Long, dec!(79), true, false),
        ]);
        run_metrics.paper_equity_start = dec!(200);
        run_metrics.paper_equity_end = dec!(199.9);
        run_metrics.duration_seconds = 120;
        run_metrics.state_mutation_count = 1;
        let config = paths.config();

        let first = build_soak_report_with_metrics(&config, 3, 2, 0, &run_metrics);
        let second = build_soak_report_with_metrics(&config, 3, 2, 0, &run_metrics);

        assert_eq!(first, second);
        assert_eq!(
            first.candidate_pressure_ratio,
            dec!(0.6666666666666666666666666667)
        );
        assert_eq!(first.paper_equity_drift, dec!(-0.1));
        assert_eq!(first.ticks_per_minute, dec!(1.5));
        paths.cleanup();
    }

    fn has_blocker(report: &PaperSoakReport, code: &str) -> bool {
        report.blockers.iter().any(|blocker| blocker.code == code)
    }

    fn has_warning(report: &PaperSoakReport, code: &str) -> bool {
        report.warnings.iter().any(|warning| warning.code == code)
    }

    fn metrics(records: Vec<PaperSoakDecisionRecord>) -> PaperSoakRunMetrics {
        PaperSoakRunMetrics {
            decisions: records,
            paper_equity_start: dec!(200),
            paper_equity_end: dec!(200),
            duration_seconds: 60,
            ..Default::default()
        }
    }

    fn nonconsecutive_loop_errors(reasons: &[PaperSoakErrorReason]) -> PaperSoakRunMetrics {
        let mut run_metrics = metrics(Vec::new());
        for reason in reasons {
            run_metrics.record_loop_error(PaperSoakLoopErrorInput {
                reason: *reason,
                message: reason.as_key().to_string(),
                state_mutated: false,
            });
            run_metrics.record_successful_tick();
        }
        run_metrics
    }

    fn consecutive_loop_errors(reasons: &[PaperSoakErrorReason]) -> PaperSoakRunMetrics {
        let mut run_metrics = metrics(Vec::new());
        for reason in reasons {
            run_metrics.record_loop_error(PaperSoakLoopErrorInput {
                reason: *reason,
                message: reason.as_key().to_string(),
                state_mutated: false,
            });
        }
        run_metrics
    }

    fn record(
        grade: SignalGrade,
        direction: SignalDirection,
        strength: rust_decimal::Decimal,
        candidate_generated: bool,
        paper_fill_generated: bool,
    ) -> PaperSoakDecisionRecord {
        let signal_allowed = direction != SignalDirection::Neutral && strength >= dec!(55);
        let signal_decision = signal_decision(
            grade,
            direction,
            strength,
            signal_allowed,
            vec![DecisionReason::ResearchOnlyMode],
        );
        let risk_allowed = signal_allowed;
        let risk_decision = risk_decision(
            risk_allowed,
            signal_decision.clone(),
            vec![
                RiskDecisionReason::ResearchOnlyMode,
                RiskDecisionReason::NoExecutableOrderGenerated,
            ],
        );
        let order_reasons = if candidate_generated {
            vec![
                OrderCandidateReason::DryRunOnly,
                OrderCandidateReason::NoExecutableOrderGenerated,
                OrderCandidateReason::ResearchOnlyMode,
                OrderCandidateReason::AuditOnly,
                OrderCandidateReason::CandidateGenerated,
            ]
        } else {
            vec![
                OrderCandidateReason::SignalRejected,
                OrderCandidateReason::RiskRejected,
                OrderCandidateReason::ResearchOnlyMode,
                OrderCandidateReason::SignalGradeTooLow,
                OrderCandidateReason::SignalStrengthTooLow,
                OrderCandidateReason::EdgeAfterCostTooLow,
                OrderCandidateReason::NoExecutableOrderGenerated,
            ]
        };
        let candidate_decision = order_candidate_decision(
            candidate_generated,
            signal_decision.clone(),
            risk_decision.clone(),
            order_reasons,
        );
        PaperSoakDecisionRecord {
            signal_decision,
            risk_decision,
            candidate_decision,
            edge_after_cost_ratio: Some(strength / dec!(10)),
            paper_fill_generated,
            state_mutated: paper_fill_generated,
            state_mutated_without_candidate_or_fill: false,
        }
    }

    fn rejected_record() -> PaperSoakDecisionRecord {
        let signal_decision = signal_decision(
            SignalGrade::F,
            SignalDirection::Neutral,
            dec!(20),
            false,
            vec![
                DecisionReason::NeutralSignal,
                DecisionReason::InsufficientStrength,
                DecisionReason::ResearchOnlyMode,
            ],
        );
        let risk_decision = risk_decision(
            false,
            signal_decision.clone(),
            vec![
                RiskDecisionReason::SignalNotAllowed,
                RiskDecisionReason::WeakSignal,
                RiskDecisionReason::ResearchOnlyMode,
                RiskDecisionReason::NoExecutableOrderGenerated,
            ],
        );
        let candidate_decision = order_candidate_decision(
            false,
            signal_decision.clone(),
            risk_decision.clone(),
            vec![
                OrderCandidateReason::SignalRejected,
                OrderCandidateReason::RiskRejected,
                OrderCandidateReason::ResearchOnlyMode,
                OrderCandidateReason::SignalGradeTooLow,
                OrderCandidateReason::SignalStrengthTooLow,
                OrderCandidateReason::EdgeAfterCostTooLow,
                OrderCandidateReason::NoExecutableOrderGenerated,
            ],
        );
        PaperSoakDecisionRecord {
            signal_decision,
            risk_decision,
            candidate_decision,
            edge_after_cost_ratio: Some(dec!(2)),
            paper_fill_generated: false,
            state_mutated: false,
            state_mutated_without_candidate_or_fill: false,
        }
    }

    fn low_edge_rejected_record() -> PaperSoakDecisionRecord {
        let signal_decision = signal_decision(
            SignalGrade::APlus,
            SignalDirection::Short,
            dec!(92),
            true,
            vec![DecisionReason::ResearchOnlyMode],
        );
        let risk_decision = risk_decision(
            true,
            signal_decision.clone(),
            vec![
                RiskDecisionReason::ResearchOnlyMode,
                RiskDecisionReason::NoExecutableOrderGenerated,
                RiskDecisionReason::RiskChecksPassed,
            ],
        );
        let candidate_decision = order_candidate_decision(
            false,
            signal_decision.clone(),
            risk_decision.clone(),
            vec![
                OrderCandidateReason::ResearchOnlyMode,
                OrderCandidateReason::EdgeAfterCostTooLow,
                OrderCandidateReason::NoExecutableOrderGenerated,
            ],
        );
        PaperSoakDecisionRecord {
            signal_decision,
            risk_decision,
            candidate_decision,
            edge_after_cost_ratio: Some(dec!(2.5)),
            paper_fill_generated: false,
            state_mutated: false,
            state_mutated_without_candidate_or_fill: false,
        }
    }

    fn signal_decision(
        grade: SignalGrade,
        direction: SignalDirection,
        strength: rust_decimal::Decimal,
        signal_allowed: bool,
        reasons: Vec<DecisionReason>,
    ) -> SignalDecision {
        SignalDecision {
            packet: SignalPacket {
                exchange: "test".to_string(),
                symbol: Symbol::new("BTCUSDT").unwrap(),
                direction,
                market_regime: MarketRegime::Neutral,
                price_structure_score: strength,
                derivatives_score: strength,
                funding_score: strength,
                liquidity_score: strength,
                cost_score: dec!(80),
                final_strength: strength,
                grade,
                reasons: Vec::new(),
            },
            signal_allowed,
            trade_allowed: false,
            reasons,
            summary: "test signal".to_string(),
        }
    }

    fn risk_decision(
        risk_allowed: bool,
        signal_decision: SignalDecision,
        reasons: Vec<RiskDecisionReason>,
    ) -> RiskBudgetDecision {
        RiskBudgetDecision {
            symbol: Symbol::new("BTCUSDT").unwrap(),
            risk_allowed,
            executable_trading_allowed: false,
            risk_budget_usdt: if risk_allowed { dec!(0.8) } else { dec!(0) },
            effective_one_r_usdt: dec!(0.8),
            max_loss_per_signal_usdt: dec!(1),
            account: AccountRiskState::default(),
            config: RiskBudgetConfig::default(),
            reasons,
            signal_decision,
            summary: "test risk".to_string(),
        }
    }

    fn order_candidate_decision(
        candidate_generated: bool,
        signal_decision: SignalDecision,
        risk_decision: RiskBudgetDecision,
        reasons: Vec<OrderCandidateReason>,
    ) -> OrderCandidateDecision {
        let candidate = candidate_generated.then(|| DryRunOrderCandidate {
            candidate_id: "audit-test".to_string(),
            exchange: "test".to_string(),
            symbol: Symbol::new("BTCUSDT").unwrap(),
            direction: signal_decision.packet.direction,
            reference_price: Price::new(dec!(100)).unwrap(),
            notional: dec!(60),
            margin_required: dec!(30),
            leverage: dec!(2),
            assumed_stop_distance_pct: dec!(0.005),
            max_loss_usdt: dec!(0.8),
            executable: false,
            real_order_id: None,
            audit_only: true,
            reasons: reasons.clone(),
        });
        OrderCandidateDecision {
            candidate_generated,
            candidate,
            reasons,
            signal_decision,
            risk_decision,
            sizing_config: CandidateSizingConfig::default(),
            summary: "test order candidate".to_string(),
        }
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
        report: PathBuf,
    }

    impl FixturePaths {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir()
                .join(format!("rustquanteth-soak-{name}-{}", std::process::id()));
            fs::create_dir_all(&dir).unwrap();
            Self {
                state: dir.join("paper_state.json"),
                log: dir.join("paper_trades.jsonl"),
                report: dir.join("soak_report.json"),
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
            let _ = fs::remove_file(&self.report);
            let _ = fs::remove_dir(&self.dir);
        }
    }
}
