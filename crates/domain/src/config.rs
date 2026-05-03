use std::{fs, path::Path};

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::{AppError, AppResult, EngineMode};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct EngineConfig {
    pub safety: SafetyConfig,
    pub account: AccountConfig,
    pub execution: ExecutionConfig,
    pub symbols: Vec<String>,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            safety: SafetyConfig::default(),
            account: AccountConfig::default(),
            execution: ExecutionConfig::default(),
            symbols: vec!["BTCUSDT".to_string()],
        }
    }
}

impl EngineConfig {
    pub fn load_from_path(path: impl AsRef<Path>) -> AppResult<Self> {
        let path = path.as_ref();
        let raw = fs::read_to_string(path)
            .map_err(|err| AppError::Config(format!("failed to read {}: {err}", path.display())))?;
        toml::from_str(&raw)
            .map_err(|err| AppError::Config(format!("failed to parse {}: {err}", path.display())))
    }

    pub fn validate_safety(&self) -> AppResult<()> {
        if self.safety.allow_live_trading {
            return Err(AppError::UnsafeConfig(
                "ALLOW_LIVE_TRADING must default to false and is not implemented".to_string(),
            ));
        }
        if self.safety.allow_live_100x {
            return Err(AppError::UnsafeConfig(
                "ALLOW_LIVE_100X must remain false".to_string(),
            ));
        }
        if self.safety.max_leverage > Decimal::from(5) {
            return Err(AppError::UnsafeConfig(
                "phase-one config cannot allow leverage above 5x".to_string(),
            ));
        }
        if self.account.starting_equity <= Decimal::ZERO {
            return Err(AppError::UnsafeConfig(
                "starting equity must be positive".to_string(),
            ));
        }
        if self.account.risk_reserve < Decimal::ZERO
            || self.account.risk_reserve >= self.account.starting_equity
        {
            return Err(AppError::UnsafeConfig(
                "risk reserve must be non-negative and below starting equity".to_string(),
            ));
        }
        if self.symbols.is_empty() {
            return Err(AppError::UnsafeConfig(
                "at least one symbol must be configured".to_string(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SafetyConfig {
    pub allow_live_trading: bool,
    pub allow_live_100x: bool,
    pub max_leverage: Decimal,
    pub max_order_notional: Decimal,
}

impl Default for SafetyConfig {
    fn default() -> Self {
        Self {
            allow_live_trading: false,
            allow_live_100x: false,
            max_leverage: Decimal::from(5),
            max_order_notional: Decimal::from(20),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AccountConfig {
    pub starting_equity: Decimal,
    pub risk_reserve: Decimal,
}

impl Default for AccountConfig {
    fn default() -> Self {
        Self {
            starting_equity: Decimal::from(200),
            risk_reserve: Decimal::from(80),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ExecutionConfig {
    pub mode: EngineMode,
    pub min_notional: Decimal,
    pub dry_run: bool,
}

impl Default for ExecutionConfig {
    fn default() -> Self {
        Self {
            mode: EngineMode::DryRun,
            min_notional: Decimal::from(5),
            dry_run: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn default_config_is_research_safe() {
        let config = EngineConfig::default();

        assert!(!config.safety.allow_live_trading);
        assert!(!config.safety.allow_live_100x);
        assert_eq!(config.safety.max_leverage, dec!(5));
        assert_eq!(config.account.starting_equity, dec!(200));
        assert!(config.validate_safety().is_ok());
    }

    #[test]
    fn rejects_leverage_above_phase_one_cap() {
        let mut config = EngineConfig::default();
        config.safety.max_leverage = dec!(10);

        assert!(config.validate_safety().is_err());
    }

    #[test]
    fn rejects_live_trading_flag() {
        let mut config = EngineConfig::default();
        config.safety.allow_live_trading = true;

        assert!(config.validate_safety().is_err());
    }
}
