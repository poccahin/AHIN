use async_trait::async_trait;
use domain::{
    AppError, AppResult, EngineMode, ExchangeInfo, FundingRate, Leverage, Notional, OpenInterest,
    OrderBook, OrderBookLevel, OrderCandidate, OrderRequest, Position, Price, Quantity, Symbol,
};
use rust_decimal::Decimal;

use crate::adapter::ExchangeAdapter;

#[derive(Debug, Clone)]
pub struct MockExchange {
    exchange_info: ExchangeInfo,
    positions: Vec<Position>,
    websocket_connected: bool,
    funding_interval_hours: u32,
}

impl Default for MockExchange {
    fn default() -> Self {
        Self {
            exchange_info: ExchangeInfo {
                symbols: vec![Symbol::new("BTCUSDT").expect("static symbol is valid")],
                min_notional: Notional::new(Decimal::from(5)).expect("static notional is valid"),
                max_leverage: Leverage::max_phase_one(Decimal::from(5))
                    .expect("static leverage is valid"),
            },
            positions: Vec::new(),
            websocket_connected: true,
            funding_interval_hours: 8,
        }
    }
}

impl MockExchange {
    pub fn with_positions(mut self, positions: Vec<Position>) -> Self {
        self.positions = positions;
        self
    }

    pub fn disconnected(mut self) -> Self {
        self.websocket_connected = false;
        self
    }

    pub fn with_funding_interval_hours(mut self, interval_hours: u32) -> Self {
        self.funding_interval_hours = interval_hours;
        self
    }
}

#[async_trait]
impl ExchangeAdapter for MockExchange {
    async fn fetch_exchange_info(&self) -> AppResult<ExchangeInfo> {
        Ok(self.exchange_info.clone())
    }

    async fn fetch_mark_price(&self, symbol: &str) -> AppResult<Price> {
        ensure_connected(self.websocket_connected)?;
        ensure_symbol(symbol)?;
        Price::new(Decimal::from(100))
    }

    async fn fetch_orderbook(&self, symbol: &str) -> AppResult<OrderBook> {
        ensure_connected(self.websocket_connected)?;
        let bids = vec![OrderBookLevel {
            price: Price::new(Decimal::from(99))?,
            quantity: Quantity::new(Decimal::from(10))?,
        }];
        let asks = vec![OrderBookLevel {
            price: Price::new(Decimal::from(101))?,
            quantity: Quantity::new(Decimal::from(10))?,
        }];
        OrderBook::from_levels(ensure_symbol(symbol)?, bids, asks)
    }

    async fn fetch_funding_rate(&self, symbol: &str) -> AppResult<FundingRate> {
        ensure_connected(self.websocket_connected)?;
        Ok(FundingRate {
            symbol: ensure_symbol(symbol)?,
            rate: Decimal::new(1, 4),
            interval_hours: self.funding_interval_hours,
        })
    }

    async fn fetch_open_interest(&self, symbol: &str) -> AppResult<OpenInterest> {
        ensure_connected(self.websocket_connected)?;
        Ok(OpenInterest {
            symbol: ensure_symbol(symbol)?,
            quantity: Quantity::new(Decimal::from(1000))?,
        })
    }

    async fn fetch_positions(&self) -> AppResult<Vec<Position>> {
        ensure_connected(self.websocket_connected)?;
        Ok(self.positions.clone())
    }

    async fn place_order_dry_run(&self, order: OrderRequest) -> AppResult<OrderCandidate> {
        ensure_connected(self.websocket_connected)?;
        let notional = order.notional()?;
        if notional < self.exchange_info.min_notional {
            return Err(AppError::ExecutionRejected(format!(
                "notional {} is below exchange min notional {}",
                notional.as_decimal(),
                self.exchange_info.min_notional.as_decimal()
            )));
        }
        if order.leverage > self.exchange_info.max_leverage {
            return Err(AppError::ExecutionRejected(format!(
                "leverage {} exceeds mock exchange max {}",
                order.leverage.as_decimal(),
                self.exchange_info.max_leverage.as_decimal()
            )));
        }

        Ok(OrderCandidate {
            candidate_id: format!("dryrun-{}", order.client_order_id),
            symbol: order.symbol,
            side: order.side,
            price: order.price,
            quantity: order.quantity,
            notional,
            leverage: order.leverage,
            mode: EngineMode::DryRun,
            reduce_only: order.reduce_only,
            dry_run: true,
            exchange_order_id: None,
            rationale: "mock exchange dry-run candidate; no real order was placed".to_string(),
        })
    }
}

fn ensure_symbol(symbol: &str) -> AppResult<Symbol> {
    Symbol::new(symbol)
}

fn ensure_connected(connected: bool) -> AppResult<()> {
    if !connected {
        return Err(AppError::Exchange(
            "mock websocket disconnected; market data is stale".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use domain::Side;
    use rust_decimal_macros::dec;

    use super::*;

    #[tokio::test]
    async fn dry_run_order_candidate_never_has_real_order_id() {
        let exchange = MockExchange::default();
        let request = OrderRequest {
            symbol: Symbol::new("BTCUSDT").unwrap(),
            side: Side::Buy,
            price: Price::new(dec!(100)).unwrap(),
            quantity: Quantity::new(dec!(0.2)).unwrap(),
            leverage: Leverage::max_phase_one(dec!(2)).unwrap(),
            reduce_only: false,
            client_order_id: "unit-test".to_string(),
        };

        let candidate = exchange.place_order_dry_run(request).await.unwrap();

        assert!(candidate.is_dry_run_only());
        assert!(candidate.exchange_order_id.is_none());
    }

    #[tokio::test]
    async fn disconnected_mock_rejects_market_data() {
        let exchange = MockExchange::default().disconnected();

        assert!(exchange.fetch_mark_price("BTCUSDT").await.is_err());
    }
}
