use std::collections::BTreeMap;

use domain::{
    BacktestReport, DecisionReason, OrderCandidateDecision, OrderCandidateReason, ReplayDecision,
    RiskBudgetDecision, RiskDecisionReason, SignalDecision, SimulatedTrade,
};
use rust_decimal::Decimal;

use crate::pnl_simulator;

pub fn empty_report() -> BacktestReport {
    BacktestReport {
        events_processed: 0,
        candidates_generated: 0,
        simulated_trades: 0,
        gross_pnl_usdt: Decimal::ZERO,
        net_pnl_usdt: Decimal::ZERO,
        total_fees_usdt: Decimal::ZERO,
        max_drawdown_usdt: Decimal::ZERO,
        win_rate: Decimal::ZERO,
        profit_factor: Decimal::ZERO,
        avg_net_pnl_per_trade: Decimal::ZERO,
        median_net_pnl_per_trade: Decimal::ZERO,
        max_win_usdt: Decimal::ZERO,
        max_loss_usdt: Decimal::ZERO,
        avg_fee_per_trade: Decimal::ZERO,
        fee_to_gross_profit_ratio: Decimal::ZERO,
        expectancy_usdt: Decimal::ZERO,
        avg_r_multiple: Decimal::ZERO,
        max_consecutive_losses: 0,
        rejection_breakdown_by_reason: BTreeMap::new(),
        rejected_by_signal: 0,
        rejected_by_risk: 0,
        rejected_by_cost: 0,
        decisions: Vec::new(),
    }
}

#[derive(Debug, Clone)]
pub struct ReportBuilder {
    equity: Decimal,
    peak_equity: Decimal,
    max_drawdown: Decimal,
    gross_pnl: Decimal,
    net_pnl: Decimal,
    total_fees: Decimal,
    trades: u64,
    wins: u64,
    losses: u64,
    gross_profit: Decimal,
    positive_gross_profit: Decimal,
    gross_loss: Decimal,
    net_pnls: Vec<Decimal>,
    max_win: Decimal,
    max_loss: Decimal,
    sum_r_multiple: Decimal,
    current_consecutive_losses: u64,
    max_consecutive_losses: u64,
    rejection_breakdown_by_reason: BTreeMap<String, u64>,
    decisions: Vec<ReplayDecision>,
}

impl ReportBuilder {
    pub fn new(starting_equity: Decimal) -> Self {
        Self {
            equity: starting_equity,
            peak_equity: starting_equity,
            max_drawdown: Decimal::ZERO,
            gross_pnl: Decimal::ZERO,
            net_pnl: Decimal::ZERO,
            total_fees: Decimal::ZERO,
            trades: 0,
            wins: 0,
            losses: 0,
            gross_profit: Decimal::ZERO,
            positive_gross_profit: Decimal::ZERO,
            gross_loss: Decimal::ZERO,
            net_pnls: Vec::new(),
            max_win: Decimal::ZERO,
            max_loss: Decimal::ZERO,
            sum_r_multiple: Decimal::ZERO,
            current_consecutive_losses: 0,
            max_consecutive_losses: 0,
            rejection_breakdown_by_reason: BTreeMap::new(),
            decisions: Vec::new(),
        }
    }

