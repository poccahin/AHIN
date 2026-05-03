use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::{AppError, AppResult, Leverage, Notional, Price, Quantity};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Symbol(String);

impl Symbol {
    pub fn new(value: impl Into<String>) -> AppResult<Self> {
        let value = value.into().trim().to_uppercase();
        if value.is_empty() {
            return Err(AppError::InvalidSymbol(value));
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Side {
    Buy,
    Sell,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EngineMode {
    #[default]
    Research,
    DryRun,
    Paper,
    WaitingSignal,
    ReduceOnly,
}

impl EngineMode {
    pub fn allows_real_orders(self) -> bool {
        false
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SignalPacket {
    pub symbol: Symbol,
    pub side: Side,
    pub confidence: Decimal,
    pub regime_score: Decimal,
    pub edge_after_cost: Decimal,
    pub execution_quality: Decimal,
    pub risk_budget_fraction: Decimal,
    pub convexity_score: Decimal,
    pub valid: bool,
    pub reason: Option<String>,
}

impl SignalPacket {
    pub fn is_tradeable(&self) -> bool {
        self.valid
            && self.confidence > Decimal::ZERO
            && self.regime_score > Decimal::ZERO
            && self.edge_after_cost > Decimal::ZERO
            && self.execution_quality > Decimal::ZERO
            && self.risk_budget_fraction > Decimal::ZERO
            && self.convexity_score > Decimal::ZERO
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrderRequest {
    pub symbol: Symbol,
    pub side: Side,
    pub price: Price,
    pub quantity: Quantity,
    pub leverage: Leverage,
    pub reduce_only: bool,
    pub client_order_id: String,
}

impl OrderRequest {
    pub fn notional(&self) -> AppResult<Notional> {
        Notional::from_price_quantity(self.price, self.quantity)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrderCandidate {
    pub candidate_id: String,
    pub symbol: Symbol,
    pub side: Side,
    pub price: Price,
    pub quantity: Quantity,
    pub notional: Notional,
    pub leverage: Leverage,
    pub mode: EngineMode,
    pub reduce_only: bool,
    pub dry_run: bool,
    pub exchange_order_id: Option<String>,
    pub rationale: String,
}

impl OrderCandidate {
    pub fn is_dry_run_only(&self) -> bool {
        self.dry_run && self.exchange_order_id.is_none() && !self.mode.allows_real_orders()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RiskBudget {
    pub equity: Notional,
    pub risk_reserve: Notional,
    pub max_gross_notional: Notional,
    pub max_position_notional: Notional,
    pub max_daily_loss: Notional,
    pub max_leverage: Leverage,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Position {
    pub symbol: Symbol,
    pub side: Side,
    pub quantity: Quantity,
    pub entry_price: Price,
    pub mark_price: Price,
    pub notional: Notional,
    pub leverage: Leverage,
    pub liquidation_price: Option<Price>,
    pub reduce_only: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrderBook {
    pub symbol: Symbol,
    pub bid: Price,
    pub ask: Price,
    pub bid_quantity: Quantity,
    pub ask_quantity: Quantity,
}

impl OrderBook {
    pub fn spread_bps(&self) -> Decimal {
        let mid = (self.bid.as_decimal() + self.ask.as_decimal()) / Decimal::from(2);
        if mid <= Decimal::ZERO {
            return Decimal::MAX;
        }
        ((self.ask.as_decimal() - self.bid.as_decimal()) / mid) * Decimal::from(10_000)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FundingRate {
    pub symbol: Symbol,
    pub rate: Decimal,
    pub interval_hours: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OpenInterest {
    pub symbol: Symbol,
    pub quantity: Quantity,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExchangeInfo {
    pub symbols: Vec<Symbol>,
    pub min_notional: Notional,
    pub max_leverage: Leverage,
}

#[cfg(test)]
mod tests {
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn signal_packet_requires_all_trade_terms() {
        let packet = SignalPacket {
            symbol: Symbol::new("btcusdt").unwrap(),
            side: Side::Buy,
            confidence: dec!(1),
            regime_score: dec!(1),
            edge_after_cost: dec!(0),
            execution_quality: dec!(1),
            risk_budget_fraction: dec!(1),
            convexity_score: dec!(1),
            valid: true,
            reason: None,
        };

        assert!(!packet.is_tradeable());
    }

    #[test]
    fn dry_run_candidate_has_no_real_order_id() {
        let candidate = OrderCandidate {
            candidate_id: "dryrun-1".to_string(),
            symbol: Symbol::new("BTCUSDT").unwrap(),
            side: Side::Buy,
            price: Price::new(dec!(100)).unwrap(),
            quantity: Quantity::new(dec!(0.2)).unwrap(),
            notional: Notional::new(dec!(20)).unwrap(),
            leverage: Leverage::max_phase_one(dec!(2)).unwrap(),
            mode: EngineMode::DryRun,
            reduce_only: false,
            dry_run: true,
            exchange_order_id: None,
            rationale: "test".to_string(),
        };

        assert!(candidate.is_dry_run_only());
    }
}
