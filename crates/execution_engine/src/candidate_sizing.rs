use domain::{CandidateSizingConfig, OrderCandidateReason, RiskBudgetDecision};
use rust_decimal::Decimal;

use crate::order_candidate;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CandidateSizing {
    pub notional: Decimal,
    pub margin_required: Decimal,
    pub leverage: Decimal,
    pub max_loss_usdt: Decimal,
    pub reasons: Vec<OrderCandidateReason>,
}

pub fn size_candidate(
    risk_decision: &RiskBudgetDecision,
    config: &CandidateSizingConfig,
) -> CandidateSizing {
    let mut reasons = Vec::new();
    let leverage = config.default_leverage.min(config.max_leverage);
    let max_loss = config
        .one_r_usdt
        .min(config.max_loss_per_signal_usdt)
        .min(risk_decision.risk_budget_usdt);
    if config.one_r_usdt > config.max_loss_per_signal_usdt {
        order_candidate::push_reason(&mut reasons, OrderCandidateReason::SizingCappedByMaxLoss);
    }

    let stop_based_notional = if config.assumed_stop_distance_pct <= Decimal::ZERO {
        Decimal::ZERO
    } else {
        max_loss / config.assumed_stop_distance_pct
    };

    let mut notional = stop_based_notional;
    if notional > config.max_initial_signal_notional {
        notional = config.max_initial_signal_notional;
        order_candidate::push_reason(
            &mut reasons,
            OrderCandidateReason::SizingCappedByInitialNotional,
        );
    }

    let remaining_gross = (config.max_gross_notional
        - risk_decision.account.exposure.gross_notional)
        .max(Decimal::ZERO);
    if notional > remaining_gross {
        notional = remaining_gross;
        order_candidate::push_reason(
            &mut reasons,
            OrderCandidateReason::SizingCappedByGrossNotional,
        );
    }

    let margin_required = if leverage <= Decimal::ZERO {
        Decimal::ZERO
    } else {
        notional / leverage
    };

    CandidateSizing {
        notional,
        margin_required,
        leverage,
        max_loss_usdt: max_loss,
        reasons,
    }
}

#[cfg(test)]
mod tests {
    use domain::{
        AccountRiskState, DecisionReason, ExposureState, MarketRegime, RiskBudgetConfig,
        RiskBudgetDecision, RiskDecisionReason, SignalDecision, SignalDirection, SignalGrade,
        SignalPacket, Symbol,
    };
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn notional_respects_initial_signal_cap() {
        let decision = passing_risk_with_gross(dec!(0));
        let sizing = size_candidate(&decision, &CandidateSizingConfig::default());

        assert_eq!(sizing.notional, dec!(60));
        assert!(
            sizing
                .reasons
                .contains(&OrderCandidateReason::SizingCappedByInitialNotional)
        );
    }

    #[test]
    fn notional_respects_remaining_gross_notional() {
        let decision = passing_risk_with_gross(dec!(350));
        let sizing = size_candidate(&decision, &CandidateSizingConfig::default());

        assert_eq!(sizing.notional, dec!(10));
        assert!(
            sizing
                .reasons
                .contains(&OrderCandidateReason::SizingCappedByGrossNotional)
        );
    }

    #[test]
    fn margin_respects_leverage() {
        let decision = passing_risk_with_gross(dec!(0));
        let sizing = size_candidate(&decision, &CandidateSizingConfig::default());

        assert_eq!(sizing.leverage, dec!(2));
        assert_eq!(sizing.margin_required, dec!(30));
    }

    fn passing_risk_with_gross(gross_notional: rust_decimal::Decimal) -> RiskBudgetDecision {
        let signal_decision = strong_signal();
        RiskBudgetDecision {
            symbol: Symbol::new("BTCUSDT").unwrap(),
            risk_allowed: true,
            executable_trading_allowed: false,
            risk_budget_usdt: dec!(0.8),
            effective_one_r_usdt: dec!(0.8),
            max_loss_per_signal_usdt: dec!(1),
            account: AccountRiskState {
                exposure: ExposureState {
                    gross_notional,
                    liquidation_buffer_bps: None,
                },
                ..Default::default()
            },
            config: RiskBudgetConfig::default(),
            reasons: vec![
                RiskDecisionReason::ResearchOnlyMode,
                RiskDecisionReason::NoExecutableOrderGenerated,
                RiskDecisionReason::RiskChecksPassed,
            ],
            signal_decision,
            summary: "risk passed".to_string(),
        }
    }

    fn strong_signal() -> SignalDecision {
        SignalDecision {
            packet: SignalPacket {
                exchange: "test".to_string(),
                symbol: Symbol::new("BTCUSDT").unwrap(),
                direction: SignalDirection::Long,
                market_regime: MarketRegime::PositivePremium,
                price_structure_score: dec!(92),
                derivatives_score: dec!(92),
                funding_score: dec!(92),
                liquidity_score: dec!(92),
                cost_score: dec!(92),
                final_strength: dec!(92),
                grade: SignalGrade::APlus,
                reasons: Vec::new(),
            },
            signal_allowed: true,
            trade_allowed: false,
            reasons: vec![DecisionReason::ResearchOnlyMode],
            summary: "test".to_string(),
        }
    }
}
