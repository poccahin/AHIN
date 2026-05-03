# Convex Evergreen Engine

Research-only Rust workspace for a 200 USDT derivatives-aware convex signal engine.

This is not a signal-first trading bot. It is a cost-aware, execution-aware, regime-aware, risk-budgeted engine whose first job is to avoid account-killing behavior.

```text
Trade = Signal x Regime x EdgeAfterCost x ExecutionQuality x RiskBudget x Convexity
```

## Safety Posture

- No live trading in phase one.
- No real orders.
- No secret or private key loading.
- All execution is dry-run or paper-only.
- `ALLOW_LIVE_TRADING=false` is the default.
- `ALLOW_LIVE_100X=false` is the default.
- Config examples cap leverage at 5x or below.

## Workspace Crates

- `domain`: strict shared types, config, and errors
- `exchange`: exchange adapter trait plus mock/read-only stubs
- `market_data`: read-only market data models and freshness guards
- `feature_engine`: first-pass deterministic feature helpers
- `signal_engine`: signal packet helpers and regime/false-breakout guards
- `cost_engine`: fee, spread, slippage, and cost attrition checks
- `risk_engine`: risk budget, liquidation, notional, loss, and tail-event checks
- `execution_engine`: dry-run order candidate routing only
- `state_engine`: engine state and state reconciliation guard
- `withdrawal_engine`: high-watermark policy placeholders with no real withdrawals
- `backtest`: event replay and simulation placeholders
- `cli`: health-check command

## Quick Start

```sh
cargo test --workspace
cargo run -p cli -- health-check
```

Expected health check behavior:

- Loads `config/default.toml`.
- Verifies live trading and live 100x are disabled.
- Verifies max leverage is 5x or below.
- Constructs the mock exchange.
- Runs dry-run routing and state reconciliation checks.

## Phase 1: Read-Only Binance Market Data

Phase 1 adds Binance USD-M Futures public market-data ingestion only. The client uses unsigned public `GET` endpoints under `https://fapi.binance.com` and does not read API keys, signed parameters, private account data, leverage settings, order endpoints, or withdrawal endpoints.

```sh
cargo run -p cli -- market snapshot --exchange binance --symbol BTCUSDT
cargo run -p cli -- market funding --exchange binance --symbol BTCUSDT
cargo run -p cli -- market mark-price --exchange binance --symbol BTCUSDT
cargo run -p cli -- market open-interest --exchange binance --symbol BTCUSDT
cargo run -p cli -- market orderbook --exchange binance --symbol BTCUSDT --depth 20
```

Supported Binance USD-M public endpoints:

- `GET /fapi/v1/exchangeInfo`
- `GET /fapi/v1/premiumIndex`
- `GET /fapi/v1/fundingRate`
- `GET /fapi/v1/openInterest`
- `GET /fapi/v1/depth`

The adapter has request timeout, bounded retry for transient HTTP/network failures, and structured `AppError` variants for request, status, and parse failures.

## Phase 2: Derivatives Feature Snapshot

Phase 2 transforms read-only Binance market data into normalized research features. It does not score `SignalPacket`s, create strategies, place orders, read secrets, or touch private endpoints.

```sh
cargo run -p cli -- features snapshot --exchange binance --symbol BTCUSDT --depth 100
```

The snapshot combines:

- mark price and index price from `GET /fapi/v1/premiumIndex`
- latest funding rate from `GET /fapi/v1/fundingRate`
- open interest from `GET /fapi/v1/openInterest`
- orderbook depth from `GET /fapi/v1/depth`

Example output shape:

```json
{
  "exchange": "binance",
  "symbol": "BTCUSDT",
  "mark_price": "101.00",
  "index_price": "100.00",
  "premium": "1.00",
  "premium_bps": "100.00",
  "funding_rate": "0.00020000",
  "funding_regime": "positive",
  "open_interest": "1234.5",
  "liquidity": {
    "spread_bps": "9.995002498750624687656171914",
    "bid_depth_5bps": "10000.00",
    "ask_depth_5bps": "10010.00",
    "bid_depth_10bps": "29996.00",
    "ask_depth_10bps": "30034.00",
    "imbalance": "-0.000633016824920872897551224388",
    "liquidity_score": "1.0000000000000000000000000000"
  },
  "cost": {
    "round_trip_fee_bps": "8",
    "spread_bps": "9.995002498750624687656171914",
    "slippage_bps": "0E-27",
    "estimated_total_cost_bps": "17.995002498750624687656171914"
  }
}
```

## Phase Roadmap

1. Workspace skeleton, strict domain types, safe config, mock exchange, dry-run CLI health check.
2. Read-only market data adapters for Binance, OKX, and Deribit.
3. SignalPacket construction with regime, cost, execution quality, risk budget, and convexity gates.
4. Cost and liquidity filters with small-account fee attrition protection.
5. Risk budget engine with liquidation, gross notional, daily loss, and tail-event simulation.
6. Dry-run execution router and state reconciliation guard hardening.
7. Reproducible backtest harness with fee, slippage, funding, and reconnect simulations.
8. Paper trading loop with no live order capability.
9. Red-team test expansion and failure-mode reports.
10. Future gated live-readiness review. Live execution remains out of scope until explicitly unlocked.

## Red-Team Scenarios

The initial test suite includes executable coverage for:

1. False breakout signal
2. Misleading liquidation heatmap
3. Mark price close to liquidation
4. Chronic fee attrition
5. Pyramid add at top before reversal
6. Websocket disconnect
7. Local state and exchange state mismatch
8. Funding interval change
9. Min notional failure
10. Reduce-only order failure

## V11 Hedge Research Spec

`backtest::v11_hedge` captures the ETH/USDT perpetual V11.0 hedge parameters as
research-only code:

- 200 USDT initial base, scenario-C stage bases of 200 -> 1,000 -> 10,000 USDT
- 200x leverage for margin simulation only
- 720% total exposure, neutral 360% long / 360% short
- EMA6/24/72 signal mapping:
  - `STRONG_BULL`: +50% net, 385% long / 335% short
  - `STRONG_BEAR`: -50% net, 335% long / 385% short
  - weak or neutral signals: 0% net, 360% / 360%
- 5% single-leg take profit, 3x ATR stop, 168-hour loss-only expiry
- 0.055% one-way taker fee
- Daily settlement keeps the active stage base and models excess withdrawal

This module deliberately does not create live orders, does not load secrets, and
does not relax the runtime config safety cap. A regression test also locks the
futures PnL formula to notional times price move, without multiplying leverage a
second time.
