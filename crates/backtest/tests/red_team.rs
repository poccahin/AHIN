#![forbid(unsafe_code)]

use cost_engine::fee_model;
use domain::{
    EngineMode, Leverage, Notional, OrderRequest, Position, Price, Quantity, Side, Symbol,
};
use exchange::{ExchangeAdapter, MockExchange};
use execution_engine::reduce_only;
use market_data::{funding, liquidation_heatmap, mark_price};
use risk_engine::{liquidation_guard, risk_budget};
use rust_decimal_macros::dec;
use signal_engine::{false_breakout_guard, institutional_score};
use state_engine::{EngineState, ReconciliationOutcome, reconcile_positions};

#[test]
fn red_team_false_breakout_signal_is_blocked() {
    let input = false_breakout_guard::FalseBreakoutInput {
        breakout_triggered: true,
        volume_confirmed: true,
        closed_back_inside_range: true,
    };

    assert!(false_breakout_guard::ensure_not_false_breakout(input).is_err());
}

#[test]
fn red_team_liquidation_heatmap_misleading_is_blocked() {
    let heatmap = liquidation_heatmap::LiquidationHeatmapSignal {
        cluster_score: dec!(1),
        independent_confirmation: false,
    };

    assert!(liquidation_heatmap::ensure_heatmap_not_standalone(heatmap).is_err());
    assert!(institutional_score::ensure_independent_heatmap_confirmation(dec!(1), false).is_err());
}

#[test]
fn red_team_mark_price_close_to_liquidation_is_blocked() {
    let position = sample_position_with_liquidation(dec!(100), dec!(99));

    assert!(liquidation_guard::ensure_mark_not_near_liquidation(&position, dec!(0.02)).is_err());
}

#[test]
fn red_team_fee_attrition_is_blocked() {
    assert!(fee_model::ensure_cost_attrition_safe(dec!(200), dec!(4), dec!(0.01)).is_err());
}

#[test]
fn red_team_pyramid_top_add_after_reversal_is_blocked() {
    assert!(risk_budget::ensure_no_pyramid_add_after_reversal(dec!(40), dec!(20), true).is_err());
}

#[tokio::test]
async fn red_team_websocket_disconnect_is_blocked() {
    let exchange = MockExchange::default().disconnected();

    assert!(exchange.fetch_mark_price("BTCUSDT").await.is_err());
    assert!(mark_price::ensure_stream_fresh(false, 0, 1000).is_err());
}

#[test]
fn red_team_local_exchange_state_mismatch_enters_reduce_only() {
    let mut state = EngineState::default();
    let exchange_positions = vec![sample_position_with_liquidation(dec!(100), dec!(80))];

    let outcome = reconcile_positions(&mut state, &exchange_positions);

    assert_eq!(outcome, ReconciliationOutcome::MismatchEnteredReduceOnly);
    assert_eq!(state.engine_mode, EngineMode::ReduceOnly);
}

#[test]
fn red_team_funding_interval_change_is_blocked() {
    assert!(funding::ensure_funding_interval_unchanged(8, 4).is_err());
}

#[tokio::test]
async fn red_team_min_notional_failure_is_blocked() {
    let exchange = MockExchange::default();
    let request = OrderRequest {
        symbol: Symbol::new("BTCUSDT").unwrap(),
        side: Side::Buy,
        price: Price::new(dec!(100)).unwrap(),
        quantity: Quantity::new(dec!(0.01)).unwrap(),
        leverage: Leverage::max_phase_one(dec!(2)).unwrap(),
        reduce_only: false,
        client_order_id: "too-small".to_string(),
    };

    assert!(exchange.place_order_dry_run(request).await.is_err());
}

#[test]
fn red_team_reduce_only_order_failure_is_blocked() {
    assert!(reduce_only::ensure_reduce_only_can_execute(false, true).is_err());
}

fn sample_position_with_liquidation(
    mark_price: rust_decimal::Decimal,
    liquidation_price: rust_decimal::Decimal,
) -> Position {
    Position {
        symbol: Symbol::new("BTCUSDT").unwrap(),
        side: Side::Buy,
        quantity: Quantity::new(dec!(0.2)).unwrap(),
        entry_price: Price::new(dec!(100)).unwrap(),
        mark_price: Price::new(mark_price).unwrap(),
        notional: Notional::new(dec!(20)).unwrap(),
        leverage: Leverage::max_phase_one(dec!(2)).unwrap(),
        liquidation_price: Some(Price::new(liquidation_price).unwrap()),
        reduce_only: false,
    }
}
