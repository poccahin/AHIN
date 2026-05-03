# AGENTS.md

## Project Mission

Build a Rust-based research-only and paper-trading engine for a 200 USDT derivatives-aware convex signal system.

The system must prioritize capital survival, state correctness, reproducible backtests, and safe dry-run order generation.

## Hard Safety Rules

- Do not implement live trading by default.
- Do not place real orders.
- Do not read private keys or API secrets unless explicitly required for a later gated phase.
- Do not hardcode secrets.
- Default all execution to research-only, paper, or dry-run.
- `ALLOW_LIVE_TRADING=false` must be the default.
- `ALLOW_LIVE_100X=false` must always be the default.
- Any future live code must require explicit config, environment variable, and two-step confirmation.
- Do not add unsafe code.

## Engineering Standards

- Rust workspace with clear crates.
- Use strict typing.
- Use `rust_decimal` or equivalent for monetary math.
- Use `Result<T, AppError>` for fallible operations.
- Add unit tests for every risk module.
- Add integration tests for state recovery and dry-run execution.
- Comments should explain why a safety check exists, not merely what the code does.

## Trading Philosophy

The system is not a signal bot.

It is a derivatives-aware convex risk engine:

`Trade = Signal x Regime x EdgeAfterCost x ExecutionQuality x RiskBudget x Convexity`

If any component is invalid, no trade candidate may be produced.

## Required Phases

1. Create workspace skeleton.
2. Implement domain types.
3. Implement read-only market data interfaces.
4. Implement `SignalPacket`.
5. Implement cost and liquidity filters.
6. Implement risk budget engine.
7. Implement dry-run order candidates.
8. Implement backtest harness.
9. Implement paper trading loop.
10. Implement red-team tests.

## Definition of Done

Every phase must include:

- Compiling code
- Unit tests
- Example config
- CLI command
- README update
- No live orders

