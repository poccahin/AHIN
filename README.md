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
- `paper_engine`: local simulated paper account loop, soak checks, and persistence
- `state_engine`: engine state and state reconciliation guard
- `withdrawal_engine`: high-watermark policy placeholders with no real withdrawals
- `backtest`: offline JSONL event replay and deterministic simulation reports
- `cli`: health-check, market-data, feature, signal, risk, dry-run candidate, backtest, paper, and canary commands

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

## Phase 3: SignalPacket Evaluation

Phase 3 transforms a `FeatureSnapshot` into a deterministic research-only `SignalPacket` and `SignalDecision`. It still does not create executable orders, paper trades, live trades, leverage changes, private API calls, or withdrawals.

```sh
cargo run -p cli -- signal evaluate --exchange binance --symbol BTCUSDT --depth 100
```

The evaluator combines:

- placeholder price-structure score from premium, funding, and liquidity
- derivatives score from funding regime, premium bps, open interest presence, and liquidity
- funding score from `FundingRegime`
- liquidity score from `FeatureSnapshot.liquidity`
- cost score from `estimated_total_cost_bps`

All scores are clamped to `0..100`. The output always keeps `trade_allowed=false` in Phase 3 because risk budget checks and execution candidates are intentionally not implemented yet.

Example output shape:

```json
{
  "packet": {
    "exchange": "binance",
    "symbol": "BTCUSDT",
    "direction": "short",
    "market_regime": "crowded_long",
    "price_structure_score": "95.0",
    "derivatives_score": "95.0",
    "funding_score": "90",
    "liquidity_score": "100.0",
    "cost_score": "97",
    "final_strength": "95.3",
    "grade": "a_plus",
    "reasons": ["crowded_long"]
  },
  "signal_allowed": true,
  "trade_allowed": false,
  "reasons": ["crowded_long", "research_only_mode"],
  "summary": "research signal only; trade execution is disabled in phase 3"
}
```

## Phase 4: Risk Budget Decision

Phase 4 evaluates whether a `SignalDecision` may pass deterministic research risk-budget gates. It still does not produce order candidates, paper trades, live trades, private API calls, leverage changes, or withdrawals.

```sh
cargo run -p cli -- risk evaluate --exchange binance --symbol BTCUSDT --depth 100
```

Default risk-budget constants:

- `one_r_usdt = 0.8`
- `max_loss_per_signal_usdt = 1.0`
- `daily_soft_stop_usdt = 2.0`
- `daily_hard_stop_usdt = 3.0`
- `weekly_stop_usdt = 6.0`
- `disable_trend_below_equity = 190.0`
- `paper_mode_below_equity = 180.0`
- `max_gross_notional = 360.0`

The output separates internal research approval from execution:

- `risk_allowed=true` means deterministic risk gates passed.
- `executable_trading_allowed=false` is always enforced in Phase 4.
- reasons always include `research_only_mode` and `no_executable_order_generated`.

Example output shape:

```json
{
  "symbol": "BTCUSDT",
  "risk_allowed": true,
  "executable_trading_allowed": false,
  "risk_budget_usdt": "0.8",
  "effective_one_r_usdt": "0.8",
  "max_loss_per_signal_usdt": "1",
  "reasons": [
    "research_only_mode",
    "no_executable_order_generated",
    "risk_checks_passed"
  ],
  "summary": "risk checks passed for research budgeting; executable trading remains disabled"
}
```

## Phase 5: Dry-Run Order Candidate

Phase 5 converts `SignalDecision + RiskBudgetDecision` into an audit-only `DryRunOrderCandidate` when all research gates pass. It does not place orders, create executable exchange orders, call signed endpoints, read API keys, change leverage, paper trade, or withdraw funds.

```sh
cargo run -p cli -- order-candidate dry-run --exchange binance --symbol BTCUSDT --depth 100
```

Sizing defaults:

- `one_r_usdt = 0.8`
- `max_loss_per_signal_usdt = 1.0`
- `default_leverage = 2`
- `max_leverage = 3`
- `assumed_stop_distance_pct = 0.005`
- `max_initial_signal_notional = 60.0`
- `max_gross_notional = 360.0`

Safety invariants:

- `candidate_generated=false` if the signal gate rejects.
- `candidate_generated=false` if the risk gate rejects.
- generated candidates are audit-only.
- `executable=false` always.
- `real_order_id=null` always.
- reasons include `dry_run_only` and `no_executable_order_generated`.

Example output shape:

```json
{
  "candidate_generated": true,
  "candidate": {
    "candidate_id": "audit-binance-BTCUSDT",
    "symbol": "BTCUSDT",
    "direction": "long",
    "reference_price": "100",
    "notional": "60",
    "margin_required": "30",
    "leverage": "2",
    "assumed_stop_distance_pct": "0.005",
    "max_loss_usdt": "0.8",
    "executable": false,
    "real_order_id": null,
    "audit_only": true,
    "reasons": [
      "dry_run_only",
      "no_executable_order_generated",
      "research_only_mode",
      "audit_only",
      "candidate_generated"
    ]
  }
}
```

## Phase 6: Backtest Event Replay

Phase 6 replays local JSONL market events through the existing research pipeline:

```text
MarketEvent -> FeatureSnapshot -> SignalDecision -> RiskBudgetDecision -> OrderCandidateDecision -> SimulatedTrade -> BacktestReport
```

The backtest consumes only offline files. It does not connect to exchanges, place orders, create executable exchange orders, read API keys, call signed endpoints, change leverage, paper trade, or withdraw funds.

```sh
cargo run -p cli -- backtest replay --input data/replay/sample_events.jsonl
```

Each JSONL line is one `MarketEvent`:

```json
{
  "sequence": 1,
  "timestamp_ms": 1700000000000,
  "exchange": "offline",
  "symbol": "BTCUSDT",
  "mark_price": "100.00",
  "index_price": "100.20",
  "funding_rate": "0.0002",
  "open_interest": "1000",
  "bid_levels": [{"price": "99.99", "quantity": "500"}],
  "ask_levels": [{"price": "100.01", "quantity": "500"}]
}
```

The report includes:

- `events_processed`
- `candidates_generated`
- `simulated_trades`
- `gross_pnl_usdt`
- `net_pnl_usdt`
- `total_fees_usdt`
- `max_drawdown_usdt`
- `win_rate`
- `profit_factor`
- `rejected_by_signal`
- `rejected_by_risk`
- `rejected_by_cost`

Simulated fills are conservative and deterministic: they use mark price, deduct estimated costs, exit after a configurable event horizon, and always keep `executable=false` with `real_order_id=null`.

## Phase 6.1: Backtest Report Hardening

Phase 6.1 adds diagnostics that explain why a replay is not producing usable research outcomes. The report now separates signal, risk, cost, and order-candidate rejection reasons while keeping the replay fully offline and non-executable.

Additional report fields:

- `avg_net_pnl_per_trade`
- `median_net_pnl_per_trade`
- `max_win_usdt`
- `max_loss_usdt`
- `avg_fee_per_trade`
- `fee_to_gross_profit_ratio`
- `expectancy_usdt`
- `avg_r_multiple`
- `max_consecutive_losses`
- `rejection_breakdown_by_reason`

Rejection reasons are aggregated from:

- `SignalDecision.reasons`
- `RiskBudgetDecision.reasons`
- `OrderCandidateDecision.reasons`

Example output excerpt:

```json
{
  "events_processed": 3,
  "simulated_trades": 2,
  "avg_net_pnl_per_trade": "-0.0028902467336683417085427134",
  "median_net_pnl_per_trade": "-0.0028902467336683417085427134",
  "max_win_usdt": "0.23759820",
  "max_loss_usdt": "-0.2433786934673366834170854269",
  "avg_fee_per_trade": "0.0624379854271356783919597994",
  "fee_to_gross_profit_ratio": "0.4162532361809045226130653297",
  "expectancy_usdt": "-0.0028902467336683417085427134",
  "avg_r_multiple": "-0.0036128084170854271356783918",
  "max_consecutive_losses": 1,
  "rejection_breakdown_by_reason": {
    "order.signal_rejected": 1,
    "risk.signal_not_allowed": 1,
    "signal.neutral_signal": 1
  }
}
```

If no simulated trades are produced, numeric diagnostics return safe zero values and `rejection_breakdown_by_reason` remains an empty object unless a rejected replay decision supplied reasons.

## Phase 7: Paper Trading Loop

Phase 7 repeatedly runs the existing research pipeline on Binance USD-M public read-only market snapshots and updates a local simulated paper account. It does not place orders, call signed/private endpoints, read API keys, change leverage, withdraw funds, or create executable exchange orders.

```sh
cargo run -p cli -- paper run --exchange binance --symbol BTCUSDT --depth 100 --ticks 10 --interval-seconds 15
```

Optional local persistence paths:

```sh
cargo run -p cli -- paper run \
  --exchange binance \
  --symbol BTCUSDT \
  --depth 100 \
  --ticks 2 \
  --interval-seconds 1 \
  --state-path data/paper/paper_state.json \
  --log-path data/paper/paper_trades.jsonl
```

Default generated files:

- `data/paper/paper_state.json`
- `data/paper/paper_trades.jsonl`

These files are local runtime artifacts and are ignored by git. They must never contain API keys, secrets, private account data, or real exchange order identifiers.

Paper loop flow:

```text
Binance public market data
-> FeatureSnapshot
-> SignalDecision
-> RiskBudgetDecision
-> OrderCandidateDecision
-> simulated PaperTrade if candidate_generated
-> PaperEngineState update
-> local state/log persistence
```

Paper safety invariants:

- positions are simulated only.
- `PaperTrade.executable=false` always.
- `PaperTrade.real_order_id=null` always.
- rejected candidates do not open paper positions.
- state/log paths must be local file paths.

Example report shape:

```json
{
  "ticks_requested": 2,
  "ticks_processed": 2,
  "fills_generated": 1,
  "rejected_candidates": 1,
  "open_positions": 1,
  "state_path": "data/paper/paper_state.json",
  "log_path": "data/paper/paper_trades.jsonl",
  "final_state": {
    "account_equity_usdt": "199.94",
    "ticks_processed": 2,
    "trades_count": 1
  }
}
```

## Phase 8: Canary Readiness Check

Phase 8 adds an audit-only readiness checker for a future manually gated micro-live canary review. It does not enable live trading, place orders, call signed/private endpoints, read API keys, change leverage, or execute withdrawals.

```sh
cargo run -p cli -- canary readiness \
  --paper-state data/paper/paper_state.json \
  --paper-log data/paper/paper_trades.jsonl \
  --backtest-input data/replay/sample_events.jsonl
```

Readiness inputs are local files only:

- engine config from `--config`, defaulting to `config/default.toml`
- paper state JSON
- paper trade log JSONL
- backtest replay JSONL
- source files scanned for obvious forbidden capability patterns
- git hygiene for `target/`

Checks performed:

- `safety_config_check`: verifies live trading, live orders, live 100x, withdrawals, and leverage caps remain disabled or bounded.
- `paper_state_check`: verifies local paper state exists, parses, has no negative equity, no duplicate open position, no executable trade marker, and no real order id.
- `paper_log_check`: verifies local JSONL parses and every paper trade has `executable=false` and `real_order_id=null`.
- `backtest_replay_check`: replays the local sample input and verifies simulated trades remain non-executable.
- `forbidden_capability_scan`: scans selected source files for signed order endpoints, withdrawal endpoints, API key env names, leverage-changing endpoints, and real order id assignment.
- `git_hygiene_check`: verifies `target/` is ignored and not tracked when git is available.