    pub fn record(
        &mut self,
        sequence: u64,
        signal_decision: &SignalDecision,
        risk_decision: &RiskBudgetDecision,
        candidate_decision: &OrderCandidateDecision,
        trade: Option<SimulatedTrade>,
    ) {
        let rejected_by_signal = !signal_decision.signal_allowed;
        let rejected_by_risk = signal_decision.signal_allowed && !risk_decision.risk_allowed;
        let rejected_by_cost = signal_decision
            .reasons
            .contains(&domain::DecisionReason::HighCost);

        if let Some(trade) = &trade {
            self.trades += 1;
            self.gross_pnl += trade.gross_pnl_usdt;
            self.net_pnl += trade.net_pnl_usdt;
            self.total_fees += trade.fees_usdt;
            self.net_pnls.push(trade.net_pnl_usdt);
            self.equity += trade.net_pnl_usdt;
            self.peak_equity = self.peak_equity.max(self.equity);
            self.max_drawdown = self.max_drawdown.max(self.peak_equity - self.equity);
            if trade.gross_pnl_usdt > Decimal::ZERO {
                self.positive_gross_profit += trade.gross_pnl_usdt;
            }
            if trade.net_pnl_usdt > Decimal::ZERO {
                self.wins += 1;
                self.gross_profit += trade.net_pnl_usdt;
                self.max_win = self.max_win.max(trade.net_pnl_usdt);
                self.current_consecutive_losses = 0;
            } else if trade.net_pnl_usdt < Decimal::ZERO {
                self.losses += 1;
                self.gross_loss += trade.net_pnl_usdt.abs();
                self.max_loss = self.max_loss.min(trade.net_pnl_usdt);
                self.current_consecutive_losses += 1;
                self.max_consecutive_losses = self
                    .max_consecutive_losses
                    .max(self.current_consecutive_losses);
            } else {
                self.current_consecutive_losses = 0;
            }

            if let Some(candidate) = candidate_decision.candidate.as_ref() {
                self.sum_r_multiple +=
                    pnl_simulator::r_multiple(trade.net_pnl_usdt, candidate.max_loss_usdt);
            }
        }

        if !candidate_decision.candidate_generated {
            self.record_rejection_reasons(signal_decision, risk_decision, candidate_decision);
        }

        self.decisions.push(ReplayDecision {
            sequence,
            signal_allowed: signal_decision.signal_allowed,
            risk_allowed: risk_decision.risk_allowed,
            candidate_generated: candidate_decision.candidate_generated,
            simulated_trade: trade,
            rejected_by_signal,
            rejected_by_risk,
            rejected_by_cost,
        });
    }

    fn record_rejection_reasons(
        &mut self,
        signal_decision: &SignalDecision,
        risk_decision: &RiskBudgetDecision,
        candidate_decision: &OrderCandidateDecision,
    ) {
        for reason in &signal_decision.reasons {
            self.increment_reason(signal_reason_key(*reason));
        }
        for reason in &risk_decision.reasons {
            self.increment_reason(risk_reason_key(*reason));
        }
        for reason in &candidate_decision.reasons {
            self.increment_reason(order_candidate_reason_key(*reason));
        }
    }

    fn increment_reason(&mut self, reason: &'static str) {
        *self
            .rejection_breakdown_by_reason
            .entry(reason.to_string())
            .or_insert(0) += 1;
    }

