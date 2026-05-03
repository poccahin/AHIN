use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

use domain::{AppError, AppResult, PaperEngineState, PaperTrade, SignalDirection};
use rust_decimal::Decimal;

use crate::paper_fill;

pub fn load_or_default(path: impl AsRef<Path>) -> AppResult<PaperEngineState> {
    let path = path.as_ref();
    ensure_local_file_path(path)?;
    if !path.exists() {
        return Ok(PaperEngineState::default());
    }

    let raw = fs::read_to_string(path)
        .map_err(|err| AppError::Config(format!("failed to read {}: {err}", path.display())))?;
    serde_json::from_str(&raw).map_err(|err| {
        AppError::Config(format!(
            "failed to parse paper state {}: {err}",
            path.display()
        ))
    })
}

pub fn persist_state(path: impl AsRef<Path>, state: &PaperEngineState) -> AppResult<()> {
    let path = path.as_ref();
    ensure_local_file_path(path)?;
    ensure_parent_dir(path)?;
    let raw = serde_json::to_string_pretty(state)
        .map_err(|err| AppError::Config(format!("failed to render paper state: {err}")))?;
    fs::write(path, raw)
        .map_err(|err| AppError::Config(format!("failed to write {}: {err}", path.display())))
}

pub fn append_trade(path: impl AsRef<Path>, trade: &PaperTrade) -> AppResult<()> {
    let path = path.as_ref();
    ensure_local_file_path(path)?;
    ensure_parent_dir(path)?;
    let raw = serde_json::to_string(trade)
        .map_err(|err| AppError::Config(format!("failed to render paper trade: {err}")))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|err| AppError::Config(format!("failed to open {}: {err}", path.display())))?;
    writeln!(file, "{raw}")
        .map_err(|err| AppError::Config(format!("failed to append {}: {err}", path.display())))
}

pub fn ensure_trade_log(path: impl AsRef<Path>) -> AppResult<()> {
    let path = path.as_ref();
    ensure_local_file_path(path)?;
    ensure_parent_dir(path)?;
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map(|_| ())
        .map_err(|err| AppError::Config(format!("failed to open {}: {err}", path.display())))
}

pub fn apply_trade(state: &mut PaperEngineState, trade: PaperTrade) {
    state.realized_pnl_usdt += trade.realized_pnl_usdt;
    state.total_fees_usdt += trade.fees_usdt;
    state.trades_count += 1;
    state
        .positions
        .push(paper_fill::position_from_trade(&trade));
    refresh_equity(state);
}

pub fn has_open_position(
    state: &PaperEngineState,
    symbol: &domain::Symbol,
    direction: domain::SignalDirection,
) -> bool {
    state
        .positions
        .iter()
        .any(|position| &position.symbol == symbol && position.direction == direction)
}

pub fn mark_positions(state: &mut PaperEngineState, symbol: &domain::Symbol, mark_price: Decimal) {
    for position in state
        .positions
        .iter_mut()
        .filter(|position| &position.symbol == symbol)
    {
        position.mark_price = mark_price;
        position.unrealized_pnl_usdt = unrealized_pnl(
            position.direction,
            position.entry_price,
            mark_price,
            position.notional,
        );
    }
    state.unrealized_pnl_usdt = state
        .positions
        .iter()
        .map(|position| position.unrealized_pnl_usdt)
        .sum();
    refresh_equity(state);
}

pub fn ensure_local_file_path(path: &Path) -> AppResult<()> {
    let raw = path.as_os_str().to_string_lossy();
    if raw.trim().is_empty() || raw.contains("://") || path.file_name().is_none() {
        return Err(AppError::Config(format!(
            "paper path must be a local file path: {}",
            path.display()
        )));
    }
    Ok(())
}

fn ensure_parent_dir(path: &Path) -> AppResult<()> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|err| {
            AppError::Config(format!("failed to create {}: {err}", parent.display()))
        })?;
    }
    Ok(())
}

fn unrealized_pnl(
    direction: SignalDirection,
    entry_price: Decimal,
    mark_price: Decimal,
    notional: Decimal,
) -> Decimal {
    if entry_price <= Decimal::ZERO {
        return Decimal::ZERO;
    }

    let move_pct = match direction {
        SignalDirection::Long => (mark_price - entry_price) / entry_price,
        SignalDirection::Short => (entry_price - mark_price) / entry_price,
        SignalDirection::Neutral => Decimal::ZERO,
    };
    notional * move_pct
}

fn refresh_equity(state: &mut PaperEngineState) {
    state.account_equity_usdt =
        state.starting_equity_usdt + state.realized_pnl_usdt + state.unrealized_pnl_usdt;
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use domain::PaperEngineState;
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn paper_state_round_trips() {
        let path = fixture_path("paper_state.json");
        let state = PaperEngineState {
            ticks_processed: 2,
            realized_pnl_usdt: dec!(-0.1),
            ..Default::default()
        };

        persist_state(&path, &state).unwrap();
        let loaded = load_or_default(&path).unwrap();

        assert_eq!(loaded, state);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn state_and_log_paths_are_local_files_only() {
        let err =
            ensure_local_file_path(Path::new("https://example.com/paper_state.json")).unwrap_err();

        assert!(err.to_string().contains("local file path"));
        assert!(ensure_local_file_path(Path::new("data/paper/paper_state.json")).is_ok());
    }

    fn fixture_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("rustquanteth-{name}-{}", std::process::id()))
    }
}