Important Phase 8 behavior:

- `ready=false` is expected unless every check passes and a future explicit manual live gate exists.
- Phase 8 intentionally does not add that manual gate.
- `live_trading_allowed=false` always.
- `executable_order_capability=false` always.

Example output shape:

```json
{
  "ready": false,
  "live_trading_allowed": false,
  "executable_order_capability": false,
  "blockers": [
    {
      "code": "manual_live_gate_absent",
      "message": "Phase 8 intentionally has no manual live canary gate flag"
    }
  ],
  "summary": "canary is not ready; audit-only readiness did not satisfy every gate"
}
```

## Phase 8.1: Paper Soak Test & Stability Gate

Phase 8.1 runs an extended paper loop over Binance USD-M public read-only market snapshots and then audits the resulting local paper state and trade log. It does not enable live trading, place orders, call signed/private endpoints, read API keys, change leverage, execute withdrawals, or create executable exchange orders.

```sh
cargo run -p cli -- paper soak --exchange binance --symbol BTCUSDT --depth 100 --ticks 240 --interval-seconds 15
```

Short validation run:

```sh
cargo run -p cli -- paper soak --exchange binance --symbol BTCUSDT --depth 100 --ticks 3 --interval-seconds 1
```

Optional local persistence paths:

```sh
cargo run -p cli -- paper soak \
  --exchange binance \
  --symbol BTCUSDT \
  --depth 100 \
  --ticks 3 \
  --interval-seconds 1 \
  --state-path data/paper/paper_state.json \
  --log-path data/paper/paper_trades.jsonl
```

The soak report includes:

- `ticks_processed`
- `state_valid`
- `paper_log_valid`
- `duplicate_positions_count`
- `candidate_generated_count`
- `paper_trades_count`
- `open_positions_count`
- `realized_pnl_usdt`
- `unrealized_pnl_usdt`
- `errors_count`
- `warnings`
- `blockers`
- `soak_passed`

Soak blockers:

- duplicate same-symbol and same-direction open paper positions
- `executable=true` in the paper log
- non-null `real_order_id` in the paper log
- negative paper equity
- unreadable or unparsable state/log files
- loop errors while fetching public data or processing snapshots
- candidate generation above hard safety thresholds

Soak warnings:

- zero paper trades
- zero processed ticks
- high candidate-pressure ratio above `0.25`; above `0.50` becomes a blocker

Example output shape:

```json
{
  "ticks_requested": 3,
  "ticks_processed": 3,
  "state_valid": true,
  "paper_log_valid": true,
  "duplicate_positions_count": 0,
  "candidate_generated_count": 0,
  "paper_trades_count": 0,
  "open_positions_count": 0,
  "realized_pnl_usdt": "0",
  "unrealized_pnl_usdt": "0",
  "errors_count": 0,
  "warnings": [
    {
      "code": "zero_paper_trades",
      "message": "paper soak completed with zero paper trades"
    }
  ],
  "blockers": [],
  "soak_passed": true
}
```

## Phase 8.2: Long Soak Report & Decision Quality Metrics

Phase 8.2 extends the paper soak report with decision-quality diagnostics for longer local simulated sessions. The command still uses only Binance public read-only market data plus local paper state/log files. It does not place orders, call signed/private endpoints, read API keys, change leverage, execute withdrawals, or enable live trading.

```sh
cargo run -p cli -- paper soak \
  --exchange binance \
  --symbol BTCUSDT \
  --depth 100 \
  --ticks 240 \
  --interval-seconds 15 \
  --report-path data/paper/soak_report.json
```

Additional report fields:

- `candidate_decisions_evaluated`
- `candidate_generated_count`
- `signal_grade_distribution`
- `signal_direction_distribution`
- `rejection_breakdown_by_reason`
- `candidate_pressure_ratio`
- `min_ticks_for_candidate_pressure_blocker`
- `avg_signal_strength`
- `max_signal_strength`
- `avg_edge_after_cost_ratio`
- `state_mutation_count`
- `paper_equity_start`
- `paper_equity_end`
- `paper_equity_drift`
- `duration_seconds`
- `ticks_per_minute`

Decision tracking flow:

```text
FeatureSnapshot
-> SignalDecision
-> RiskBudgetDecision
-> OrderCandidateDecision
-> PaperSoakReport metrics
```

Phase 8.2 guardrails:

- `candidate_decisions_evaluated` counts every tick where `OrderCandidateDecision` was evaluated.
- `candidate_generated_count` counts only actual audit-only candidates with `audit_only=true`, `executable=false`, and `real_order_id=null`.
- `candidate_pressure_ratio = candidate_generated_count / ticks_processed`.
- repeated A+ signals without paper fills emit `repeated_a_plus_without_paper_fills`.
- structural state mutation without a candidate or fill emits `state_mutation_without_candidate_or_fill` and blocks soak pass.
- an invalid or unwritable `--report-path` emits `soak_report_path_unreadable` and blocks soak pass.
- zero trades remains a warning, not a blocker.

## Phase 8.2.1: Candidate Pressure Calibration

Phase 8.2.1 keeps short smoke tests useful without masking long-soak pressure problems:

- If `ticks_processed < 20`, `candidate_pressure_ratio > 0.50` emits `candidate_pressure_excessive_short_sample` as a warning only.
- If `ticks_processed >= 20`, `candidate_pressure_ratio > 0.50` emits `candidate_pressure_excessive` and blocks soak pass.
- If `ticks_processed >= 100`, `candidate_pressure_ratio > 0.25` emits `candidate_pressure_high` as a warning.
- zero trades still emits a warning only.

Example output excerpt:

```json
{
  "candidate_decisions_evaluated": 240,
  "candidate_generated_count": 30,
  "candidate_pressure_ratio": "0.125",
  "min_ticks_for_candidate_pressure_blocker": 20,
  "avg_signal_strength": "61.4",
  "max_signal_strength": "92.1",
  "avg_edge_after_cost_ratio": "0.84",
  "signal_grade_distribution": {
    "a_plus": 2,
    "c": 10
  },
  "signal_direction_distribution": {
    "long": 4,
    "neutral": 8
  },
  "rejection_breakdown_by_reason": {
    "signal.neutral_signal": 8,
    "risk.weak_signal": 8,
    "order.signal_rejected": 8
  },
  "paper_equity_start": "200",
  "paper_equity_end": "199.92",
  "paper_equity_drift": "-0.08",
  "duration_seconds": 3600,
  "ticks_per_minute": "4",
  "soak_passed": true
}
```

## Phase 8.2.2: Candidate Quality Gate Hardening

Phase 8.2.2 prevents weak research decisions from becoming audit-only candidates or simulated paper fills. Candidate pressure now measures only candidates that pass every quality and safety invariant.

Candidate generation requires all of:

- `SignalGrade::APlus`
- `final_strength >= 85`
- `edge_after_cost_ratio >= 3.0`
- `RiskBudgetDecision.risk_allowed=true`
- `audit_only=true`, `executable=false`, and `real_order_id=null`

Rejected weak signals remain visible in `rejection_breakdown_by_reason` with order-level reasons such as:

- `order.signal_grade_too_low`
- `order.signal_strength_too_low`
- `order.edge_after_cost_too_low`

Paper fills are created only when `OrderCandidateDecision.candidate_generated=true` and the candidate satisfies the audit-only invariant. If a paper fill appears without a valid generated candidate, the soak report emits the blocker `invalid_paper_fill_without_candidate`.

