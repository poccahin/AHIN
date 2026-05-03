use domain::{EngineMode, Position};

use crate::EngineState;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReconciliationOutcome {
    Matched,
    MismatchEnteredReduceOnly,
}

pub fn reconcile_positions(
    local_state: &mut EngineState,
    exchange_positions: &[Position],
) -> ReconciliationOutcome {
    if local_state.current_positions == exchange_positions {
        local_state.last_error = None;
        return ReconciliationOutcome::Matched;
    }

    // A state mismatch means the engine cannot trust its own risk view.
    local_state.engine_mode = EngineMode::ReduceOnly;
    local_state.last_error =
        Some("local positions differ from exchange positions; entered reduce-only".to_string());
    ReconciliationOutcome::MismatchEnteredReduceOnly
}

#[cfg(test)]
mod tests {
    use domain::{Leverage, Notional, Price, Quantity, Side, Symbol};
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn mismatch_enters_reduce_only() {
        let mut state = EngineState::default();
        let exchange_positions = vec![Position {
            symbol: Symbol::new("BTCUSDT").unwrap(),
            side: Side::Buy,
            quantity: Quantity::new(dec!(0.1)).unwrap(),
            entry_price: Price::new(dec!(100)).unwrap(),
            mark_price: Price::new(dec!(100)).unwrap(),
            notional: Notional::new(dec!(10)).unwrap(),
            leverage: Leverage::max_phase_one(dec!(2)).unwrap(),
            liquidation_price: None,
            reduce_only: false,
        }];

        let outcome = reconcile_positions(&mut state, &exchange_positions);

        assert_eq!(outcome, ReconciliationOutcome::MismatchEnteredReduceOnly);
        assert_eq!(state.engine_mode, EngineMode::ReduceOnly);
    }
}
