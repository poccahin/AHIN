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
    AccountRiskState, BacktestConfig, BacktestReport, CanaryBlocker, CanaryCheckResult,
    CanaryCheckStatus, CanaryReadinessConfig, CanaryReadinessReport, CandidateSizingConfig,
    CostEstimate, DecisionReason, DryRunOrderCandidate, EngineMode, ExchangeInfo, ExposureState,
    FeatureSnapshot, FundingRate, FundingRegime, LiquidityMetrics, MarketEvent, MarketEventLevel,
    MarketRegime, OpenInterest, OrderBook, OrderBookLevel, OrderCandidate, OrderCandidateDecision,
    OrderCandidateReason, OrderRequest, PaperEngineState, PaperPosition, PaperRunConfig,
    PaperRunReport, PaperSoakBlocker, PaperSoakComparisonBlocker, PaperSoakComparisonReport,
    PaperSoakComparisonWarning, PaperSoakConfig, PaperSoakErrorReason, PaperSoakMetricDelta,
    PaperSoakReport, PaperSoakWarning, PaperTick, PaperTrade, Position, ReplayDecision, RiskBudget,
    RiskBudgetConfig, RiskBudgetDecision, RiskDecisionReason, Side, SignalDecision,
    SignalDirection, SignalGrade, SignalPacket, SimulatedTrade, Symbol,
};
