use domain::{AppError, AppResult};
use rust_decimal::Decimal;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TailScenario {
    pub name: String,
    pub shock_pct: Decimal,
}

pub fn ensure_survives_tail_event(
    equity: Decimal,
    risk_reserve: Decimal,
    position_notional: Decimal,
    scenario: &TailScenario,
) -> AppResult<()> {
    if equity <= risk_reserve {
        return Err(AppError::RiskRejected(
            "equity must exceed risk reserve before tail simulation".to_string(),
        ));
    }
    let loss = position_notional * scenario.shock_pct.abs();
    let loss_capacity = equity - risk_reserve;
    if loss >= loss_capacity {
        return Err(AppError::RiskRejected(format!(
            "tail scenario '{}' loss {loss} exceeds capacity {loss_capacity}",
            scenario.name
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn rejects_tail_loss_that_breaches_available_equity() {
        let scenario = TailScenario {
            name: "flash crash".to_string(),
            shock_pct: dec!(0.30),
        };

        assert!(ensure_survives_tail_event(dec!(200), dec!(80), dec!(500), &scenario).is_err());
    }
}
