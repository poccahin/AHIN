#![forbid(unsafe_code)]

use std::{
    future::Future,
    path::PathBuf,
    time::{Duration, Instant},
};

use backtest::{event_loader, event_replay};
use canary_engine::{
    live_micro::{self, LiveMicroReadinessInputs},
    readiness::{self, CanaryReadinessInputs},
    release_audit,
};
use clap::{Args, Parser, Subcommand, ValueEnum};
use cost_engine::{edge_after_cost, fee_model};
use domain::{
    AccountRiskState, AppError, AppResult, BacktestConfig, CandidateSizingConfig, EngineConfig,
    FeatureSnapshot, FeatureWindow, FundingRate, GodTurnpointConfig, Leverage, Notional,
    OpenInterest, OrderBook, OrderRequest, PaperSoakEndpointErrorReason, PaperSoakRetryConfig,
    Price, Quantity, RiskBudget, RiskBudgetConfig, Side, Symbol,
};
use exchange::{BinanceReadonly, ExchangeAdapter, MockExchange};
use execution_engine::{candidate_decision, dry_run_router, order_candidate};
use feature_engine::snapshot;
use iching_engine::evaluate_god_turnpoint;
use paper_engine::{paper_loop, paper_report, paper_soak, paper_state, report_compare};
use risk_engine::{risk_budget, risk_decision, tail_event_simulator};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde_json::{Value, json};
use signal_engine::signal_decision;
use state_engine::{EngineState, ReconciliationOutcome, reconcile_positions};

#[derive(Debug, Parser)]
#[command(name = "convex-evergreen-cli")]
#[command(about = "Research-only derivatives-aware convex signal engine CLI")]
struct Cli {
    #[arg(long, default_value = "config/default.toml")]
    config: PathBuf,

    #[arg(long, hide = true, global = true)]
    binance_base_url: Option<String>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    HealthCheck,
    Market {
        #[command(subcommand)]
        command: MarketCommand,
    },
    Features {
        #[command(subcommand)]
        command: FeaturesCommand,
    },
    Signal {
        #[command(subcommand)]
        command: SignalCommand,
    },
    Yi {
        #[command(subcommand)]
        command: YiCommand,
    },
    GodSignal {
        #[command(subcommand)]
        command: GodSignalCommand,
    },
    Risk {
        #[command(subcommand)]
        command: RiskCommand,
    },
    OrderCandidate {
        #[command(subcommand)]
        command: OrderCandidateCommand,
    },
    Backtest {
        #[command(subcommand)]
        command: BacktestCommand,
    },
    Paper {
        #[command(subcommand)]
        command: PaperCommand,
    },
    Canary {
        #[command(subcommand)]
        command: CanaryCommand,
    },
    LiveMicro {
        #[command(subcommand)]
        command: LiveMicroCommand,
    },
    Release {
        #[command(subcommand)]
        command: ReleaseCommand,
    },
}

#[derive(Debug, Subcommand)]
enum MarketCommand {
    Snapshot(MarketArgs),
    Funding(MarketArgs),
    MarkPrice(MarketArgs),
    OpenInterest(MarketArgs),
    Orderbook(OrderbookArgs),
}

#[derive(Debug, Subcommand)]
enum FeaturesCommand {
    Snapshot(FeatureSnapshotArgs),
}

#[derive(Debug, Subcommand)]
enum SignalCommand {
    Evaluate(FeatureSnapshotArgs),
}

#[derive(Debug, Subcommand)]
enum YiCommand {
    Evaluate(FeatureSnapshotArgs),
}

#[derive(Debug, Subcommand)]
enum GodSignalCommand {
    Evaluate(FeatureSnapshotArgs),
}

#[derive(Debug, Subcommand)]
enum RiskCommand {
    Evaluate(FeatureSnapshotArgs),
}

#[derive(Debug, Subcommand)]
enum OrderCandidateCommand {
    DryRun(FeatureSnapshotArgs),
}

#[derive(Debug, Subcommand)]
enum BacktestCommand {
    Replay(BacktestReplayArgs),
}

#[derive(Debug, Subcommand)]
enum PaperCommand {
    Run(PaperRunArgs),
    Soak(PaperSoakArgs),
    CompareReports(PaperCompareReportsArgs),
}

#[derive(Debug, Subcommand)]
enum CanaryCommand {
    Readiness(CanaryReadinessArgs),
}

#[derive(Debug, Subcommand)]
enum LiveMicroCommand {
    Readiness,
}

#[derive(Debug, Subcommand)]
enum ReleaseCommand {
    Audit(ReleaseAuditArgs),
}

#[derive(Debug, Args)]
struct MarketArgs {
    #[arg(long, value_enum)]
    exchange: ExchangeName,

    #[arg(long)]
    symbol: String,
}

#[derive(Debug, Args)]
struct OrderbookArgs {
    #[arg(long, value_enum)]
    exchange: ExchangeName,

    #[arg(long)]
    symbol: String,

    #[arg(long, default_value_t = 20)]
    depth: u16,
}

#[derive(Debug, Args)]
struct FeatureSnapshotArgs {
    #[arg(long, value_enum)]
    exchange: ExchangeName,

    #[arg(long)]
    symbol: String,

    #[arg(long, default_value_t = 100)]
    depth: u16,
}

#[derive(Debug, Args)]
struct BacktestReplayArgs {
    #[arg(long)]
    input: PathBuf,
}

#[derive(Debug, Args)]
struct PaperRunArgs {
    #[arg(long, value_enum)]
    exchange: ExchangeName,

    #[arg(long)]
    symbol: String,

    #[arg(long, default_value_t = 100)]
    depth: u16,

    #[arg(long, default_value_t = 10)]
    ticks: u64,

    #[arg(long, default_value_t = 15)]
    interval_seconds: u64,

    #[arg(long)]
    state_path: Option<PathBuf>,

    #[arg(long)]
    log_path: Option<PathBuf>,
}

#[derive(Debug, Args)]
struct PaperSoakArgs {
    #[arg(long, value_enum)]
    exchange: ExchangeName,

    #[arg(long)]
    symbol: String,

    #[arg(long, default_value_t = 100)]
    depth: u16,

    #[arg(long, default_value_t = 240)]
    ticks: u64,

    #[arg(long, default_value_t = 15)]
    interval_seconds: u64,

    #[arg(long)]
    state_path: Option<PathBuf>,

    #[arg(long)]
    log_path: Option<PathBuf>,

    #[arg(long)]
    report_path: Option<PathBuf>,
}

#[derive(Debug, Args)]
struct PaperCompareReportsArgs {
    #[arg(long)]
    baseline: PathBuf,