    pub fn finish(self) -> BacktestReport {
        let trades = self.trades;
        let rejected_by_signal = self
            .decisions
            .iter()
            .filter(|decision| decision.rejected_by_signal)
            .count() as u64;
        let rejected_by_risk = self
            .decisions
            .iter()
            .filter(|decision| decision.rejected_by_risk)
            .count() as u64;
        let rejected_by_cost = self
            .decisions
            .iter()
            .filter(|decision| decision.rejected_by_cost)
            .count() as u64;
        let candidates_generated = self
            .decisions
            .iter()
            .filter(|decision| decision.candidate_generated)
            .count() as u64;
        let avg_net_pnl_per_trade = if trades == 0 {
            Decimal::ZERO
        } else {
            self.net_pnl / Decimal::from(trades)
        };
        let avg_fee_per_trade = if trades == 0 {
            Decimal::ZERO
        } else {
            self.total_fees / Decimal::from(trades)
        };
        let avg_r_multiple = if trades == 0 {
            Decimal::ZERO
        } else {
            self.sum_r_multiple / Decimal::from(trades)
        };
        let fee_to_gross_profit_ratio = if self.positive_gross_profit <= Decimal::ZERO {
            Decimal::ZERO
        } else {
            self.total_fees / self.positive_gross_profit
        };

        BacktestReport {
            events_processed: self.decisions.len() as u64,
            candidates_generated,
            simulated_trades: trades,
            gross_pnl_usdt: self.gross_pnl,
            net_pnl_usdt: self.net_pnl,
            total_fees_usdt: self.total_fees,
            max_drawdown_usdt: self.max_drawdown,
            win_rate: if trades == 0 {
                Decimal::ZERO
            } else {
                Decimal::from(self.wins) / Decimal::from(trades)
            },
            profit_factor: if self.gross_loss <= Decimal::ZERO {
                Decimal::ZERO
            } else {
                self.gross_profit / self.gross_loss
            },
            avg_net_pnl_per_trade,
            median_net_pnl_per_trade: median_decimal(self.net_pnls),
            max_win_usdt: self.max_win,
            max_loss_usdt: self.max_loss,
            avg_fee_per_trade,
            fee_to_gross_profit_ratio,
            expectancy_usdt: avg_net_pnl_per_trade,
            avg_r_multiple,
            max_consecutive_losses: self.max_consecutive_losses,
            rejection_breakdown_by_reason: self.rejection_breakdown_by_reason,
            rejected_by_signal,
            rejected_by_risk,
            rejected_by_cost,
            decisions: self.decisions,
        }
    }
}

