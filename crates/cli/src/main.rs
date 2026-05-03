#![forbid(unsafe_code)]

use std::{path::PathBuf, time::Instant};

use backtest::{event_loader, event_replay};
use canary_engine::readiness::{self, CanaryReadinessInputs};
use clap::{Args, Parser, Subcommand, ValueEnum};
use cost_engine::{edge_after_cost, fee_model};
use domain::{
    AccountRiskState, AppResult, BacktestConfig, CandidateSizingConfig, EngineConfig,
    FeatureSnapshot, Leverage, Notional, OrderRequest, Price, Quantity, RiskBudget,
    RiskBudgetConfig, Side, Symbol,
};
use exchange::{BinanceReadonly, ExchangeAdapter, MockExchange};
use execution_engine::{candidate_decision, dry_run_router, order_candidate};
use feature_engine::snapshot;
use paper_engine::{paper_loop, paper_report, paper_soak, paper_state};
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
}

#[derive(Debug, Subcommand)]
enum CanaryCommand {
    Readiness(CanaryReadinessArgs),
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
struct CanaryReadinessArgs {
    #[arg(long)]
    paper_state: PathBuf,

    #[arg(long)]
    paper_log: PathBuf,

    #[arg(long)]
    backtest_input: PathBuf,
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
        Command::Risk { command } => risk(config, binance_base_url, command).await,
        Command::OrderCandidate { command } => {
            order_candidate_cli(config, binance_base_url, command).await
        }
        Command::Backtest { command } => backtest_cli(config, command).await,
        Command::Paper { command } => paper_cli(config, binance_base_url, command).await,
        Command::Canary { command } => canary_cli(config, command).await,
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
    let config = EngineConfig::load_from_path(config_path)?;
    config.validate_safety()?;

    match command {
        PaperCommand::Run(args) => {
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

            for tick_idx in 0..soak_config.ticks {
                let before = paper_soak::StateStructuralFingerprint::from_state(&state);
                match fetch_feature_snapshot(
                    FeatureSnapshotArgs {
                        exchange: args.exchange,
                        symbol: args.symbol.clone(),
                        depth: args.depth,
                    },
                    binance_base_url.as_deref(),
                )
                .await
                {
                    Ok(feature_snapshot) => {
                        match paper_loop::process_snapshot(&mut state, &feature_snapshot) {
                            Ok(outcome) => {
                                ticks_processed += 1;
                                let safe_candidate_generated =
                                    paper_engine::soak_report::is_audit_only_candidate_generated(
                                        &outcome.candidate_decision,
                                    );
                                if safe_candidate_generated {
                                    candidate_generated_count += 1;
                                }
                                let append_failed = outcome.trade.as_ref().is_some_and(|trade| {
                                    paper_state::append_trade(&soak_config.log_path, trade).is_err()
                                });
                                if append_failed {
                                    errors_count += 1;
                                }
                                if paper_state::persist_state(&soak_config.state_path, &state)
                                    .is_err()
                                {
                                    errors_count += 1;
                                }
                                let state_mutated = before
                                    != paper_soak::StateStructuralFingerprint::from_state(&state);
                                let state_mutated_without_candidate_or_fill = state_mutated
                                    && !safe_candidate_generated
                                    && outcome.trade.is_none();
                                metrics.record_decision(
                                    &outcome.signal_decision,
                                    &outcome.risk_decision,
                                    &outcome.candidate_decision,
                                    outcome.trade.is_some(),
                                    state_mutated,
                                    state_mutated_without_candidate_or_fill,
                                );
                            }
                            Err(_) => errors_count += 1,
                        }
                    }
                    Err(_) => errors_count += 1,
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