    #[arg(long)]
    candidate: PathBuf,
}

#[derive(Debug, Args)]
struct CanaryReadinessArgs {
    #[arg(long)]
    paper_state: PathBuf,

    #[arg(long)]
    paper_log: PathBuf,

    #[arg(long)]
    backtest_input: PathBuf,
}

#[derive(Debug, Args)]
struct ReleaseAuditArgs {
    #[arg(long)]
    backtest_input: PathBuf,

    #[arg(long)]
    paper_state: PathBuf,

    #[arg(long)]
    paper_log: PathBuf,

    #[arg(long)]
    soak_report: PathBuf,

    #[arg(long)]
    output: PathBuf,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum ExchangeName {
    Binance,
}

#[tokio::main]
async fn main() {
    if let Err(err) = run().await {
        eprintln!("cli: FAILED: {err}");
        std::process::exit(1);
    }
}

async fn run() -> AppResult<()> {
    let Cli {
        config,
        binance_base_url,
        command,
    } = Cli::parse();

    match command {
        Command::HealthCheck => health_check(config).await,
        Command::Market { command } => market(config, binance_base_url, command).await,
        Command::Features { command } => features(config, binance_base_url, command).await,
        Command::Signal { command } => signal(config, binance_base_url, command).await,
        Command::Yi { command } => yi_cli(config, binance_base_url, command).await,
        Command::GodSignal { command } => god_signal_cli(config, binance_base_url, command).await,
        Command::Risk { command } => risk(config, binance_base_url, command).await,
        Command::OrderCandidate { command } => {
            order_candidate_cli(config, binance_base_url, command).await
        }
        Command::Backtest { command } => backtest_cli(config, command).await,
        Command::Paper { command } => paper_cli(config, binance_base_url, command).await,
        Command::Canary { command } => canary_cli(config, command).await,
        Command::LiveMicro { command } => live_micro_cli(config, command).await,
        Command::Release { command } => release_cli(config, command).await,
    }
}

async fn health_check(config_path: PathBuf) -> AppResult<()> {
    let config = EngineConfig::load_from_path(&config_path)?;
    config.validate_safety()?;

    let adapter = MockExchange::default();
    let exchange_info = adapter.fetch_exchange_info().await?;
    let positions = adapter.fetch_positions().await?;

    let mut state = EngineState::default();
    let reconciliation = reconcile_positions(&mut state, &positions);
    if reconciliation != ReconciliationOutcome::Matched {
        return Err(domain::AppError::Reconciliation(
            "fresh default state should match mock exchange".to_string(),
        ));
    }

    let price = Price::new(dec!(100))?;
    let quantity = Quantity::new(config.safety.max_order_notional / Decimal::from(100))?;
    let request = OrderRequest {
        symbol: Symbol::new(&config.symbols[0])?,
        side: Side::Buy,
        price,
        quantity,
        leverage: Leverage::with_cap(config.safety.max_leverage, Decimal::from(5))?,
        reduce_only: false,
        client_order_id: "health-check".to_string(),
    };

    let candidate = dry_run_router::route_dry_run_order(&adapter, request).await?;
    order_candidate::ensure_candidate_is_not_live(&candidate)?;

    let budget = RiskBudget {
        equity: Notional::new(config.account.starting_equity)?,
        risk_reserve: Notional::new(config.account.risk_reserve)?,
        max_gross_notional: Notional::new(
            config.account.starting_equity - config.account.risk_reserve,
        )?,
        max_position_notional: Notional::new(config.safety.max_order_notional)?,
        max_daily_loss: Notional::new(dec!(10))?,
        max_leverage: exchange_info.max_leverage,
    };
    risk_budget::ensure_order_within_budget(&candidate, &budget)?;

    fee_model::ensure_cost_attrition_safe(config.account.starting_equity, dec!(0.02), dec!(0.01))?;
    let edge = edge_after_cost::edge_after_cost_bps(dec!(15), dec!(4), dec!(3), dec!(2));
    edge_after_cost::ensure_positive_edge_after_cost(edge)?;

    let scenario = tail_event_simulator::TailScenario {
        name: "health-check flash move".to_string(),
        shock_pct: dec!(0.30),
    };
    tail_event_simulator::ensure_survives_tail_event(
        config.account.starting_equity,
        config.account.risk_reserve,
        candidate.notional.as_decimal(),
        &scenario,
    )?;

    println!(
        "health-check: OK research-only dry-run ready; symbols={}, live_trading=false, max_leverage={}x",
        config.symbols.join(","),
        config.safety.max_leverage
    );
    Ok(())
}

async fn market(
    config_path: PathBuf,
    binance_base_url: Option<String>,
    command: MarketCommand,
) -> AppResult<()> {
    let config = EngineConfig::load_from_path(config_path)?;
    config.validate_safety()?;

    match command {
        MarketCommand::Snapshot(args) => {
            let adapter = market_adapter(args.exchange, binance_base_url.as_deref())?;
            let symbol = Symbol::new(&args.symbol)?;
            let exchange_info = adapter.fetch_exchange_info().await?;
            let mark_price = adapter.fetch_mark_price(&args.symbol).await?;
            let funding = adapter.fetch_funding_rate(&args.symbol).await?;
            let open_interest = adapter.fetch_open_interest(&args.symbol).await?;
            let orderbook = adapter.fetch_orderbook_depth(&args.symbol, 20).await?;

            print_json(json!({
                "exchange": "binance",
                "symbol": symbol.as_str(),
                "listed": exchange_info.symbols.iter().any(|listed_symbol| listed_symbol.as_str() == symbol.as_str()),
                "min_notional": exchange_info.min_notional.as_decimal().to_string(),
                "max_leverage_cap": exchange_info.max_leverage.as_decimal().to_string(),
                "mark_price": mark_price.as_decimal().to_string(),
                "funding_rate": funding.rate.to_string(),
                "funding_interval_hours": funding.interval_hours,
                "open_interest": open_interest.quantity.as_decimal().to_string(),
                "best_bid": orderbook.bid.as_decimal().to_string(),
                "best_ask": orderbook.ask.as_decimal().to_string(),
                "spread_bps": orderbook.spread_bps().to_string(),
                "orderbook_depth": {
                    "bids": orderbook.bids.len(),
                    "asks": orderbook.asks.len()
                }
            }))
        }
        MarketCommand::Funding(args) => {
            let adapter = market_adapter(args.exchange, binance_base_url.as_deref())?;
            let funding = adapter.fetch_funding_rate(&args.symbol).await?;
            print_json(json!({
                "exchange": "binance",
                "symbol": funding.symbol.as_str(),
                "funding_rate": funding.rate.to_string(),
                "interval_hours": funding.interval_hours
            }))
        }
        MarketCommand::MarkPrice(args) => {
            let adapter = market_adapter(args.exchange, binance_base_url.as_deref())?;
            let symbol = Symbol::new(&args.symbol)?;
            let price = adapter.fetch_mark_price(&args.symbol).await?;
            print_json(json!({
                "exchange": "binance",
                "symbol": symbol.as_str(),
                "mark_price": price.as_decimal().to_string()
            }))
        }
        MarketCommand::OpenInterest(args) => {
            let adapter = market_adapter(args.exchange, binance_base_url.as_deref())?;
            let open_interest = adapter.fetch_open_interest(&args.symbol).await?;
            print_json(json!({
                "exchange": "binance",
                "symbol": open_interest.symbol.as_str(),
                "open_interest": open_interest.quantity.as_decimal().to_string()
            }))
        }
        MarketCommand::Orderbook(args) => {
            let adapter = market_adapter(args.exchange, binance_base_url.as_deref())?;
            let orderbook = adapter
                .fetch_orderbook_depth(&args.symbol, args.depth)
                .await?;
            print_json(json!({
                "exchange": "binance",
                "symbol": orderbook.symbol.as_str(),
                "depth": args.depth,
                "best_bid": orderbook.bid.as_decimal().to_string(),
                "best_ask": orderbook.ask.as_decimal().to_string(),
                "spread_bps": orderbook.spread_bps().to_string(),
                "bids": levels_to_json(&orderbook.bids),
                "asks": levels_to_json(&orderbook.asks)
            }))
        }
    }
}

async fn features(
    config_path: PathBuf,
    binance_base_url: Option<String>,
    command: FeaturesCommand,
) -> AppResult<()> {
    let config = EngineConfig::load_from_path(config_path)?;
    config.validate_safety()?;

    match command {
        FeaturesCommand::Snapshot(args) => {
            let feature_snapshot =
                fetch_feature_snapshot(args, binance_base_url.as_deref()).await?;

            print_feature_snapshot(&feature_snapshot)
        }
    }
}

async fn signal(
    config_path: PathBuf,
    binance_base_url: Option<String>,
    command: SignalCommand,
) -> AppResult<()> {
    let config = EngineConfig::load_from_path(config_path)?;
    config.validate_safety()?;

    match command {
        SignalCommand::Evaluate(args) => {
            let feature_snapshot =
                fetch_feature_snapshot(args, binance_base_url.as_deref()).await?;
            let decision = signal_decision::evaluate_snapshot(&feature_snapshot);
            print_json(serde_json::to_value(decision).map_err(|err| {
                domain::AppError::Config(format!("failed to render signal decision: {err}"))
            })?)
        }
    }
}

async fn risk(
    config_path: PathBuf,
    binance_base_url: Option<String>,
    command: RiskCommand,
) -> AppResult<()> {
    let config = EngineConfig::load_from_path(config_path)?;
    config.validate_safety()?;

    match command {
        RiskCommand::Evaluate(args) => {
            let feature_snapshot =
                fetch_feature_snapshot(args, binance_base_url.as_deref()).await?;
            let signal_decision = signal_decision::evaluate_snapshot(&feature_snapshot);
            let risk_decision = risk_decision::evaluate_risk_budget(
                signal_decision,
                AccountRiskState::default(),
                RiskBudgetConfig::default(),
            );
            print_json(serde_json::to_value(risk_decision).map_err(|err| {
                domain::AppError::Config(format!("failed to render risk decision: {err}"))
            })?)
        }
    }
}

async fn yi_cli(
    config_path: PathBuf,
    binance_base_url: Option<String>,
    command: YiCommand,
) -> AppResult<()> {
    let config = EngineConfig::load_from_path(config_path)?;
    config.validate_safety()?;

    match command {
        YiCommand::Evaluate(args) => {
            let feature_snapshot =
                fetch_feature_snapshot(args, binance_base_url.as_deref()).await?;
            let decision = evaluate_god_turnpoint_from_snapshot(&feature_snapshot);
            print_json(json!({
                "symbol": decision.symbol.as_str(),
                "yi_state": decision.yi_state,
                "action_bias": decision.action_bias,
                "hexagram": decision.hexagram,
                "turnpoint_evidence": decision.turnpoint_evidence,
                "god_turnpoint_allowed": decision.god_turnpoint_allowed,
                "edge_after_cost_ratio": decision.edge_after_cost_ratio.to_string(),
                "data_freshness_score": decision.data_freshness_score.to_string(),
                "degraded_market_data": decision.degraded_market_data,
                "blockers": decision.blockers,
                "warnings": decision.warnings,
                "reasons": decision.reasons,
                "explanation": decision.explanation,
            }))
        }
    }
}

async fn god_signal_cli(
    config_path: PathBuf,
    binance_base_url: Option<String>,
    command: GodSignalCommand,
) -> AppResult<()> {
    let config = EngineConfig::load_from_path(config_path)?;
    config.validate_safety()?;

    match command {
        GodSignalCommand::Evaluate(args) => {
            let feature_snapshot =
                fetch_feature_snapshot(args, binance_base_url.as_deref()).await?;
            let decision = evaluate_god_turnpoint_from_snapshot(&feature_snapshot);
            print_json(serde_json::to_value(decision).map_err(|err| {
                domain::AppError::Config(format!("failed to render god turnpoint decision: {err}"))
            })?)
        }
    }
}

async fn order_candidate_cli(
    config_path: PathBuf,
    binance_base_url: Option<String>,
    command: OrderCandidateCommand,
) -> AppResult<()> {
    let config = EngineConfig::load_from_path(config_path)?;
    config.validate_safety()?;

    match command {
        OrderCandidateCommand::DryRun(args) => {
            let feature_snapshot =
                fetch_feature_snapshot(args, binance_base_url.as_deref()).await?;
            let signal_decision = signal_decision::evaluate_snapshot(&feature_snapshot);
            let risk_decision = risk_decision::evaluate_risk_budget(
                signal_decision.clone(),
                AccountRiskState::default(),
                RiskBudgetConfig::default(),
            );
            let candidate_decision = candidate_decision::evaluate_order_candidate(
                &feature_snapshot,
                signal_decision,
                risk_decision,
                CandidateSizingConfig::default(),
            );
            print_json(serde_json::to_value(candidate_decision).map_err(|err| {
                domain::AppError::Config(format!(
                    "failed to render order candidate decision: {err}"
                ))
            })?)
        }
    }
}

async fn backtest_cli(config_path: PathBuf, command: BacktestCommand) -> AppResult<()> {
    let config = EngineConfig::load_from_path(config_path)?;
    config.validate_safety()?;

    match command {
        BacktestCommand::Replay(args) => {
            let events = event_loader::load_jsonl_events(&args.input)?;
            let report = event_replay::replay_events(&events, &BacktestConfig::default())?;
            print_json(serde_json::to_value(report).map_err(|err| {
                domain::AppError::Config(format!("failed to render backtest report: {err}"))
            })?)
        }
    }
}

async fn paper_cli(
    config_path: PathBuf,
    binance_base_url: Option<String>,
    command: PaperCommand,
) -> AppResult<()> {
    match command {
        PaperCommand::Run(args) => {
            let config = EngineConfig::load_from_path(config_path)?;
            config.validate_safety()?;
            let defaults = domain::PaperRunConfig::default();
            let run_config = domain::PaperRunConfig {
                ticks: args.ticks,
                interval_seconds: args.interval_seconds,
                state_path: args
                    .state_path
                    .unwrap_or_else(|| PathBuf::from(defaults.state_path))
                    .display()
                    .to_string(),
                log_path: args
                    .log_path
                    .unwrap_or_else(|| PathBuf::from(defaults.log_path))
                    .display()
                    .to_string(),
            };
            paper_state::ensure_local_file_path(std::path::Path::new(&run_config.state_path))?;
            paper_state::ensure_local_file_path(std::path::Path::new(&run_config.log_path))?;

            let mut state = paper_state::load_or_default(&run_config.state_path)?;
            paper_state::ensure_trade_log(&run_config.log_path)?;
            let mut ticks_processed = 0;
            let mut fills_generated = 0;
            let mut rejected_candidates = 0;

            for tick_idx in 0..run_config.ticks {
                let feature_snapshot = fetch_feature_snapshot(
                    FeatureSnapshotArgs {
                        exchange: args.exchange,
                        symbol: args.symbol.clone(),
                        depth: args.depth,
                    },
                    binance_base_url.as_deref(),
                )
                .await?;
                let outcome = paper_loop::process_snapshot(&mut state, &feature_snapshot)?;
                ticks_processed += 1;

                if let Some(trade) = &outcome.trade {
                    paper_state::append_trade(&run_config.log_path, trade)?;
                    fills_generated += 1;
                } else {
                    rejected_candidates += 1;
                }
                paper_state::persist_state(&run_config.state_path, &state)?;

                if tick_idx + 1 < run_config.ticks && run_config.interval_seconds > 0 {
                    tokio::time::sleep(std::time::Duration::from_secs(run_config.interval_seconds))
                        .await;
                }
            }

            let report = paper_report::build_report(
                &run_config,
                state,
                ticks_processed,
                fills_generated,
                rejected_candidates,
            );
            print_json(serde_json::to_value(report).map_err(|err| {
                domain::AppError::Config(format!("failed to render paper run report: {err}"))
            })?)
        }
        PaperCommand::Soak(args) => {
            let config = EngineConfig::load_from_path(config_path)?;
            config.validate_safety()?;
            let defaults = domain::PaperSoakConfig::default();
            let default_state_path = PathBuf::from(defaults.state_path.clone());
            let default_log_path = PathBuf::from(defaults.log_path.clone());
            let soak_config = domain::PaperSoakConfig {
                ticks: args.ticks,
                interval_seconds: args.interval_seconds,
                state_path: args
                    .state_path
                    .unwrap_or(default_state_path)
                    .display()
                    .to_string(),
                log_path: args
                    .log_path
                    .unwrap_or(default_log_path)
                    .display()
                    .to_string(),
                report_path: args.report_path.map(|path| path.display().to_string()),
                ..defaults
            };
            paper_state::ensure_local_file_path(std::path::Path::new(&soak_config.state_path))?;
            paper_state::ensure_local_file_path(std::path::Path::new(&soak_config.log_path))?;

            let mut state = paper_state::load_or_default(&soak_config.state_path)?;
            paper_state::ensure_trade_log(&soak_config.log_path)?;
            paper_state::persist_state(&soak_config.state_path, &state)?;
            let started_at = Instant::now();
            let mut metrics = paper_engine::soak_report::PaperSoakRunMetrics {
                paper_equity_start: state.account_equity_usdt,
                paper_equity_end: state.account_equity_usdt,
                ..Default::default()
            };
            let mut ticks_processed = 0;
            let mut candidate_generated_count = 0;
            let mut errors_count = 0;
            let adapter = market_adapter(args.exchange, binance_base_url.as_deref())?;
            let symbol = Symbol::new(&args.symbol)?;
            let retry_config = PaperSoakRetryConfig::default();
            let mut market_data_cache = PaperSoakMarketDataCache::default();
            let god_config = GodTurnpointConfig::default();
            let mut feature_window = FeatureWindow::new(god_config.feature_window_len);

            for tick_idx in 0..soak_config.ticks {
                let before = paper_soak::StateStructuralFingerprint::from_state(&state);
                let feature_snapshot_result = tokio::time::timeout(
                    Duration::from_millis(retry_config.tick_max_duration_ms),
                    fetch_resilient_feature_snapshot(
                        &adapter,
                        &symbol,
                        args.depth,
                        &retry_config,
                        &mut market_data_cache,
                    ),
                )
                .await;

                match feature_snapshot_result {
                    Ok(Ok(resilient_snapshot)) => {
                        record_endpoint_errors_for_tick(
                            &mut metrics,
                            tick_idx,
                            &resilient_snapshot.endpoint_errors,
                        );
                        record_resilient_market_data_counts(&mut metrics, &resilient_snapshot);
                        if resilient_snapshot.stale_fallback_count > 0 {
                            metrics.record_stale_market_data_tick(
                                resilient_snapshot.stale_fallback_count,
                                resilient_snapshot.max_stale_age_seconds,
                            );
                        } else {
                            metrics.record_fresh_market_data_tick();
                        }
                        if resilient_snapshot.degraded_market_data {
                            let (
                                signal_decision,
                                risk_decision,
                                god_turnpoint_decision,
                                candidate_decision,
                            ) = paper_loop::evaluate_snapshot_decisions(
                                &state,
                                &resilient_snapshot.snapshot,
                                &mut feature_window,
                                true,
                                resilient_snapshot.data_freshness_score(),
                            );
                            ticks_processed += 1;
                            metrics.record_decision(
                                paper_engine::soak_report::PaperSoakDecisionInput {
                                    signal_decision: &signal_decision,
                                    risk_decision: &risk_decision,
                                    god_turnpoint_decision: Some(&god_turnpoint_decision),
                                    candidate_decision: &candidate_decision,
                                    edge_after_cost_ratio: Some(
                                        god_turnpoint_decision.edge_after_cost_ratio,
                                    ),
                                    paper_fill_generated: false,
                                    state_mutated: false,
                                    state_mutated_without_candidate_or_fill: false,
                                    degraded_market_data: true,
                                },
                            );
                        } else {
                            match paper_loop::process_snapshot_with_yi(
                                &mut state,
                                &resilient_snapshot.snapshot,
                                &mut feature_window,
                                false,
                                resilient_snapshot.data_freshness_score(),
                            ) {
                                Ok(outcome) => {
                                    ticks_processed += 1;
                                    let safe_candidate_generated =
                                        paper_engine::soak_report::is_audit_only_candidate_generated(
                                            &outcome.candidate_decision,
                                        );
                                    if safe_candidate_generated {
                                        candidate_generated_count += 1;
                                    }
                                    if let Some(trade) = &outcome.trade
                                        && let Err(err) =
                                            paper_state::append_trade(&soak_config.log_path, trade)
                                    {
                                        errors_count += 1;
                                        metrics.record_loop_error(
                                            paper_engine::soak_report::PaperSoakLoopErrorInput {
                                                reason: domain::PaperSoakErrorReason::StatePersistenceError,
                                                message: err.to_string(),
                                                state_mutated: before
                                                    != paper_soak::StateStructuralFingerprint::from_state(&state),
                                            },
                                        );
                                    }
                                    if let Err(err) =
                                        paper_state::persist_state(&soak_config.state_path, &state)
                                    {
                                        errors_count += 1;
                                        metrics.record_loop_error(
                                            paper_engine::soak_report::PaperSoakLoopErrorInput {
                                                reason: domain::PaperSoakErrorReason::StatePersistenceError,
                                                message: err.to_string(),
                                                state_mutated: before
                                                    != paper_soak::StateStructuralFingerprint::from_state(&state),
                                            },
                                        );
                                    }
                                    let state_mutated = before
                                        != paper_soak::StateStructuralFingerprint::from_state(
                                            &state,
                                        );
                                    let state_mutated_without_candidate_or_fill = state_mutated
                                        && !safe_candidate_generated
                                        && outcome.trade.is_none();
                                    metrics.record_decision(
                                        paper_engine::soak_report::PaperSoakDecisionInput {
                                            signal_decision: &outcome.signal_decision,
                                            risk_decision: &outcome.risk_decision,
                                            god_turnpoint_decision: Some(
                                                &outcome.god_turnpoint_decision,
                                            ),
                                            candidate_decision: &outcome.candidate_decision,
                                            edge_after_cost_ratio: Some(
                                                outcome
                                                    .god_turnpoint_decision
                                                    .edge_after_cost_ratio,
                                            ),
                                            paper_fill_generated: outcome.trade.is_some(),
                                            state_mutated,
                                            state_mutated_without_candidate_or_fill,
                                            degraded_market_data: false,
                                        },
                                    );
                                }
                                Err(err) => {
                                    errors_count += 1;
                                    metrics.record_loop_error(
                                        paper_engine::soak_report::PaperSoakLoopErrorInput {
                                            reason: paper_engine::soak_report::classify_loop_error(
                                                &err,
                                            ),
                                            message: err.to_string(),
                                            state_mutated: before
                                                != paper_soak::StateStructuralFingerprint::from_state(
                                                    &state,
                                                ),
                                        },
                                    );
                                }
                            }
                        }
                    }
                    Ok(Err(err)) => {
                        record_endpoint_errors_for_tick(
                            &mut metrics,
                            tick_idx,
                            &err.endpoint_errors,
                        );
                        record_resilient_market_data_error_counts(&mut metrics, &err);
                        errors_count += 1;
                        metrics.record_loop_error(
                            paper_engine::soak_report::PaperSoakLoopErrorInput {
                                reason: paper_engine::soak_report::classify_loop_error(
                                    &err.app_error,
                                ),
                                message: err.app_error.to_string(),
                                state_mutated: before
                                    != paper_soak::StateStructuralFingerprint::from_state(&state),
                            },
                        );
                    }
                    Err(_) => {
                        let err = AppError::HttpRequest {
                            exchange: "paper_soak".to_string(),
                            endpoint: "feature_snapshot".to_string(),
                            reason: format!(
                                "tick exceeded {} ms max duration",
                                retry_config.tick_max_duration_ms
                            ),
                        };
                        let endpoint_errors = vec![
                            PaperSoakEndpointDiagnostic {
                                reason: PaperSoakEndpointErrorReason::FeatureSnapshotError,
                                critical: true,
                                stale_fallback_used: false,
                                critical_fallback_used: false,
                                critical_fallback_failed: false,
                            },
                            PaperSoakEndpointDiagnostic {
                                reason: PaperSoakEndpointErrorReason::HttpTimeout,
                                critical: true,
                                stale_fallback_used: false,
                                critical_fallback_used: false,
                                critical_fallback_failed: false,
                            },
                        ];
                        record_endpoint_errors_for_tick(&mut metrics, tick_idx, &endpoint_errors);
                        errors_count += 1;
                        metrics.record_loop_error(
                            paper_engine::soak_report::PaperSoakLoopErrorInput {
                                reason: paper_engine::soak_report::classify_loop_error(&err),
                                message: err.to_string(),
                                state_mutated: before
                                    != paper_soak::StateStructuralFingerprint::from_state(&state),
                            },
                        );
                    }
                }

                if tick_idx + 1 < soak_config.ticks && soak_config.interval_seconds > 0 {
                    tokio::time::sleep(std::time::Duration::from_secs(
                        soak_config.interval_seconds,
                    ))
                    .await;
                }
            }
            metrics.paper_equity_end = state.account_equity_usdt;
            metrics.duration_seconds = started_at.elapsed().as_secs();

            let report = paper_soak::finalize_report_with_metrics(
                &soak_config,
                ticks_processed,
                candidate_generated_count,
                errors_count,
                metrics,
            );
            print_json(serde_json::to_value(report).map_err(|err| {
                domain::AppError::Config(format!("failed to render paper soak report: {err}"))
            })?)
        }
        PaperCommand::CompareReports(args) => {
            let report = report_compare::compare_report_files(&args.baseline, &args.candidate);
            print_json(serde_json::to_value(report).map_err(|err| {
                domain::AppError::Config(format!(
                    "failed to render paper soak comparison report: {err}"
                ))
            })?)
        }
    }
}

async fn canary_cli(config_path: PathBuf, command: CanaryCommand) -> AppResult<()> {
    let config = EngineConfig::load_from_path(config_path)?;

    match command {
        CanaryCommand::Readiness(args) => {
            let readiness_config = domain::CanaryReadinessConfig::default();
            let inputs = CanaryReadinessInputs {
                paper_state_path: args.paper_state,
                paper_log_path: args.paper_log,
                backtest_input_path: args.backtest_input,
            };
            let report = readiness::evaluate_readiness(&config, &readiness_config, &inputs);
            print_json(serde_json::to_value(report).map_err(|err| {
                domain::AppError::Config(format!("failed to render canary readiness report: {err}"))
            })?)
        }
    }
}

async fn live_micro_cli(config_path: PathBuf, command: LiveMicroCommand) -> AppResult<()> {
    let config = EngineConfig::load_from_path(config_path)?;

    match command {
        LiveMicroCommand::Readiness => {
            let inputs = LiveMicroReadinessInputs::default();
            let report = live_micro::evaluate_live_micro_readiness(&config, &inputs);
            print_json(serde_json::to_value(report).map_err(|err| {
                domain::AppError::Config(format!(
                    "failed to render live micro readiness report: {err}"
                ))
            })?)
        }
    }
}

async fn release_cli(config_path: PathBuf, command: ReleaseCommand) -> AppResult<()> {
    let config = EngineConfig::load_from_path(config_path)?;

    match command {
        ReleaseCommand::Audit(args) => {
            let defaults = domain::ReleaseAuditConfig::default();
            let audit_config = domain::ReleaseAuditConfig {
                backtest_input: args.backtest_input.display().to_string(),
                paper_state: args.paper_state.display().to_string(),
                paper_log: args.paper_log.display().to_string(),
                soak_report: args.soak_report.display().to_string(),
                output: Some(args.output.display().to_string()),
                ..defaults
            };
            let report = release_audit::run_release_audit(&config, &audit_config)?;
            print_json(serde_json::to_value(report).map_err(|err| {
                domain::AppError::Config(format!("failed to render release audit report: {err}"))
            })?)
        }
    }
}

async fn fetch_feature_snapshot(
    args: FeatureSnapshotArgs,
    binance_base_url: Option<&str>,
) -> AppResult<FeatureSnapshot> {
    let adapter = market_adapter(args.exchange, binance_base_url)?;
    let symbol = Symbol::new(&args.symbol)?;
    let ((mark_price, index_price), funding_rate, open_interest, orderbook) = tokio::try_join!(
        adapter.fetch_mark_index_prices(&args.symbol),
        adapter.fetch_funding_rate(&args.symbol),
        adapter.fetch_open_interest(&args.symbol),
        adapter.fetch_orderbook_depth(&args.symbol, args.depth)
    )?;

    snapshot::build_feature_snapshot(
        "binance",
        symbol,
        mark_price,
        index_price,
        funding_rate,
        open_interest,
        orderbook,
    )
}

fn evaluate_god_turnpoint_from_snapshot(
    feature_snapshot: &FeatureSnapshot,
) -> domain::GodTurnpointDecision {
    let signal_decision = signal_decision::evaluate_snapshot(feature_snapshot);
    let risk_decision = risk_decision::evaluate_risk_budget(
        signal_decision.clone(),
        AccountRiskState::default(),
        RiskBudgetConfig::default(),
    );
    let config = GodTurnpointConfig::default();
    let mut window = FeatureWindow::new(config.feature_window_len);
    window.push(feature_snapshot.clone());

    evaluate_god_turnpoint(
        feature_snapshot,
        signal_decision,
        risk_decision,
        &window,
        Decimal::ONE,
        false,
        config,
    )
}

async fn fetch_resilient_feature_snapshot(
    adapter: &BinanceReadonly,
    symbol: &Symbol,
    depth: u16,
    retry_config: &PaperSoakRetryConfig,
    cache: &mut PaperSoakMarketDataCache,
) -> Result<ResilientFeatureSnapshot, ResilientFeatureSnapshotError> {
    let mut endpoint_errors = Vec::new();
    let mut stale_fallback_count = 0_u64;
    let mut max_stale_age_seconds = 0_u64;
    let mut critical_fallback_used_count = 0_u64;
    let mut mark_price_fallback_used_count = 0_u64;
    let mut degraded_market_data = false;

    let orderbook = fetch_with_retries("orderbook_depth", retry_config, || {
        adapter.fetch_orderbook_depth(symbol.as_str(), depth)
    })
    .await
    .map_err(|err| {
        resilient_endpoint_error(err, PaperSoakEndpointErrorReason::OrderbookDepthError, true)
    })?;

    let (mark_price, index_price) = match fetch_with_retries("mark_price", retry_config, || {
        adapter.fetch_mark_index_prices(symbol.as_str())
    })
    .await
    {
        Ok(prices) => prices,
        Err(err) => match degraded_mark_proxy_from_orderbook(&orderbook, retry_config) {
            Ok(prices) => {
                endpoint_errors.extend(endpoint_failure_diagnostics(
                    PaperSoakEndpointErrorReason::MarkPriceError,
                    true,
                    false,
                    true,
                    false,
                    &err,
                ));
                critical_fallback_used_count += 1;
                mark_price_fallback_used_count += 1;
                degraded_market_data = true;
                prices
            }
            Err(proxy_err) => {
                let mut fallback_error = resilient_endpoint_error_with_fallback_state(
                    err,
                    PaperSoakEndpointErrorReason::MarkPriceError,
                    true,
                    false,
                    true,
                );
                fallback_error.app_error = proxy_err;
                return Err(fallback_error);
            }
        },
    };

    let funding_rate = match fetch_with_retries("funding_rate", retry_config, || {
        adapter.fetch_funding_rate(symbol.as_str())
    })
    .await
    {
        Ok(funding_rate) => {
            cache.funding_rate = Some(CachedFundingRate {
                value: funding_rate.clone(),
                fetched_at: Instant::now(),
            });
            funding_rate
        }
        Err(err) => {
            if let Some((cached, age_seconds)) = cache.cached_funding_rate() {
                endpoint_errors.extend(endpoint_failure_diagnostics(
                    PaperSoakEndpointErrorReason::FundingRateError,
                    false,
                    true,
                    false,
                    false,
                    &err,
                ));
                stale_fallback_count += 1;
                max_stale_age_seconds = max_stale_age_seconds.max(age_seconds);
                cached
            } else {
                return Err(resilient_endpoint_error(
                    err,
                    PaperSoakEndpointErrorReason::FundingRateError,
                    false,
                ));
            }
        }
    };

    let open_interest = match fetch_with_retries("open_interest", retry_config, || {
        adapter.fetch_open_interest(symbol.as_str())
    })
    .await
    {
        Ok(open_interest) => {
            cache.open_interest = Some(CachedOpenInterest {
                value: open_interest.clone(),
                fetched_at: Instant::now(),
            });
            open_interest
        }
        Err(err) => {
            if let Some((cached, age_seconds)) = cache.cached_open_interest() {
                endpoint_errors.extend(endpoint_failure_diagnostics(
                    PaperSoakEndpointErrorReason::OpenInterestError,
                    false,
                    true,
                    false,
                    false,
                    &err,
                ));
                stale_fallback_count += 1;
                max_stale_age_seconds = max_stale_age_seconds.max(age_seconds);
                cached
            } else {
                return Err(resilient_endpoint_error(
                    err,
                    PaperSoakEndpointErrorReason::OpenInterestError,
                    false,
                ));
            }
        }
    };

    let snapshot = snapshot::build_feature_snapshot(
        "binance",
        symbol.clone(),
        mark_price,
        index_price,
        funding_rate,
        open_interest,
        orderbook,
    )
    .map_err(|err| {
        resilient_endpoint_error(
            err,
            PaperSoakEndpointErrorReason::FeatureSnapshotError,
            true,
        )
    })?;

    Ok(ResilientFeatureSnapshot {
        snapshot,
        endpoint_errors,
        stale_fallback_count,
        max_stale_age_seconds,
        critical_fallback_used_count,
        mark_price_fallback_used_count,
        degraded_market_data: degraded_market_data || stale_fallback_count > 0,
    })
}

async fn fetch_with_retries<T, Fut, F>(
    endpoint: &'static str,
    retry_config: &PaperSoakRetryConfig,
    mut fetch: F,
) -> AppResult<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = AppResult<T>>,
{
    let mut last_error = None;
    for attempt in 0..=retry_config.per_endpoint_max_retries {
        match tokio::time::timeout(
            Duration::from_millis(retry_config.per_endpoint_timeout_ms),
            fetch(),
        )
        .await
        {
            Ok(Ok(value)) => return Ok(value),
            Ok(Err(err)) => last_error = Some(err),
            Err(_) => {
                last_error = Some(AppError::HttpRequest {
                    exchange: "paper_soak".to_string(),
                    endpoint: endpoint.to_string(),
                    reason: format!(
                        "endpoint timed out after {} ms",
                        retry_config.per_endpoint_timeout_ms
                    ),
                });
            }
        }

        if attempt < retry_config.per_endpoint_max_retries {
            let backoff_ms = retry_config
                .retry_backoff_ms
                .get(attempt as usize)
                .copied()
                .unwrap_or_else(|| retry_config.retry_backoff_ms.last().copied().unwrap_or(0));
            if backoff_ms > 0 {
                tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
            }
        }
    }

    Err(last_error.unwrap_or_else(|| AppError::HttpRequest {
        exchange: "paper_soak".to_string(),
        endpoint: endpoint.to_string(),
        reason: "endpoint retry loop exhausted without a response".to_string(),
    }))
}

fn resilient_endpoint_error(
    app_error: AppError,
    endpoint_reason: PaperSoakEndpointErrorReason,
    critical: bool,
) -> ResilientFeatureSnapshotError {
    resilient_endpoint_error_with_fallback_state(app_error, endpoint_reason, critical, false, false)
}

fn resilient_endpoint_error_with_fallback_state(
    app_error: AppError,
    endpoint_reason: PaperSoakEndpointErrorReason,
    critical: bool,
    critical_fallback_used: bool,
    critical_fallback_failed: bool,
) -> ResilientFeatureSnapshotError {
    let endpoint_errors = endpoint_failure_diagnostics(
        endpoint_reason,
        critical,
        false,
        critical_fallback_used,
        critical_fallback_failed,
        &app_error,
    );
    ResilientFeatureSnapshotError {
        app_error,
        endpoint_errors,
        critical_fallback_failed_count: u64::from(critical_fallback_failed),
        mark_price_fallback_failed_count: u64::from(
            critical_fallback_failed
                && endpoint_reason == PaperSoakEndpointErrorReason::MarkPriceError,
        ),
    }
}

fn endpoint_failure_diagnostics(
    endpoint_reason: PaperSoakEndpointErrorReason,
    critical: bool,
    stale_fallback_used: bool,
    critical_fallback_used: bool,
    critical_fallback_failed: bool,
    app_error: &AppError,
) -> Vec<PaperSoakEndpointDiagnostic> {
    let mut diagnostics = vec![PaperSoakEndpointDiagnostic {
        reason: endpoint_reason,
        critical,
        stale_fallback_used,
        critical_fallback_used,
        critical_fallback_failed,
    }];
    if let Some(reason) = transport_endpoint_error_reason(app_error) {
        diagnostics.push(PaperSoakEndpointDiagnostic {
            reason,
            critical,
            stale_fallback_used,
            critical_fallback_used,
            critical_fallback_failed,
        });
    }
    diagnostics
}

fn transport_endpoint_error_reason(app_error: &AppError) -> Option<PaperSoakEndpointErrorReason> {
    match app_error {
        AppError::HttpRequest { reason, .. } => {
            if reason.to_ascii_lowercase().contains("timeout")
                || reason.to_ascii_lowercase().contains("timed out")
            {
                Some(PaperSoakEndpointErrorReason::HttpTimeout)
            } else {
                None
            }
        }
        AppError::HttpStatus { status, .. } => match *status {
            408 => Some(PaperSoakEndpointErrorReason::HttpTimeout),
            418 | 429 => Some(PaperSoakEndpointErrorReason::HttpRateLimit),
            _ => Some(PaperSoakEndpointErrorReason::HttpStatusError),
        },
        AppError::ResponseParse { .. } => Some(PaperSoakEndpointErrorReason::ParseError),
        _ => None,
    }
}

fn record_endpoint_errors_for_tick(
    metrics: &mut paper_engine::soak_report::PaperSoakRunMetrics,
    tick_index: u64,
    endpoint_errors: &[PaperSoakEndpointDiagnostic],
) {
    for error in endpoint_errors {
        metrics.record_endpoint_error(paper_engine::soak_report::PaperSoakEndpointErrorInput {
            tick_index,
            reason: error.reason,
            critical: error.critical,
            stale_fallback_used: error.stale_fallback_used,
            critical_fallback_used: error.critical_fallback_used,
            critical_fallback_failed: error.critical_fallback_failed,
        });
    }
}

fn record_resilient_market_data_counts(
    metrics: &mut paper_engine::soak_report::PaperSoakRunMetrics,
    snapshot: &ResilientFeatureSnapshot,
) {
    metrics.critical_fallback_used_count += snapshot.critical_fallback_used_count;
    metrics.mark_price_fallback_used_count += snapshot.mark_price_fallback_used_count;
}

fn record_resilient_market_data_error_counts(
    metrics: &mut paper_engine::soak_report::PaperSoakRunMetrics,
    err: &ResilientFeatureSnapshotError,
) {
    metrics.critical_fallback_failed_count += err.critical_fallback_failed_count;
    metrics.mark_price_fallback_failed_count += err.mark_price_fallback_failed_count;
}

fn degraded_mark_proxy_from_orderbook(
    orderbook: &OrderBook,
    retry_config: &PaperSoakRetryConfig,
) -> AppResult<(Price, Price)> {
    let spread_bps = orderbook.spread_bps();
    if spread_bps > retry_config.max_degraded_mark_proxy_spread_bps {
        return Err(AppError::HttpRequest {
            exchange: "paper_soak".to_string(),
            endpoint: "mark_price_orderbook_mid_proxy".to_string(),
            reason: format!(
                "fresh orderbook spread {spread_bps} bps exceeded degraded mark proxy limit {} bps",
                retry_config.max_degraded_mark_proxy_spread_bps
            ),
        });
    }
    let mid = (orderbook.bid.as_decimal() + orderbook.ask.as_decimal()) / Decimal::from(2);
    let proxy = Price::new(mid)?;
    Ok((proxy, proxy))
}

#[derive(Debug, Default)]
struct PaperSoakMarketDataCache {
    funding_rate: Option<CachedFundingRate>,
    open_interest: Option<CachedOpenInterest>,
}

impl PaperSoakMarketDataCache {
    fn cached_funding_rate(&self) -> Option<(FundingRate, u64)> {
        self.funding_rate.as_ref().and_then(|cached| {
            let age_seconds = cached.fetched_at.elapsed().as_secs();
            paper_engine::soak_report::endpoint_allows_stale_fallback(
                PaperSoakEndpointErrorReason::FundingRateError,
                age_seconds,
            )
            .then(|| (cached.value.clone(), age_seconds))
        })
    }