Short smoke runs in ordinary C-grade or low-edge market conditions should now show:

```json
{
  "candidate_decisions_evaluated": 3,
  "candidate_generated_count": 0,
  "candidate_pressure_ratio": "0",
  "paper_trades_count": 0,
  "warnings": [
    {
      "code": "zero_paper_trades",
      "message": "paper soak completed with zero paper trades"
    }
  ],
  "blockers": [],
  "soak_passed": true
}
```

## Phase 8.3: Paper Soak Report Comparison

Phase 8.3 compares two local `PaperSoakReport` JSON files and summarizes stability regressions. The command only reads local files; it does not fetch market data, place orders, call signed endpoints, read API keys, change leverage, or enable live trading.

```sh
cargo run -p cli -- paper compare-reports \
  --baseline data/paper/soak_report_1h.json \
  --candidate data/paper/soak_report_24h.json
```

The comparison report includes:

- metric deltas for `soak_passed`, blocker/warning counts, candidate pressure, candidates, paper trades, open positions, signal strength, edge-after-cost, and paper equity drift
- distribution deltas for rejection reasons, signal grades, and signal directions
- warnings for materially higher candidate pressure, zero trades in both reports, worse equity drift, or materially changed rejection mix
- blockers for unreadable report files, candidate report blockers, `soak_passed=false`, pressure above the blocker threshold, or executable/real-order-id evidence

Example output shape:

```json
{
  "comparison_passed": true,
  "metric_deltas": [
    {
      "metric": "candidate_pressure_ratio",
      "baseline": "0.1",
      "candidate": "0.12",
      "delta": "0.02"
    }
  ],
  "rejection_breakdown_delta": {
    "order.signal_grade_too_low": -4
  },
  "warnings": [],
  "blockers": []
}
```

## Phase 8.3.1: Loop Error Tolerance & Diagnostics

Phase 8.3.1 hardens long paper soaks against tiny public read-only data hiccups. Failed ticks are classified and counted, but they must not generate candidates, paper fills, or paper position mutations.

The soak report now includes:

- `error_rate`, `ticks_failed`, and `max_consecutive_errors`
- `transient_error_count` and `fatal_error_count`
- `error_breakdown_by_reason` with keys such as `transient_market_data_error`, `timeout_error`, `rate_limit_error`, `parse_error`, `state_persistence_error`, `invariant_violation`, and `forbidden_capability_error`

Guardrails:

- `error_rate <= 0.001`, `max_consecutive_errors <= 2`, and `fatal_error_count = 0` emits a warning only
- `error_rate > 0.005` emits `loop_error_rate_excessive`
- `max_consecutive_errors >= 3` emits `consecutive_loop_errors`
- fatal persistence/invariant/forbidden-capability errors emit blockers
- state mutation on a failed tick emits `state_mutation_on_failed_tick`

`paper compare-reports` treats low-rate transient loop warnings as non-blocking. Legacy reports that only contain the old `paper_loop_errors` blocker can also be tolerated when their tick/error counts prove the errors were low-rate and no candidates, fills, positions, or state mutations occurred.

## Phase Roadmap

1. Workspace skeleton, strict domain types, safe config, mock exchange, dry-run CLI health check.
2. Read-only market data adapters for Binance, OKX, and Deribit.
3. SignalPacket construction with regime, cost, execution quality, risk budget, and convexity gates.
4. Cost and liquidity filters with small-account fee attrition protection.
5. Risk budget engine with liquidation, gross notional, daily loss, and tail-event simulation.
6. Dry-run execution router and state reconciliation guard hardening.
7. Reproducible backtest harness with fee, slippage, funding, and reconnect simulations.
8. Paper trading loop with no live order capability.
9. Audit-only canary readiness and paper soak stability gates.
10. Red-team test expansion and failure-mode reports.
11. Future gated live-readiness review. Live execution remains out of scope until explicitly unlocked.

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
