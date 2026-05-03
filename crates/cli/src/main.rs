#![forbid(unsafe_code)]

use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};
use cost_engine::{edge_after_cost, fee_model};
use domain::{
    AccountRiskState, AppResult, CandidateSizingConfig, EngineConfig, FeatureSnapshot, Leverage,
    Notional, OrderRequest, Price, Quantity, RiskBudget, RiskBudgetConfig, Side, Symbol,
};
use exchange::{BinanceReadonly, ExchangeAdapter, MockExchange};
use execution_engine::{candidate_decision, dry_run_router, order_candidate};
use feature_engine::snapshot;
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
