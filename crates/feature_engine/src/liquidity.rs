use domain::{AppResult, LiquidityMetrics, OrderBook, OrderBookLevel};
use rust_decimal::Decimal;

pub fn spread_bps(orderbook: &OrderBook) -> Decimal {
    orderbook.spread_bps()
}

pub fn bid_depth_within_bps(orderbook: &OrderBook, bps: Decimal) -> Decimal {
    depth_within_bps(&orderbook.bids, mid_price(orderbook), bps, DepthSide::Bid)
}

pub fn ask_depth_within_bps(orderbook: &OrderBook, bps: Decimal) -> Decimal {
    depth_within_bps(&orderbook.asks, mid_price(orderbook), bps, DepthSide::Ask)
}

pub fn orderbook_imbalance(bid_depth: Decimal, ask_depth: Decimal) -> Decimal {
    let total = bid_depth + ask_depth;
    if total <= Decimal::ZERO {
        return Decimal::ZERO;
    }
    (bid_depth - ask_depth) / total
}

pub fn basic_liquidity_score(
    spread_bps: Decimal,
    bid_depth_10bps: Decimal,
    ask_depth_10bps: Decimal,
    imbalance: Decimal,
    target_depth_notional: Decimal,
) -> Decimal {
    if target_depth_notional <= Decimal::ZERO {
        return Decimal::ZERO;
    }

    let spread_score =
        Decimal::ONE - clamp(spread_bps / Decimal::from(20), Decimal::ZERO, Decimal::ONE);
    let depth_score = clamp(
        (bid_depth_10bps + ask_depth_10bps) / target_depth_notional,
        Decimal::ZERO,
        Decimal::ONE,
    );
    let imbalance_score = Decimal::ONE - clamp(imbalance.abs(), Decimal::ZERO, Decimal::ONE);

    clamp(
        (spread_score * Decimal::new(4, 1))
            + (depth_score * Decimal::new(4, 1))
            + (imbalance_score * Decimal::new(2, 1)),
        Decimal::ZERO,
        Decimal::ONE,
    )
}

pub fn liquidity_metrics(
    orderbook: &OrderBook,
    target_depth_notional: Decimal,
) -> AppResult<LiquidityMetrics> {
    let spread_bps = spread_bps(orderbook);
    let bid_depth_5bps = bid_depth_within_bps(orderbook, Decimal::from(5));
    let ask_depth_5bps = ask_depth_within_bps(orderbook, Decimal::from(5));
    let bid_depth_10bps = bid_depth_within_bps(orderbook, Decimal::from(10));
    let ask_depth_10bps = ask_depth_within_bps(orderbook, Decimal::from(10));
    let imbalance = orderbook_imbalance(bid_depth_10bps, ask_depth_10bps);
    let liquidity_score = basic_liquidity_score(
        spread_bps,
        bid_depth_10bps,
        ask_depth_10bps,
        imbalance,
        target_depth_notional,
    );

    Ok(LiquidityMetrics {
        spread_bps,
        bid_depth_5bps,
        ask_depth_5bps,
        bid_depth_10bps,
        ask_depth_10bps,
        imbalance,
        liquidity_score,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DepthSide {
    Bid,
    Ask,
}

fn depth_within_bps(
    levels: &[OrderBookLevel],
    mid_price: Decimal,
    bps: Decimal,
    side: DepthSide,
) -> Decimal {
    if mid_price <= Decimal::ZERO || bps < Decimal::ZERO {
        return Decimal::ZERO;
    }

    let bps_fraction = bps / Decimal::from(10_000);
    let threshold = match side {
        DepthSide::Bid => mid_price * (Decimal::ONE - bps_fraction),
        DepthSide::Ask => mid_price * (Decimal::ONE + bps_fraction),
    };

    levels
        .iter()
        .filter(|level| match side {
            DepthSide::Bid => level.price.as_decimal() >= threshold,
            DepthSide::Ask => level.price.as_decimal() <= threshold,
        })
        .map(|level| level.price.as_decimal() * level.quantity.as_decimal())
        .sum()
}

fn mid_price(orderbook: &OrderBook) -> Decimal {
    (orderbook.bid.as_decimal() + orderbook.ask.as_decimal()) / Decimal::from(2)
}

fn clamp(value: Decimal, min: Decimal, max: Decimal) -> Decimal {
    value.max(min).min(max)
}

#[cfg(test)]
mod tests {
    use domain::{OrderBook, OrderBookLevel, Price, Quantity, Symbol};
    use rust_decimal_macros::dec;

    use super::*;

    #[test]
    fn calculates_spread_bps() {
        let book = sample_book();

        assert_eq!(spread_bps(&book).round_dp(2), dec!(10.00));
    }

    #[test]
    fn sums_depth_within_bps_from_mid_price() {
        let book = sample_book();

        assert_eq!(bid_depth_within_bps(&book, dec!(5)), dec!(10000.0));
        assert_eq!(ask_depth_within_bps(&book, dec!(5)), dec!(10010.0));
        assert_eq!(bid_depth_within_bps(&book, dec!(10)), dec!(29996.00));
        assert_eq!(ask_depth_within_bps(&book, dec!(10)), dec!(30034.00));
    }

    #[test]
    fn calculates_orderbook_imbalance() {
        assert_eq!(orderbook_imbalance(dec!(75), dec!(25)), dec!(0.5));
        assert_eq!(orderbook_imbalance(dec!(0), dec!(0)), dec!(0));
    }

    #[test]
    fn liquidity_score_stays_between_zero_and_one() {
        assert_eq!(
            basic_liquidity_score(dec!(100), dec!(0), dec!(0), dec!(1), dec!(1000)),
            dec!(0.0)
        );
        assert_eq!(
            basic_liquidity_score(dec!(0), dec!(500), dec!(500), dec!(0), dec!(1000)),
            dec!(1.0)
        );
    }

    fn sample_book() -> OrderBook {
        OrderBook::from_levels(
            Symbol::new("BTCUSDT").unwrap(),
            vec![
                level(dec!(100.00), dec!(100)),
                level(dec!(99.98), dec!(200)),
                level(dec!(99.80), dec!(300)),
            ],
            vec![
                level(dec!(100.10), dec!(100)),
                level(dec!(100.12), dec!(200)),
                level(dec!(100.30), dec!(300)),
            ],
        )
        .unwrap()
    }

    fn level(price: Decimal, quantity: Decimal) -> OrderBookLevel {
        OrderBookLevel {
            price: Price::new(price).unwrap(),
            quantity: Quantity::new(quantity).unwrap(),
        }
    }
}
