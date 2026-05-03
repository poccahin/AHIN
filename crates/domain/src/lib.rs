#![forbid(unsafe_code)]

pub mod config;
pub mod errors;
pub mod money;
pub mod time;
pub mod types;

pub use config::{AccountConfig, EngineConfig, ExecutionConfig, SafetyConfig};
pub use errors::{AppError, AppResult};
pub use money::{Leverage, Notional, Price, Quantity};
pub use time::{Timestamp, now_utc};
pub use types::{
    CostEstimate, EngineMode, ExchangeInfo, FeatureSnapshot, FundingRate, FundingRegime,
    LiquidityMetrics, OpenInterest, OrderBook, OrderBookLevel, OrderCandidate, OrderRequest,
    Position, RiskBudget, Side, SignalPacket, Symbol,
};
