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
        if self.safety.allow_live_orders {
            return Err(AppError::UnsafeConfig(
                "ALLOW_LIVE_ORDERS must default to false and is not implemented".to_string(),
            ));
        }
        if self.safety.allow_signed_endpoints {
            return Err(AppError::UnsafeConfig(
                "signed/private endpoints must remain disabled".to_string(),
            ));
        }
        if self.safety.allow_api_key_loading {
            return Err(AppError::UnsafeConfig(
                "API key loading must remain disabled by default".to_string(),
            ));
        }
        if self.safety.allow_withdrawals {
            return Err(AppError::UnsafeConfig(
                "withdrawal execution must remain disabled".to_string(),
            ));
        }
        if self.safety.allow_leverage_changes {
            return Err(AppError::UnsafeConfig(
                "leverage-changing logic must remain disabled".to_string(),
            ));
        }
        if self.safety.max_live_micro_notional_usdt > Decimal::ZERO {
            return Err(AppError::UnsafeConfig(
                "max_live_micro_notional_usdt must remain 0 until a future gated phase".to_string(),
            ));
        }
        if !self.safety.manual_confirmation_required {
            return Err(AppError::UnsafeConfig(
                "manual confirmation must remain required".to_string(),
            ));
        }
        if !self.safety.two_step_confirmation_required {
            return Err(AppError::UnsafeConfig(
                "two-step confirmation must remain required".to_string(),
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
    pub allow_live_orders: bool,
    pub allow_signed_endpoints: bool,
    pub allow_api_key_loading: bool,
    pub allow_withdrawals: bool,
    pub allow_leverage_changes: bool,
    pub max_leverage: Decimal,
    pub max_order_notional: Decimal,
    pub max_live_micro_notional_usdt: Decimal,
    pub manual_confirmation_required: bool,
    pub two_step_confirmation_required: bool,
}

impl Default for SafetyConfig {
    fn default() -> Self {
        Self {
            allow_live_trading: false,
            allow_live_100x: false,
            allow_live_orders: false,
            allow_signed_endpoints: false,
            allow_api_key_loading: false,
            allow_withdrawals: false,
            allow_leverage_changes: false,
            max_leverage: Decimal::from(5),
            max_order_notional: Decimal::from(20),
            max_live_micro_notional_usdt: Decimal::ZERO,
            manual_confirmation_required: true,
            two_step_confirmation_required: true,
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
        assert!(!config.safety.allow_live_orders);
        assert!(!config.safety.allow_signed_endpoints);
        assert!(!config.safety.allow_api_key_loading);
        assert!(!config.safety.allow_withdrawals);
        assert!(!config.safety.allow_leverage_changes);
        assert_eq!(config.safety.max_leverage, dec!(5));
        assert_eq!(config.safety.max_live_micro_notional_usdt, dec!(0));
        assert!(config.safety.manual_confirmation_required);
        assert!(config.safety.two_step_confirmation_required);
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

    #[test]
    fn rejects_live_order_capability_flags() {
        let mut config = EngineConfig::default();
        config.safety.allow_live_orders = true;
        assert!(config.validate_safety().is_err());

        let mut config = EngineConfig::default();
        config.safety.allow_signed_endpoints = true;
        assert!(config.validate_safety().is_err());

        let mut config = EngineConfig::default();
        config.safety.allow_api_key_loading = true;
        assert!(config.validate_safety().is_err());
    }
}
