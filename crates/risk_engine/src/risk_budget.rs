use domain::{AppError, AppResult, OrderCandidate, RiskBudget, RiskBudgetConfig};
use rust_decimal::Decimal;

pub fn ensure_order_within_budget(order: &OrderCandidate, budget: &RiskBudget) -> AppResult<()> {
    if order.notional > budget.max_position_notional {
        return Err(AppError::RiskRejected(format!(
            "order notional {} exceeds max position notional {}",
            order.notional.as_decimal(),
            budget.max_position_notional.as_decimal()
        )));
    }
    if order.leverage > budget.max_leverage {
        return Err(AppError::RiskRejected(format!(
            "order leverage {} exceeds risk max {}",
            order.leverage.as_decimal(),
            budget.max_leverage.as_decimal()
        )));
    }
    Ok(())
}

pub fn ensure_no_pyramid_add_after_reversal(
    existing_position_notional: Decimal,
    add_notional: Decimal,
    reversal_confirmed: bool,
) -> AppResult<()> {
    if existing_position_notional > Decimal::ZERO
        && add_notional > Decimal::ZERO
        && reversal_confirmed
    {
        return Err(AppError::RiskRejected(
            "pyramid add blocked after reversal confirmation".to_string(),
        ));
    }
    Ok(())
}

pub fn effective_one_r(config: &RiskBudgetConfig) -> Decimal {
    config.one_r_usdt.min(config.max_loss_per_signal_usdt)
}

pub fn risk_budget_usdt(config: &RiskBudgetConfig) -> Decimal {
    effective_one_r(config)
}

pub fn is_max_loss_capped(config: &RiskBudgetConfig) -> bool {
    config.one_r_usdt > config.max_loss_per_signal_usdt
}

#[cfg(test)]
mod tests {
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn default_one_r_is_below_max_signal_loss() {
        let config = RiskBudgetConfig::default();

        assert_eq!(effective_one_r(&config), dec!(0.8));
        assert!(!is_max_loss_capped(&config));
    }
}