fn median_decimal(mut values: Vec<Decimal>) -> Decimal {
    if values.is_empty() {
        return Decimal::ZERO;
    }

    values.sort();
    let mid = values.len() / 2;
    if values.len().is_multiple_of(2) {
        (values[mid - 1] + values[mid]) / Decimal::from(2)
    } else {
        values[mid]
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

#[cfg(test)]
mod tests {
    use domain::{
        AccountRiskState, CandidateSizingConfig, DecisionReason, DryRunOrderCandidate, MarketEvent,
        MarketEventLevel, MarketRegime, OrderCandidateReason, Price, RiskBudgetConfig,
        RiskDecisionReason, SignalDecision, SignalDirection, SignalGrade, SignalPacket, Symbol,
    };
    use rust_decimal_macros::dec;

    use super::*;
    use crate::event_replay::replay_events;

    #[test]
    fn max_drawdown_is_computed() {
        let events = vec![
            event(1, dec!(100), dec!(99)),
            event(2, dec!(101), dec!(100)),
            event(3, dec!(102), dec!(101)),
        ];
        let report = replay_events(&events, &domain::BacktestConfig::default()).unwrap();

        assert!(report.max_drawdown_usdt > dec!(0));
    }

    #[test]
    fn fee_to_gross_profit_ratio_is_computed() {
        let report = report_from_trades(&[(dec!(10), dec!(9), dec!(1))]);

        assert_eq!(report.fee_to_gross_profit_ratio, dec!(0.1));
        assert_eq!(report.avg_fee_per_trade, dec!(1));
    }

    #[test]
    fn median_pnl_is_deterministic() {
        let report = report_from_trades(&[
            (dec!(3.5), dec!(3), dec!(0.5)),
            (dec!(1.5), dec!(1), dec!(0.5)),
            (dec!(-1.5), dec!(-2), dec!(0.5)),
        ]);

        assert_eq!(report.median_net_pnl_per_trade, dec!(1));
        assert_eq!(
            report.avg_net_pnl_per_trade,
            dec!(0.6666666666666666666666666667)
        );
        assert_eq!(report.expectancy_usdt, report.avg_net_pnl_per_trade);
    }

    #[test]
    fn max_consecutive_losses_is_computed() {
        let report = report_from_trades(&[
            (dec!(-1), dec!(-1), dec!(0)),
            (dec!(-2), dec!(-2), dec!(0)),
            (dec!(3), dec!(3), dec!(0)),
            (dec!(-4), dec!(-4), dec!(0)),
        ]);

        assert_eq!(report.max_consecutive_losses, 2);
        assert_eq!(report.max_win_usdt, dec!(3));
        assert_eq!(report.max_loss_usdt, dec!(-4));
    }

    #[test]
    fn rejection_reasons_are_counted() {
        let mut builder = ReportBuilder::new(dec!(200));
        let signal_decision = signal_decision(
            false,
            vec![
                DecisionReason::NeutralSignal,
                DecisionReason::ResearchOnlyMode,
            ],
        );
        let risk_decision = risk_decision(
            &signal_decision,
            false,
            vec![
                RiskDecisionReason::SignalNotAllowed,
                RiskDecisionReason::WeakSignal,
            ],
        );
        let candidate_decision = candidate_decision(
            &signal_decision,
            &risk_decision,
            false,
            vec![OrderCandidateReason::SignalRejected],
        );

        builder.record(
            1,
            &signal_decision,
            &risk_decision,
            &candidate_decision,
            None,
        );
        let report = builder.finish();

        assert_eq!(
            report.rejection_breakdown_by_reason["signal.neutral_signal"],
            1
        );
        assert_eq!(report.rejection_breakdown_by_reason["risk.weak_signal"], 1);
        assert_eq!(
            report.rejection_breakdown_by_reason["order.signal_rejected"],
            1
        );
    }

    #[test]
    fn empty_trade_set_produces_safe_zero_outputs() {
        let report = ReportBuilder::new(dec!(200)).finish();

        assert_eq!(report.simulated_trades, 0);
        assert_eq!(report.avg_net_pnl_per_trade, dec!(0));
        assert_eq!(report.median_net_pnl_per_trade, dec!(0));
        assert_eq!(report.fee_to_gross_profit_ratio, dec!(0));
        assert_eq!(report.avg_r_multiple, dec!(0));
        assert_eq!(report.max_consecutive_losses, 0);
        assert!(report.rejection_breakdown_by_reason.is_empty());
    }

    #[test]
    fn report_remains_deterministic() {
        let trades = [
            (dec!(1), dec!(0.8), dec!(0.2)),
            (dec!(-2), dec!(-2.2), dec!(0.2)),
            (dec!(3), dec!(2.8), dec!(0.2)),
        ];

        let first = report_from_trades(&trades);
        let second = report_from_trades(&trades);

        assert_eq!(first, second);
    }

    fn event(
        sequence: u64,
        mark_price: rust_decimal::Decimal,
        index_price: rust_decimal::Decimal,
    ) -> MarketEvent {
        MarketEvent {
            sequence,
            timestamp_ms: sequence,
            exchange: "offline".to_string(),
            symbol: Symbol::new("BTCUSDT").unwrap(),
            mark_price,
            index_price,
            funding_rate: dec!(0.0006),
            open_interest: dec!(1000),
            bid_levels: vec![MarketEventLevel {
                price: mark_price - dec!(0.01),
                quantity: dec!(500),
            }],
            ask_levels: vec![MarketEventLevel {
                price: mark_price + dec!(0.01),
                quantity: dec!(500),
            }],
        }
    }

    fn report_from_trades(
        trades: &[(
            rust_decimal::Decimal,
            rust_decimal::Decimal,
            rust_decimal::Decimal,
        )],
    ) -> BacktestReport {
        let mut builder = ReportBuilder::new(dec!(200));
        let signal_decision = signal_decision(true, vec![DecisionReason::ResearchOnlyMode]);
        let risk_decision = risk_decision(
            &signal_decision,
            true,
            vec![
                RiskDecisionReason::ResearchOnlyMode,
                RiskDecisionReason::NoExecutableOrderGenerated,
                RiskDecisionReason::RiskChecksPassed,
            ],
        );
        let candidate_decision = candidate_decision(
            &signal_decision,
            &risk_decision,
            true,
            vec![OrderCandidateReason::CandidateGenerated],
        );

        for (idx, (gross_pnl, net_pnl, fees)) in trades.iter().enumerate() {
            builder.record(
                idx as u64,
                &signal_decision,
                &risk_decision,
                &candidate_decision,
                Some(trade(idx as u64, *gross_pnl, *net_pnl, *fees)),
            );
        }

        builder.finish()
    }

    fn trade(
        sequence: u64,
        gross_pnl_usdt: rust_decimal::Decimal,
        net_pnl_usdt: rust_decimal::Decimal,
        fees_usdt: rust_decimal::Decimal,
    ) -> domain::SimulatedTrade {
        domain::SimulatedTrade {
            entry_sequence: sequence,
            exit_sequence: sequence + 1,
            symbol: Symbol::new("BTCUSDT").unwrap(),
            direction: SignalDirection::Long,
            entry_price: dec!(100),
            exit_price: dec!(101),
            notional: dec!(60),
            gross_pnl_usdt,
            fees_usdt,
            net_pnl_usdt,
            executable: false,
            real_order_id: None,
        }
    }

    fn signal_decision(allowed: bool, reasons: Vec<DecisionReason>) -> SignalDecision {
        SignalDecision {
            packet: SignalPacket {
                exchange: "offline".to_string(),
                symbol: Symbol::new("BTCUSDT").unwrap(),
                direction: if allowed {
                    SignalDirection::Long
                } else {
                    SignalDirection::Neutral
                },
                market_regime: if allowed {
                    MarketRegime::PositivePremium
                } else {
                    MarketRegime::Neutral
                },
                price_structure_score: dec!(90),
                derivatives_score: dec!(90),
                funding_score: dec!(90),
                liquidity_score: dec!(90),
                cost_score: dec!(90),
                final_strength: dec!(90),
                grade: SignalGrade::APlus,
                reasons: reasons.clone(),
            },
            signal_allowed: allowed,
            trade_allowed: false,
            reasons,
            summary: "test signal decision".to_string(),
        }
    }

    fn risk_decision(
        signal_decision: &SignalDecision,
        allowed: bool,
        reasons: Vec<RiskDecisionReason>,
    ) -> domain::RiskBudgetDecision {
        domain::RiskBudgetDecision {
            symbol: Symbol::new("BTCUSDT").unwrap(),
            risk_allowed: allowed,
            executable_trading_allowed: false,
            risk_budget_usdt: if allowed { dec!(0.8) } else { dec!(0) },
            effective_one_r_usdt: dec!(0.8),
            max_loss_per_signal_usdt: dec!(1),
            account: AccountRiskState::default(),
            config: RiskBudgetConfig::default(),
            reasons,
            signal_decision: signal_decision.clone(),
            summary: "test risk decision".to_string(),
        }
    }

    fn candidate_decision(
        signal_decision: &SignalDecision,
        risk_decision: &domain::RiskBudgetDecision,
        generated: bool,
        reasons: Vec<OrderCandidateReason>,
    ) -> domain::OrderCandidateDecision {
        domain::OrderCandidateDecision {
            candidate_generated: generated,
            candidate: generated.then(candidate),
            reasons,
            signal_decision: signal_decision.clone(),
            risk_decision: risk_decision.clone(),
            sizing_config: CandidateSizingConfig::default(),
            summary: "test candidate decision".to_string(),
        }
    }

    fn candidate() -> DryRunOrderCandidate {
        DryRunOrderCandidate {
            candidate_id: "audit-test".to_string(),
            exchange: "offline".to_string(),
            symbol: Symbol::new("BTCUSDT").unwrap(),
            direction: SignalDirection::Long,
            reference_price: Price::new(dec!(100)).unwrap(),
            notional: dec!(60),
            margin_required: dec!(30),
            leverage: dec!(2),
            assumed_stop_distance_pct: dec!(0.005),
            max_loss_usdt: dec!(2),
            executable: false,
            real_order_id: None,
            audit_only: true,
            reasons: vec![OrderCandidateReason::CandidateGenerated],
        }
    }
}
