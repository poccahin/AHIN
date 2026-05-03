use rust_decimal::Decimal;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrendSignal {
    StrongBull,
    StrongBear,
    WeakBull,
    WeakBear,
    Neutral,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HedgeSide {
    Long,
    Short,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct V11Config {
    pub initial_base: Decimal,
    pub stage_two_profit_threshold: Decimal,
    pub stage_three_profit_threshold: Decimal,
    pub stage_two_base: Decimal,
    pub stage_three_base: Decimal,
    pub leverage: Decimal,
    pub total_exposure_pct: Decimal,
    pub boundary_effect_pct: Decimal,
    pub take_profit_pct: Decimal,
    pub stop_atr_multiple: Decimal,
    pub max_holding_hours: u32,
    pub taker_fee_rate: Decimal,
    pub neutral_threshold_pct: Decimal,
}

impl Default for V11Config {
    fn default() -> Self {
        Self {
            initial_base: Decimal::from(200),
            stage_two_profit_threshold: Decimal::from(1_000),
            stage_three_profit_threshold: Decimal::from(10_000),
            stage_two_base: Decimal::from(1_000),
            stage_three_base: Decimal::from(10_000),
            leverage: Decimal::from(200),
            total_exposure_pct: Decimal::from(720),
            boundary_effect_pct: Decimal::from(360),
            take_profit_pct: Decimal::new(5, 2),
            stop_atr_multiple: Decimal::from(3),
            max_holding_hours: 168,
            taker_fee_rate: Decimal::new(55, 5),
            neutral_threshold_pct: Decimal::new(1, 3),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PositionTargets {
    pub net_exposure_pct: Decimal,
    pub long_pct: Decimal,
    pub short_pct: Decimal,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PositionPlan {
    pub long_notional: Decimal,
    pub short_notional: Decimal,
    pub long_margin: Decimal,
    pub short_margin: Decimal,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DailySettlement {
    pub stage_base: Decimal,
    pub protected_cash: Decimal,
    pub withdrawal: Decimal,
    pub retained_equity: Decimal,
}

pub fn classify_signal(
    ema6: Decimal,
    ema24: Decimal,
    ema72: Decimal,
    neutral_threshold_pct: Decimal,
) -> TrendSignal {
    if ema24 > Decimal::ZERO && ((ema6 - ema24).abs() / ema24) < neutral_threshold_pct {
        return TrendSignal::Neutral;
    }

    if ema6 > ema24 && ema24 > ema72 {
        TrendSignal::StrongBull
    } else if ema6 < ema24 && ema24 < ema72 {
        TrendSignal::StrongBear
    } else if ema6 > ema24 {
        TrendSignal::WeakBull
    } else if ema6 < ema24 {
        TrendSignal::WeakBear
    } else {
        TrendSignal::Neutral
    }
}

pub fn targets_for_signal(signal: TrendSignal, config: V11Config) -> PositionTargets {
    let net = match signal {
        TrendSignal::StrongBull => Decimal::from(50),
        TrendSignal::StrongBear => Decimal::from(-50),
        TrendSignal::WeakBull | TrendSignal::WeakBear | TrendSignal::Neutral => Decimal::ZERO,
    };

    PositionTargets {
        net_exposure_pct: net,
        long_pct: (config.total_exposure_pct + net) / Decimal::from(2),
        short_pct: (config.total_exposure_pct - net) / Decimal::from(2),
    }
}

pub fn stage_base_for_realized_profit(realized_profit: Decimal, config: V11Config) -> Decimal {
    if realized_profit >= config.stage_three_profit_threshold {
        config.stage_three_base
    } else if realized_profit >= config.stage_two_profit_threshold {
        config.stage_two_base
    } else {
        config.initial_base
    }
}

pub fn position_plan(
    stage_base: Decimal,
    targets: PositionTargets,
    config: V11Config,
) -> PositionPlan {
    let long_notional = stage_base * targets.long_pct / Decimal::from(100);
    let short_notional = stage_base * targets.short_pct / Decimal::from(100);

    PositionPlan {
        long_notional,
        short_notional,
        long_margin: long_notional / config.leverage,
        short_margin: short_notional / config.leverage,
    }
}

pub fn leg_unrealized_pnl(
    side: HedgeSide,
    entry_price: Decimal,
    current_price: Decimal,
    notional: Decimal,
) -> Decimal {
    if entry_price <= Decimal::ZERO {
        return Decimal::ZERO;
    }

    let move_pct = match side {
        HedgeSide::Long => (current_price - entry_price) / entry_price,
        HedgeSide::Short => (entry_price - current_price) / entry_price,
    };

    // Notional already includes leverage. Multiplying by leverage again would
    // overstate futures PnL by 200x and produce impossible backtest returns.
    notional * move_pct
}

pub fn one_way_fee(notional: Decimal, config: V11Config) -> Decimal {
    notional * config.taker_fee_rate
}

pub fn take_profit_hit(
    side: HedgeSide,
    entry_price: Decimal,
    current_price: Decimal,
    config: V11Config,
) -> bool {
    if entry_price <= Decimal::ZERO {
        return false;
    }
    let move_pct = match side {
        HedgeSide::Long => (current_price - entry_price) / entry_price,
        HedgeSide::Short => (entry_price - current_price) / entry_price,
    };
    move_pct >= config.take_profit_pct
}

pub fn atr_stop_hit(
    side: HedgeSide,
    entry_price: Decimal,
    current_price: Decimal,
    atr: Decimal,
    config: V11Config,
) -> bool {
    if atr <= Decimal::ZERO {
        return false;
    }
    let stop_distance = atr * config.stop_atr_multiple;
    match side {
        HedgeSide::Long => current_price <= entry_price - stop_distance,
        HedgeSide::Short => current_price >= entry_price + stop_distance,
    }
}

pub fn should_expire_loss(
    entry_hour_index: u64,
    current_hour_index: u64,
    unrealized_pnl: Decimal,
    config: V11Config,
) -> bool {
    current_hour_index.saturating_sub(entry_hour_index) >= u64::from(config.max_holding_hours)
        && unrealized_pnl < Decimal::ZERO
}

pub fn daily_settlement(
    equity: Decimal,
    open_margin: Decimal,
    realized_profit: Decimal,
    config: V11Config,
) -> DailySettlement {
    let stage_base = stage_base_for_realized_profit(realized_profit, config);
    let protected_cash = (stage_base - open_margin).max(Decimal::ZERO);
    let withdrawal = if equity > stage_base {
        equity - stage_base
    } else {
        Decimal::ZERO
    };

    DailySettlement {
        stage_base,
        protected_cash,
        withdrawal,
        retained_equity: equity - withdrawal,
    }
}

#[cfg(test)]
mod tests {
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn maps_v11_signals_to_target_exposures() {
        let config = V11Config::default();

        let strong_bull = targets_for_signal(TrendSignal::StrongBull, config);
        assert_eq!(strong_bull.net_exposure_pct, dec!(50));
        assert_eq!(strong_bull.long_pct, dec!(385));
        assert_eq!(strong_bull.short_pct, dec!(335));

        let strong_bear = targets_for_signal(TrendSignal::StrongBear, config);
        assert_eq!(strong_bear.net_exposure_pct, dec!(-50));
        assert_eq!(strong_bear.long_pct, dec!(335));
        assert_eq!(strong_bear.short_pct, dec!(385));

        let weak_bull = targets_for_signal(TrendSignal::WeakBull, config);
        assert_eq!(weak_bull.net_exposure_pct, dec!(0));
        assert_eq!(weak_bull.long_pct, dec!(360));
        assert_eq!(weak_bull.short_pct, dec!(360));
    }

    #[test]
    fn plans_200x_margin_from_stage_base() {
        let config = V11Config::default();
        let targets = targets_for_signal(TrendSignal::StrongBull, config);
        let plan = position_plan(dec!(200), targets, config);

        assert_eq!(plan.long_notional, dec!(770));
        assert_eq!(plan.short_notional, dec!(670));
        assert_eq!(plan.long_margin, dec!(3.85));
        assert_eq!(plan.short_margin, dec!(3.35));
    }

    #[test]
    fn pnl_uses_notional_without_double_counting_leverage() {
        let pnl = leg_unrealized_pnl(HedgeSide::Long, dec!(3000), dec!(3150), dec!(770));

        assert_eq!(pnl, dec!(38.5));
    }

    #[test]
    fn scenario_c_stage_base_advances_with_realized_profit() {
        let config = V11Config::default();

        assert_eq!(
            stage_base_for_realized_profit(dec!(999.99), config),
            dec!(200)
        );
        assert_eq!(
            stage_base_for_realized_profit(dec!(1000), config),
            dec!(1000)
        );
        assert_eq!(
            stage_base_for_realized_profit(dec!(10000), config),
            dec!(10000)
        );
    }

    #[test]
    fn settlement_withdraws_only_above_active_stage_base() {
        let config = V11Config::default();
        let settlement = daily_settlement(dec!(28026), dec!(72), dec!(10000), config);

        assert_eq!(settlement.stage_base, dec!(10000));
        assert_eq!(settlement.protected_cash, dec!(9928));
        assert_eq!(settlement.withdrawal, dec!(18026));
        assert_eq!(settlement.retained_equity, dec!(10000));
    }

    #[test]
    fn exit_rules_match_v11_parameters() {
        let config = V11Config::default();

        assert!(take_profit_hit(
            HedgeSide::Long,
            dec!(100),
            dec!(105),
            config
        ));
        assert!(take_profit_hit(
            HedgeSide::Short,
            dec!(100),
            dec!(95),
            config
        ));
        assert!(atr_stop_hit(
            HedgeSide::Long,
            dec!(100),
            dec!(91),
            dec!(3),
            config
        ));
        assert!(atr_stop_hit(
            HedgeSide::Short,
            dec!(100),
            dec!(109),
            dec!(3),
            config
        ));
        assert!(should_expire_loss(0, 168, dec!(-1), config));
        assert!(!should_expire_loss(0, 168, dec!(1), config));
    }
}
