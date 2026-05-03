use domain::{AppResult, FeatureSnapshot, FundingRate, OpenInterest, OrderBook, Price, Symbol};
use rust_decimal::Decimal;

use crate::{cost_features, derivatives_features, liquidity};

const DEFAULT_TARGET_DEPTH_NOTIONAL: i64 = 10_000;
const DEFAULT_ONE_WAY_TAKER_FEE_BPS: i64 = 4;

pub fn build_feature_snapshot(
    exchange: impl Into<String>,
    symbol: Symbol,
    mark_price: Price,
    index_price: Price,
    funding_rate: FundingRate,
    open_interest: OpenInterest,
    orderbook: OrderBook,
) -> AppResult<FeatureSnapshot> {
    let premium = derivatives_features::mark_index_premium(mark_price, index_price);
    let premium_bps = derivatives_features::premium_bps(mark_price, index_price)?;
    let funding_regime = derivatives_features::classify_funding_regime(funding_rate.rate);
    let liquidity =
        liquidity::liquidity_metrics(&orderbook, Decimal::from(DEFAULT_TARGET_DEPTH_NOTIONAL))?;
    let cost = cost_features::basic_cost_estimate(
        liquidity.spread_bps,
        liquidity.liquidity_score,
        Decimal::from(DEFAULT_ONE_WAY_TAKER_FEE_BPS),
    );

    Ok(FeatureSnapshot {
        exchange: exchange.into(),
        symbol,
        mark_price,
        index_price,
        premium,
        premium_bps,
        funding_rate: funding_rate.rate,
        funding_regime,
        open_interest: open_interest.quantity,
        liquidity,
        cost,
    })
}
