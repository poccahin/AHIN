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
    AccountRiskState, ApiPermissionAuditReport, BacktestConfig, BacktestReport, CanaryBlocker,
    CanaryCheckResult, CanaryCheckStatus, CanaryReadinessConfig, CanaryReadinessReport,
    CandidateSizingConfig, CostEstimate, DecisionReason, DryRunOrderCandidate, EngineMode,
    ExchangeInfo, ExposureState, FeatureDelta, FeatureSnapshot, FeatureWindow, FundingRate,
    FundingRegime, GodTurnpointBlocker, GodTurnpointConfig, GodTurnpointDecision,
    GodTurnpointWarning, HexagramState, LiquidityMetrics, LiveGateConfig, LiveGateDecision,
    LiveGateReason, LiveMicroReadinessReport, ManualConfirmationState, MarketEvent,
    MarketEventLevel, MarketRegime, OpenInterest, OrderBook, OrderBookLevel, OrderCandidate,
    OrderCandidateDecision, OrderCandidateReason, OrderRequest, PaperEngineState, PaperPosition,
    PaperRunConfig, PaperRunReport, PaperSoakBlocker, PaperSoakComparisonBlocker,
    PaperSoakComparisonReport, PaperSoakComparisonWarning, PaperSoakConfig,
    PaperSoakEndpointErrorReason, PaperSoakErrorReason, PaperSoakErrorWindow, PaperSoakMetricDelta,
    PaperSoakReport, PaperSoakRetryConfig, PaperSoakWarning, PaperTick, PaperTrade, Position,
    PositionLine, ReleaseAuditBlocker, ReleaseAuditCheck, ReleaseAuditConfig, ReleaseAuditReport,
    ReleaseAuditWarning, ReplayDecision, RiskBudget, RiskBudgetConfig, RiskBudgetDecision,
    RiskDecisionReason, Side, SignalDecision, SignalDirection, SignalGrade, SignalPacket,
    SimulatedTrade, Symbol, Trigram, TurnpointEvidence, YiActionBias, YiReason, YiState, YinYang,
};
