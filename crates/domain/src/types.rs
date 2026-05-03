use std::collections::BTreeMap;

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
pub struct RiskBudgetConfig {
    pub one_r_usdt: Decimal,
    pub max_loss_per_signal_usdt: Decimal,
    pub daily_soft_stop_usdt: Decimal,
    pub daily_hard_stop_usdt: Decimal,
    pub weekly_stop_usdt: Decimal,
    pub disable_trend_below_equity: Decimal,
    pub paper_mode_below_equity: Decimal,
    pub max_gross_notional: Decimal,
    pub min_signal_strength: Decimal,
    pub min_liquidation_buffer_bps: Decimal,
}

impl Default for RiskBudgetConfig {
    fn default() -> Self {
        Self {
            one_r_usdt: Decimal::new(8, 1),
            max_loss_per_signal_usdt: Decimal::ONE,
            daily_soft_stop_usdt: Decimal::from(2),
            daily_hard_stop_usdt: Decimal::from(3),
            weekly_stop_usdt: Decimal::from(6),
            disable_trend_below_equity: Decimal::from(190),
            paper_mode_below_equity: Decimal::from(180),
            max_gross_notional: Decimal::from(360),
            min_signal_strength: Decimal::from(55),
            min_liquidation_buffer_bps: Decimal::from(100),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExposureState {
    pub gross_notional: Decimal,
    pub liquidation_buffer_bps: Option<Decimal>,
}

impl Default for ExposureState {
    fn default() -> Self {
        Self {
            gross_notional: Decimal::ZERO,
            liquidation_buffer_bps: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AccountRiskState {
    pub equity: Decimal,
    pub realized_pnl_today: Decimal,
    pub realized_pnl_week: Decimal,
    pub exposure: ExposureState,
    pub research_only: bool,
}

impl Default for AccountRiskState {
    fn default() -> Self {
        Self {
            equity: Decimal::from(200),
            realized_pnl_today: Decimal::ZERO,
            realized_pnl_week: Decimal::ZERO,
            exposure: ExposureState::default(),
            research_only: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskDecisionReason {
    ResearchOnlyMode,
    SignalNotAllowed,
    WeakSignal,
    DailySoftStop,
    DailyHardStop,
    WeeklyStop,
    TrendDisabledBelowEquity,
    PaperModeBelowEquity,
    GrossNotionalCapExceeded,
    LiquidationBufferTooSmall,
    RiskChecksPassed,
    MaxLossPerSignalCapped,
    NoExecutableOrderGenerated,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RiskBudgetDecision {
    pub symbol: Symbol,
    pub risk_allowed: bool,
    pub executable_trading_allowed: bool,
    pub risk_budget_usdt: Decimal,
    pub effective_one_r_usdt: Decimal,
    pub max_loss_per_signal_usdt: Decimal,
    pub account: AccountRiskState,
    pub config: RiskBudgetConfig,
    pub reasons: Vec<RiskDecisionReason>,
    pub signal_decision: SignalDecision,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CandidateSizingConfig {
    pub one_r_usdt: Decimal,
    pub max_loss_per_signal_usdt: Decimal,
    pub default_leverage: Decimal,
    pub max_leverage: Decimal,
    pub assumed_stop_distance_pct: Decimal,
    pub max_initial_signal_notional: Decimal,
    pub max_gross_notional: Decimal,
}

impl Default for CandidateSizingConfig {
    fn default() -> Self {
        Self {
            one_r_usdt: Decimal::new(8, 1),
            max_loss_per_signal_usdt: Decimal::ONE,
            default_leverage: Decimal::from(2),
            max_leverage: Decimal::from(3),
            assumed_stop_distance_pct: Decimal::new(5, 3),
            max_initial_signal_notional: Decimal::from(60),
            max_gross_notional: Decimal::from(360),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrderCandidateReason {
    DryRunOnly,
    NoExecutableOrderGenerated,
    SignalRejected,
    RiskRejected,
    ResearchOnlyMode,
    SignalGradeTooLow,
    SignalStrengthTooLow,
    EdgeAfterCostTooLow,
    AuditOnly,
    SizingCappedByInitialNotional,
    SizingCappedByGrossNotional,
    SizingCappedByMaxLoss,
    CandidateGenerated,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DryRunOrderCandidate {
    pub candidate_id: String,
    pub exchange: String,
    pub symbol: Symbol,
    pub direction: SignalDirection,
    pub reference_price: Price,
    pub notional: Decimal,
    pub margin_required: Decimal,
    pub leverage: Decimal,
    pub assumed_stop_distance_pct: Decimal,
    pub max_loss_usdt: Decimal,
    pub executable: bool,
    pub real_order_id: Option<String>,
    pub audit_only: bool,
    pub reasons: Vec<OrderCandidateReason>,
}

impl DryRunOrderCandidate {
    pub fn invariant_safe(&self) -> bool {
        !self.executable && self.real_order_id.is_none() && self.audit_only
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrderCandidateDecision {
    pub candidate_generated: bool,
    pub candidate: Option<DryRunOrderCandidate>,
    pub reasons: Vec<OrderCandidateReason>,
    pub signal_decision: SignalDecision,
    pub risk_decision: RiskBudgetDecision,
    pub sizing_config: CandidateSizingConfig,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MarketEventLevel {
    pub price: Decimal,
    pub quantity: Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MarketEvent {
    pub sequence: u64,
    pub timestamp_ms: u64,
    pub exchange: String,
    pub symbol: Symbol,
    pub mark_price: Decimal,
    pub index_price: Decimal,
    pub funding_rate: Decimal,
    pub open_interest: Decimal,
    pub bid_levels: Vec<MarketEventLevel>,
    pub ask_levels: Vec<MarketEventLevel>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SimulatedTrade {
    pub entry_sequence: u64,
    pub exit_sequence: u64,
    pub symbol: Symbol,
    pub direction: SignalDirection,
    pub entry_price: Decimal,
    pub exit_price: Decimal,
    pub notional: Decimal,
    pub gross_pnl_usdt: Decimal,
    pub fees_usdt: Decimal,
    pub net_pnl_usdt: Decimal,
    pub executable: bool,
    pub real_order_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReplayDecision {
    pub sequence: u64,
    pub signal_allowed: bool,
    pub risk_allowed: bool,
    pub candidate_generated: bool,
    pub simulated_trade: Option<SimulatedTrade>,
    pub rejected_by_signal: bool,
    pub rejected_by_risk: bool,
    pub rejected_by_cost: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BacktestReport {
    pub events_processed: u64,
    pub candidates_generated: u64,
    pub simulated_trades: u64,
    pub gross_pnl_usdt: Decimal,
    pub net_pnl_usdt: Decimal,
    pub total_fees_usdt: Decimal,
    pub max_drawdown_usdt: Decimal,
    pub win_rate: Decimal,
    pub profit_factor: Decimal,
    pub avg_net_pnl_per_trade: Decimal,
    pub median_net_pnl_per_trade: Decimal,
    pub max_win_usdt: Decimal,
    pub max_loss_usdt: Decimal,
    pub avg_fee_per_trade: Decimal,
    pub fee_to_gross_profit_ratio: Decimal,
    pub expectancy_usdt: Decimal,
    pub avg_r_multiple: Decimal,
    pub max_consecutive_losses: u64,
    pub rejection_breakdown_by_reason: BTreeMap<String, u64>,
    pub rejected_by_signal: u64,
    pub rejected_by_risk: u64,
    pub rejected_by_cost: u64,
    pub decisions: Vec<ReplayDecision>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BacktestConfig {
    pub exit_horizon_events: usize,
    pub starting_equity_usdt: Decimal,
}

impl Default for BacktestConfig {
    fn default() -> Self {
        Self {
            exit_horizon_events: 1,
            starting_equity_usdt: Decimal::from(200),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaperPosition {
    pub position_id: String,
    pub symbol: Symbol,
    pub direction: SignalDirection,
    pub entry_price: Decimal,
    pub mark_price: Decimal,
    pub notional: Decimal,
    pub quantity: Decimal,
    pub unrealized_pnl_usdt: Decimal,
    pub opened_at_tick: u64,
    pub candidate_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaperTrade {
    pub trade_id: String,
    pub tick_id: u64,
    pub timestamp_ms: u64,
    pub symbol: Symbol,
    pub direction: SignalDirection,
    pub price: Decimal,
    pub notional: Decimal,
    pub quantity: Decimal,
    pub fees_usdt: Decimal,
    pub realized_pnl_usdt: Decimal,
    pub executable: bool,
    pub real_order_id: Option<String>,
    pub candidate_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaperTick {
    pub tick_id: u64,
    pub timestamp_ms: u64,
    pub exchange: String,
    pub symbol: Symbol,
    pub mark_price: Decimal,
    pub signal_allowed: bool,
    pub risk_allowed: bool,
    pub candidate_generated: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaperEngineState {
    pub starting_equity_usdt: Decimal,
    pub account_equity_usdt: Decimal,
    pub realized_pnl_usdt: Decimal,
    pub unrealized_pnl_usdt: Decimal,
    pub total_fees_usdt: Decimal,
    pub ticks_processed: u64,
    pub trades_count: u64,
    pub positions: Vec<PaperPosition>,
    pub last_tick: Option<PaperTick>,
}

impl Default for PaperEngineState {
    fn default() -> Self {
        Self {
            starting_equity_usdt: Decimal::from(200),
            account_equity_usdt: Decimal::from(200),
            realized_pnl_usdt: Decimal::ZERO,
            unrealized_pnl_usdt: Decimal::ZERO,
            total_fees_usdt: Decimal::ZERO,
            ticks_processed: 0,
            trades_count: 0,
            positions: Vec::new(),
            last_tick: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaperRunConfig {
    pub ticks: u64,
    pub interval_seconds: u64,
    pub state_path: String,
    pub log_path: String,
}

impl Default for PaperRunConfig {
    fn default() -> Self {
        Self {
            ticks: 10,
            interval_seconds: 15,
            state_path: "data/paper/paper_state.json".to_string(),
            log_path: "data/paper/paper_trades.jsonl".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaperRunReport {
    pub ticks_requested: u64,
    pub ticks_processed: u64,
    pub fills_generated: u64,
    pub rejected_candidates: u64,
    pub open_positions: u64,
    pub state_path: String,
    pub log_path: String,
    pub final_state: PaperEngineState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaperSoakConfig {
    pub ticks: u64,
    pub interval_seconds: u64,
    pub state_path: String,
    pub log_path: String,
    pub report_path: Option<String>,
    pub candidate_warning_ratio: Decimal,
    pub candidate_blocker_ratio: Decimal,
}

impl Default for PaperSoakConfig {
    fn default() -> Self {
        Self {
            ticks: 240,
            interval_seconds: 15,
            state_path: "data/paper/paper_state.json".to_string(),
            log_path: "data/paper/paper_trades.jsonl".to_string(),
            report_path: None,
            candidate_warning_ratio: Decimal::new(25, 2),
            candidate_blocker_ratio: Decimal::new(5, 1),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaperSoakWarning {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaperSoakBlocker {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaperSoakReport {
    pub ticks_requested: u64,
    pub ticks_processed: u64,
    pub state_valid: bool,
    pub paper_log_valid: bool,
    pub duplicate_positions_count: u64,
    pub candidate_decisions_evaluated: u64,
    pub candidate_generated_count: u64,
    pub min_ticks_for_candidate_pressure_blocker: u64,
    pub paper_trades_count: u64,
    pub open_positions_count: u64,
    pub realized_pnl_usdt: Decimal,
    pub unrealized_pnl_usdt: Decimal,
    pub errors_count: u64,
    pub signal_grade_distribution: BTreeMap<String, u64>,
    pub signal_direction_distribution: BTreeMap<String, u64>,
    pub rejection_breakdown_by_reason: BTreeMap<String, u64>,
    pub candidate_pressure_ratio: Decimal,
    pub avg_signal_strength: Decimal,
    pub max_signal_strength: Decimal,
    pub avg_edge_after_cost_ratio: Option<Decimal>,
    pub state_mutation_count: u64,
    pub paper_equity_start: Decimal,
    pub paper_equity_end: Decimal,
    pub paper_equity_drift: Decimal,
    pub duration_seconds: u64,
    pub ticks_per_minute: Decimal,
    pub warnings: Vec<PaperSoakWarning>,
    pub blockers: Vec<PaperSoakBlocker>,
    pub soak_passed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaperSoakMetricDelta {
    pub metric: String,
    pub baseline: String,
    pub candidate: String,
    pub delta: Option<Decimal>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaperSoakComparisonWarning {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaperSoakComparisonBlocker {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaperSoakComparisonReport {
    pub baseline_path: String,
    pub candidate_path: String,
    pub comparison_passed: bool,
    pub metric_deltas: Vec<PaperSoakMetricDelta>,
    pub rejection_breakdown_delta: BTreeMap<String, i64>,
    pub signal_grade_distribution_delta: BTreeMap<String, i64>,
    pub signal_direction_distribution_delta: BTreeMap<String, i64>,
    pub warnings: Vec<PaperSoakComparisonWarning>,
    pub blockers: Vec<PaperSoakComparisonBlocker>,
    pub summary: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CanaryCheckStatus {
    Pass,
    Warn,
    Fail,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CanaryBlocker {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CanaryCheckResult {
    pub name: String,
    pub status: CanaryCheckStatus,
    pub blockers: Vec<CanaryBlocker>,
    pub warnings: Vec<String>,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CanaryReadinessConfig {
    pub manual_live_gate_present: bool,
    pub live_orders_enabled: bool,
    pub withdrawal_enabled: bool,
    pub max_allowed_leverage: Decimal,
    pub workspace_root: String,
    pub source_scan_paths: Vec<String>,
}

impl Default for CanaryReadinessConfig {
    fn default() -> Self {
        Self {
            manual_live_gate_present: false,
            live_orders_enabled: false,
            withdrawal_enabled: false,
            max_allowed_leverage: Decimal::from(5),
            workspace_root: ".".to_string(),
            source_scan_paths: vec![
                "crates/backtest/src".to_string(),
                "crates/cost_engine/src".to_string(),
                "crates/domain/src".to_string(),
                "crates/exchange/src".to_string(),
                "crates/execution_engine/src".to_string(),
                "crates/feature_engine/src".to_string(),
                "crates/market_data/src".to_string(),
                "crates/paper_engine/src".to_string(),
                "crates/risk_engine/src".to_string(),
                "crates/signal_engine/src".to_string(),
                "crates/state_engine/src".to_string(),
                "crates/withdrawal_engine/src".to_string(),
                "crates/cli/src".to_string(),
            ],
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CanaryReadinessReport {
    pub ready: bool,
    pub checks: Vec<CanaryCheckResult>,
    pub blockers: Vec<CanaryBlocker>,
    pub warnings: Vec<String>,
    pub summary: String,
    pub live_trading_allowed: bool,
    pub executable_order_capability: bool,
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
pub struct OrderBookLevel {
    pub price: Price,
    pub quantity: Quantity,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrderBook {
    pub symbol: Symbol,
    pub bid: Price,
    pub ask: Price,
    pub bid_quantity: Quantity,
    pub ask_quantity: Quantity,
    pub bids: Vec<OrderBookLevel>,
    pub asks: Vec<OrderBookLevel>,
}

impl OrderBook {
    pub fn from_levels(
        symbol: Symbol,
        bids: Vec<OrderBookLevel>,
        asks: Vec<OrderBookLevel>,
    ) -> AppResult<Self> {
        let best_bid = bids.first().ok_or_else(|| AppError::ResponseParse {
            exchange: "domain".to_string(),
            endpoint: "orderbook".to_string(),
            reason: "missing bid levels".to_string(),
        })?;
        let best_ask = asks.first().ok_or_else(|| AppError::ResponseParse {
            exchange: "domain".to_string(),
            endpoint: "orderbook".to_string(),
            reason: "missing ask levels".to_string(),
        })?;

        Ok(Self {
            symbol,
            bid: best_bid.price,
            ask: best_ask.price,
            bid_quantity: best_bid.quantity,
            ask_quantity: best_ask.quantity,
            bids,
            asks,
        })
    }

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FundingRegime {
    StronglyNegative,
    Negative,
    Neutral,
    Positive,
    StronglyPositive,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LiquidityMetrics {
    pub spread_bps: Decimal,
    pub bid_depth_5bps: Decimal,
    pub ask_depth_5bps: Decimal,
    pub bid_depth_10bps: Decimal,
    pub ask_depth_10bps: Decimal,
    pub imbalance: Decimal,
    pub liquidity_score: Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CostEstimate {
    pub round_trip_fee_bps: Decimal,
    pub spread_bps: Decimal,
    pub slippage_bps: Decimal,
    pub estimated_total_cost_bps: Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FeatureSnapshot {
    pub exchange: String,
    pub symbol: Symbol,
    pub mark_price: Price,
    pub index_price: Price,
    pub premium: Decimal,
    pub premium_bps: Decimal,
    pub funding_rate: Decimal,
    pub funding_regime: FundingRegime,
    pub open_interest: Quantity,
    pub liquidity: LiquidityMetrics,
    pub cost: CostEstimate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SignalDirection {
    Long,
    Short,
    Neutral,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MarketRegime {
    CrowdedLong,
    CrowdedShort,
    PositivePremium,
    NegativePremium,
    Neutral,
    Illiquid,
    HighCost,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SignalGrade {
    APlus,
    A,
    B,
    C,
    D,
    F,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DecisionReason {
    ResearchOnlyMode,
    HighCost,
    LowLiquidity,
    NeutralSignal,
    InsufficientStrength,
    CrowdedLong,
    CrowdedShort,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SignalPacket {
    pub exchange: String,
    pub symbol: Symbol,
    pub direction: SignalDirection,
    pub market_regime: MarketRegime,
    pub price_structure_score: Decimal,
    pub derivatives_score: Decimal,
    pub funding_score: Decimal,
    pub liquidity_score: Decimal,
    pub cost_score: Decimal,
    pub final_strength: Decimal,
    pub grade: SignalGrade,
    pub reasons: Vec<DecisionReason>,
}

impl SignalPacket {
    pub fn is_tradeable(&self) -> bool {
        false
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SignalDecision {
    pub packet: SignalPacket,
    pub signal_allowed: bool,
    pub trade_allowed: bool,
    pub reasons: Vec<DecisionReason>,
    pub summary: String,
}

#[cfg(test)]
mod tests {
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn phase_three_signal_packet_is_never_tradeable() {
        let packet = SignalPacket {
            exchange: "test".to_string(),
            symbol: Symbol::new("btcusdt").unwrap(),
            direction: SignalDirection::Long,
            market_regime: MarketRegime::PositivePremium,
            price_structure_score: dec!(100),
            derivatives_score: dec!(100),
            funding_score: dec!(100),
            liquidity_score: dec!(100),
            cost_score: dec!(100),
            final_strength: dec!(100),
            grade: SignalGrade::APlus,
            reasons: vec![DecisionReason::ResearchOnlyMode],
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
