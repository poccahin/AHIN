use domain::{
    BacktestReport, OrderCandidateDecision, ReplayDecision, RiskBudgetDecision, SignalDecision,
    SimulatedTrade,
};
use rust_decimal::Decimal;

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
    gross_loss: Decimal,
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
            gross_loss: Decimal::ZERO,
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
            self.equity += trade.net_pnl_usdt;
            self.peak_equity = self.peak_equity.max(self.equity);
            self.max_drawdown = self.max_drawdown.max(self.peak_equity - self.equity);
            if trade.net_pnl_usdt > Decimal::ZERO {
                self.wins += 1;
                self.gross_profit += trade.net_pnl_usdt;
            } else if trade.net_pnl_usdt < Decimal::ZERO {
                self.losses += 1;
                self.gross_loss += trade.net_pnl_usdt.abs();
            }
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
            rejected_by_signal,
            rejected_by_risk,
            rejected_by_cost,
            decisions: self.decisions,
        }
    }
}

#[cfg(test)]
mod tests {
    use domain::{MarketEvent, MarketEventLevel, Symbol};
    use rust_decimal_macros::dec;

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
            funding_rate: dec!(0.0002),
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
}
