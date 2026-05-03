use domain::{EngineMode, OrderCandidate, Position, SignalPacket};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EngineState {
    pub engine_mode: EngineMode,
    pub equity: Decimal,
    pub high_water_mark: Decimal,
    pub risk_reserve: Decimal,
    pub current_positions: Vec<Position>,
    pub open_orders: Vec<OrderCandidate>,
    pub last_signal_packet: Option<SignalPacket>,
    pub realized_pnl_today: Decimal,
    pub realized_pnl_week: Decimal,
    pub gross_notional: Decimal,
    pub cooldown_until: Option<String>,
    pub last_exchange_sync: Option<String>,
    pub last_order_reconcile: Option<String>,
    pub last_error: Option<String>,
}

impl Default for EngineState {
    fn default() -> Self {
        Self {
            engine_mode: EngineMode::WaitingSignal,
            equity: Decimal::from(200),
            high_water_mark: Decimal::from(200),
            risk_reserve: Decimal::from(80),
            current_positions: Vec::new(),
            open_orders: Vec::new(),
            last_signal_packet: None,
            realized_pnl_today: Decimal::ZERO,
            realized_pnl_week: Decimal::ZERO,
            gross_notional: Decimal::ZERO,
            cooldown_until: None,
            last_exchange_sync: None,
            last_order_reconcile: None,
            last_error: None,
        }
    }
}
