use domain::{
    AccountRiskState, RiskBudgetConfig, RiskBudgetDecision, RiskDecisionReason, SignalDecision,
    SignalDirection,
};
use rust_decimal::Decimal;

use crate::{
    daily_loss_guard, equity_threshold_guard, gross_notional_guard, liquidation_buffer_guard,
    risk_budget, weekly_loss_guard,
};

pub fn evaluate_risk_budget(
    signal_decision: SignalDecision,
    account: AccountRiskState,
    config: RiskBudgetConfig,
) -> RiskBudgetDecision {
    let mut reasons = Vec::new();

    if !signal_decision.signal_allowed {
        push_reason(&mut reasons, RiskDecisionReason::SignalNotAllowed);
    }
    if signal_decision.packet.direction == SignalDirection::Neutral
        || signal_decision.packet.final_strength < config.min_signal_strength
    {
        push_reason(&mut reasons, RiskDecisionReason::WeakSignal);
    }

    for reason in daily_loss_guard::daily_loss_reasons(account.realized_pnl_today, &config) {
        push_reason(&mut reasons, reason);
    }
    if let Some(reason) = weekly_loss_guard::weekly_loss_reason(account.realized_pnl_week, &config)
    {
        push_reason(&mut reasons, reason);
    }
    for reason in equity_threshold_guard::equity_threshold_reasons(account.equity, &config) {
        push_reason(&mut reasons, reason);
    }
    if let Some(reason) = gross_notional_guard::gross_notional_reason(&account.exposure, &config) {
        push_reason(&mut reasons, reason);
    }
    if let Some(reason) =
        liquidation_buffer_guard::liquidation_buffer_reason(&account.exposure, &config)
    {
        push_reason(&mut reasons, reason);
    }
    if risk_budget::is_max_loss_capped(&config) {
        push_reason(&mut reasons, RiskDecisionReason::MaxLossPerSignalCapped);
    }
    if account.research_only {
        push_reason(&mut reasons, RiskDecisionReason::ResearchOnlyMode);
    }
    push_reason(&mut reasons, RiskDecisionReason::NoExecutableOrderGenerated);

    let risk_allowed = !has_blocking_reason(&reasons);
    if risk_allowed {
        push_reason(&mut reasons, RiskDecisionReason::RiskChecksPassed);
    }

    RiskBudgetDecision {
        symbol: signal_decision.packet.symbol.clone(),
        risk_allowed,
        executable_trading_allowed: false,
        risk_budget_usdt: if risk_allowed {
            risk_budget::risk_budget_usdt(&config)
        } else {
            Decimal::ZERO
        },
        effective_one_r_usdt: risk_budget::effective_one_r(&config),
        max_loss_per_signal_usdt: config.max_loss_per_signal_usdt,
        account,
        config,
        reasons,
        signal_decision,
        summary: if risk_allowed {
            "risk checks passed for research budgeting; executable trading remains disabled"
                .to_string()
        } else {
            "risk budget rejected by deterministic guardrails".to_string()
        },
    }
}

fn has_blocking_reason(reasons: &[RiskDecisionReason]) -> bool {
    reasons.iter().any(|reason| {
        matches!(
            reason,
            RiskDecisionReason::SignalNotAllowed
                | RiskDecisionReason::WeakSignal
                | RiskDecisionReason::DailyHardStop
                | RiskDecisionReason::WeeklyStop
                | RiskDecisionReason::TrendDisabledBelowEquity
                | RiskDecisionReason::PaperModeBelowEquity
                | RiskDecisionReason::GrossNotionalCapExceeded
                | RiskDecisionReason::LiquidationBufferTooSmall
        )
    })
}

fn push_reason(reasons: &mut Vec<RiskDecisionReason>, reason: RiskDecisionReason) {
    if !reasons.contains(&reason) {
        reasons.push(reason);
    }
}

#[cfg(test)]
mod tests {
    use domain::{
        AccountRiskState, DecisionReason, ExposureState, MarketRegime, RiskBudgetConfig,
        RiskDecisionReason, SignalDecision, SignalDirection, SignalGrade, SignalPacket, Symbol,
    };
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn daily_hard_stop_blocks_risk() {
        let account = AccountRiskState {
            realized_pnl_today: dec!(-3),
            ..Default::default()
        };

        let decision = evaluate_risk_budget(strong_signal(), account, RiskBudgetConfig::default());

        assert!(!decision.risk_allowed);
        assert!(
            decision
                .reasons
                .contains(&RiskDecisionReason::DailyHardStop)
        );
    }

