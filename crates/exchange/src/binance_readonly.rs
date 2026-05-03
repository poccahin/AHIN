use async_trait::async_trait;
use domain::{
    AppError, AppResult, ExchangeInfo, FundingRate, OpenInterest, OrderBook, OrderCandidate,
    OrderRequest, Position, Price,
};

use crate::ExchangeAdapter;

#[derive(Debug, Default, Clone)]
pub struct BinanceReadonly;

#[async_trait]
impl ExchangeAdapter for BinanceReadonly {
    async fn fetch_exchange_info(&self) -> AppResult<ExchangeInfo> {
        Err(readonly_stub())
    }

    async fn fetch_mark_price(&self, _symbol: &str) -> AppResult<Price> {
        Err(readonly_stub())
    }

    async fn fetch_orderbook(&self, _symbol: &str) -> AppResult<OrderBook> {
        Err(readonly_stub())
    }

    async fn fetch_funding_rate(&self, _symbol: &str) -> AppResult<FundingRate> {
        Err(readonly_stub())
    }

    async fn fetch_open_interest(&self, _symbol: &str) -> AppResult<OpenInterest> {
        Err(readonly_stub())
    }

    async fn fetch_positions(&self) -> AppResult<Vec<Position>> {
        Err(readonly_stub())
    }

    async fn place_order_dry_run(&self, _order: OrderRequest) -> AppResult<OrderCandidate> {
        Err(AppError::ExecutionRejected(
            "Binance phase-one adapter cannot place or simulate orders".to_string(),
        ))
    }
}

fn readonly_stub() -> AppError {
    AppError::Exchange("Binance read-only adapter is not wired in phase one".to_string())
}
