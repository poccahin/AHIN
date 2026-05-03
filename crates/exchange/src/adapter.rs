use async_trait::async_trait;
use domain::{
    AppResult, ExchangeInfo, FundingRate, OpenInterest, OrderBook, OrderCandidate, OrderRequest,
    Position, Price,
};

#[async_trait]
pub trait ExchangeAdapter: Send + Sync {
    async fn fetch_exchange_info(&self) -> AppResult<ExchangeInfo>;
    async fn fetch_mark_price(&self, symbol: &str) -> AppResult<Price>;
    async fn fetch_orderbook(&self, symbol: &str) -> AppResult<OrderBook>;
    async fn fetch_funding_rate(&self, symbol: &str) -> AppResult<FundingRate>;
    async fn fetch_open_interest(&self, symbol: &str) -> AppResult<OpenInterest>;
    async fn fetch_positions(&self) -> AppResult<Vec<Position>>;
    async fn place_order_dry_run(&self, order: OrderRequest) -> AppResult<OrderCandidate>;
}