    fn cached_open_interest(&self) -> Option<(OpenInterest, u64)> {
        self.open_interest.as_ref().and_then(|cached| {
            let age_seconds = cached.fetched_at.elapsed().as_secs();
            paper_engine::soak_report::endpoint_allows_stale_fallback(
                PaperSoakEndpointErrorReason::OpenInterestError,
                age_seconds,
            )
            .then(|| (cached.value.clone(), age_seconds))
        })
    }
}

#[derive(Debug, Clone)]
struct CachedFundingRate {
    value: FundingRate,
    fetched_at: Instant,
}

#[derive(Debug, Clone)]
struct CachedOpenInterest {
    value: OpenInterest,
    fetched_at: Instant,
}

#[derive(Debug)]
struct ResilientFeatureSnapshot {
    snapshot: FeatureSnapshot,
    endpoint_errors: Vec<PaperSoakEndpointDiagnostic>,
    stale_fallback_count: u64,
    max_stale_age_seconds: u64,
    critical_fallback_used_count: u64,
    mark_price_fallback_used_count: u64,
    degraded_market_data: bool,
}

impl ResilientFeatureSnapshot {
    fn data_freshness_score(&self) -> Decimal {
        if self.stale_fallback_count > 0 {
            dec!(0.75)
        } else {
            Decimal::ONE
        }
    }
}

#[derive(Debug, Clone)]
struct ResilientFeatureSnapshotError {
    app_error: AppError,
    endpoint_errors: Vec<PaperSoakEndpointDiagnostic>,
    critical_fallback_failed_count: u64,
    mark_price_fallback_failed_count: u64,
}

#[derive(Debug, Clone, Copy)]
struct PaperSoakEndpointDiagnostic {
    reason: PaperSoakEndpointErrorReason,
    critical: bool,
    stale_fallback_used: bool,
    critical_fallback_used: bool,
    critical_fallback_failed: bool,
}

fn market_adapter(
    exchange: ExchangeName,
    binance_base_url: Option<&str>,
) -> AppResult<BinanceReadonly> {
    match exchange {
        ExchangeName::Binance => match binance_base_url {
            Some(base_url) => BinanceReadonly::new(base_url, std::time::Duration::from_secs(5), 2),
            None => Ok(BinanceReadonly::production()),
        },
    }
}

fn levels_to_json(levels: &[domain::OrderBookLevel]) -> Vec<Value> {
    levels
        .iter()
        .map(|level| {
            json!({
                "price": level.price.as_decimal().to_string(),
                "quantity": level.quantity.as_decimal().to_string()
            })
        })
        .collect()
}

fn print_json(value: Value) -> AppResult<()> {
    let raw = serde_json::to_string_pretty(&value)
        .map_err(|err| domain::AppError::Config(format!("failed to render JSON output: {err}")))?;
    println!("{raw}");
    Ok(())
}

fn print_feature_snapshot(snapshot: &FeatureSnapshot) -> AppResult<()> {
    print_json(json!({
        "exchange": snapshot.exchange,
        "symbol": snapshot.symbol.as_str(),
        "mark_price": snapshot.mark_price.as_decimal().to_string(),
        "index_price": snapshot.index_price.as_decimal().to_string(),
        "premium": snapshot.premium.to_string(),
        "premium_bps": snapshot.premium_bps.to_string(),
        "funding_rate": snapshot.funding_rate.to_string(),
        "funding_regime": snapshot.funding_regime,
        "open_interest": snapshot.open_interest.as_decimal().to_string(),
        "liquidity": {
            "spread_bps": snapshot.liquidity.spread_bps.to_string(),
            "bid_depth_5bps": snapshot.liquidity.bid_depth_5bps.to_string(),
            "ask_depth_5bps": snapshot.liquidity.ask_depth_5bps.to_string(),
            "bid_depth_10bps": snapshot.liquidity.bid_depth_10bps.to_string(),
            "ask_depth_10bps": snapshot.liquidity.ask_depth_10bps.to_string(),
            "imbalance": snapshot.liquidity.imbalance.to_string(),
            "liquidity_score": snapshot.liquidity.liquidity_score.to_string()
        },
        "cost": {
            "round_trip_fee_bps": snapshot.cost.round_trip_fee_bps.to_string(),
            "spread_bps": snapshot.cost.spread_bps.to_string(),
            "slippage_bps": snapshot.cost.slippage_bps.to_string(),
            "estimated_total_cost_bps": snapshot.cost.estimated_total_cost_bps.to_string()
        }
    }))
}
