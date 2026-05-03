#![forbid(unsafe_code)]

use std::path::PathBuf;

use clap::{Parser, Subcommand};
use cost_engine::{edge_after_cost, fee_model};
use domain::{
    AppResult, EngineConfig, Leverage, Notional, OrderRequest, Price, Quantity, RiskBudget, Side,
    Symbol,
};
use exchange::{ExchangeAdapter, MockExchange};
use execution_engine::{dry_run_router, order_candidate};
use risk_engine::{risk_budget, tail_event_simulator};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use state_engine::{EngineState, ReconciliationOutcome, reconcile_positions};

#[derive(Debug, Parser)]
#[command(name = "convex-evergreen-cli")]
#[command(about = "Research-only derivatives-aware convex signal engine CLI")]
struct Cli {
    #[arg(long, default_value = "config/default.toml")]
    config: PathBuf,

    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    HealthCheck,
}

#[tokio::main]
async fn main() {
    if let Err(err) = run().await {
        eprintln!("health-check: FAILED: {err}");
        std::process::exit(1);
    }
}

async fn run() -> AppResult<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::HealthCheck => health_check(cli.config).await,
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