    #[test]
    fn weekly_stop_blocks_risk() {
        let account = AccountRiskState {
            realized_pnl_week: dec!(-6),
            ..Default::default()
        };

        let decision = evaluate_risk_budget(strong_signal(), account, RiskBudgetConfig::default());

        assert!(!decision.risk_allowed);
        assert!(decision.reasons.contains(&RiskDecisionReason::WeeklyStop));
    }

    #[test]
    fn equity_below_190_disables_trend_risk() {
        let account = AccountRiskState {
            equity: dec!(189.99),
            ..Default::default()
        };

        let decision = evaluate_risk_budget(strong_signal(), account, RiskBudgetConfig::default());

        assert!(!decision.risk_allowed);
        assert!(
            decision
                .reasons
                .contains(&RiskDecisionReason::TrendDisabledBelowEquity)
        );
    }

    #[test]
    fn equity_below_180_adds_paper_mode_reason() {
        let account = AccountRiskState {
            equity: dec!(179.99),
            ..Default::default()
        };

        let decision = evaluate_risk_budget(strong_signal(), account, RiskBudgetConfig::default());

        assert!(!decision.risk_allowed);
        assert!(
            decision
                .reasons
                .contains(&RiskDecisionReason::PaperModeBelowEquity)
        );
    }

    #[test]
    fn gross_notional_above_360_blocks_risk() {
        let account = AccountRiskState {
            exposure: ExposureState {
                gross_notional: dec!(360.01),
                liquidation_buffer_bps: None,
            },
            ..Default::default()
        };

        let decision = evaluate_risk_budget(strong_signal(), account, RiskBudgetConfig::default());

        assert!(!decision.risk_allowed);
        assert!(
            decision
                .reasons
                .contains(&RiskDecisionReason::GrossNotionalCapExceeded)
        );
    }

    #[test]
    fn weak_signal_cannot_consume_risk() {
        let signal = weak_signal();

        let decision = evaluate_risk_budget(
            signal,
            AccountRiskState::default(),
            RiskBudgetConfig::default(),
        );

        assert!(!decision.risk_allowed);
        assert!(decision.reasons.contains(&RiskDecisionReason::WeakSignal));
    }

    #[test]
    fn a_plus_signal_passes_internal_risk_but_no_order_is_generated() {
        let decision = evaluate_risk_budget(
            strong_signal(),
            AccountRiskState::default(),
            RiskBudgetConfig::default(),
        );

        assert!(decision.risk_allowed);
        assert!(!decision.executable_trading_allowed);
        assert_eq!(decision.risk_budget_usdt, dec!(0.8));
        assert!(
            decision
                .reasons
                .contains(&RiskDecisionReason::RiskChecksPassed)
        );
        assert!(
            decision
                .reasons
                .contains(&RiskDecisionReason::NoExecutableOrderGenerated)
        );
    }

    #[test]
    fn research_only_mode_remains_visible_in_reasons() {
        let decision = evaluate_risk_budget(
            strong_signal(),
            AccountRiskState::default(),
            RiskBudgetConfig::default(),
        );

        assert!(
            decision
                .reasons
                .contains(&RiskDecisionReason::ResearchOnlyMode)
        );
    }

    fn strong_signal() -> SignalDecision {
        signal_decision(dec!(92), true, SignalDirection::Long)
    }

    fn weak_signal() -> SignalDecision {
        signal_decision(dec!(30), true, SignalDirection::Long)
    }

    fn signal_decision(
        strength: rust_decimal::Decimal,
        signal_allowed: bool,
        direction: SignalDirection,
    ) -> SignalDecision {
        SignalDecision {
            packet: SignalPacket {
                exchange: "test".to_string(),
                symbol: Symbol::new("BTCUSDT").unwrap(),
                direction,
                market_regime: MarketRegime::PositivePremium,
                price_structure_score: strength,
                derivatives_score: strength,
                funding_score: strength,
                liquidity_score: strength,
                cost_score: strength,
                final_strength: strength,
                grade: SignalGrade::APlus,
                reasons: Vec::new(),
            },
            signal_allowed,
            trade_allowed: false,
            reasons: vec![DecisionReason::ResearchOnlyMode],
            summary: "test signal".to_string(),
        }
    }
}
