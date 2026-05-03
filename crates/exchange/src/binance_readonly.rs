use std::{str::FromStr, time::Duration};

use async_trait::async_trait;
use domain::{
    AppError, AppResult, ExchangeInfo, FundingRate, Leverage, Notional, OpenInterest, OrderBook,
    OrderBookLevel, OrderCandidate, OrderRequest, Position, Price, Quantity, Symbol,
};
use reqwest::StatusCode;
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::Value;
use tokio::time::sleep;

use crate::ExchangeAdapter;

const EXCHANGE: &str = "binance_usdm";
const DEFAULT_BASE_URL: &str = "https://fapi.binance.com";
const EXCHANGE_INFO_ENDPOINT: &str = "/fapi/v1/exchangeInfo";
const MARK_PRICE_ENDPOINT: &str = "/fapi/v1/premiumIndex";
const FUNDING_RATE_ENDPOINT: &str = "/fapi/v1/fundingRate";
const OPEN_INTEREST_ENDPOINT: &str = "/fapi/v1/openInterest";
const ORDERBOOK_ENDPOINT: &str = "/fapi/v1/depth";
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_RETRIES: usize = 2;

#[derive(Debug, Clone)]
pub struct BinanceReadonly {
    base_url: String,
    client: reqwest::Client,
    retries: usize,
}

impl Default for BinanceReadonly {
    fn default() -> Self {
        Self::new(DEFAULT_BASE_URL, DEFAULT_TIMEOUT, DEFAULT_RETRIES)
            .expect("static Binance read-only HTTP client config is valid")
    }
}

impl BinanceReadonly {
    pub fn new(base_url: impl Into<String>, timeout: Duration, retries: usize) -> AppResult<Self> {
        let client = reqwest::Client::builder()
            .timeout(timeout)
            .user_agent("convex-evergreen-engine/0.1 read-only-market-data")
            .build()
            .map_err(|err| {
                AppError::Config(format!("failed to build Binance HTTP client: {err}"))
            })?;

        Ok(Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            client,
            retries,
        })
    }

    pub fn production() -> Self {
        Self::default()
    }

    pub async fn fetch_orderbook_depth(&self, symbol: &str, depth: u16) -> AppResult<OrderBook> {
        let depth = validate_depth(depth)?;
        let response: BinanceDepthResponse = self
            .get_json(
                ORDERBOOK_ENDPOINT,
                &[
                    ("symbol", normalize_symbol(symbol)?),
                    ("limit", depth.to_string()),
                ],
            )
            .await?;
        response.into_orderbook(symbol)
    }

    pub async fn fetch_mark_index_prices(&self, symbol: &str) -> AppResult<(Price, Price)> {
        let response: BinanceMarkPriceResponse = self
            .get_json(
                MARK_PRICE_ENDPOINT,
                &[("symbol", normalize_symbol(symbol)?)],
            )
            .await?;
        response.into_prices()
    }

    async fn get_json<T>(&self, endpoint: &'static str, query: &[(&str, String)]) -> AppResult<T>
    where
        T: for<'de> Deserialize<'de>,
    {
        let url = format!("{}{}", self.base_url, endpoint);
        let mut last_error = None;

        for attempt in 0..=self.retries {
            let response = self.client.get(&url).query(query).send().await;
            match response {
                Ok(response) => match self.parse_response(endpoint, response).await {
                    Ok(parsed) => return Ok(parsed),
                    Err(err) if should_retry_error(&err) && attempt < self.retries => {
                        last_error = Some(err);
                    }
                    Err(err) => return Err(err),
                },
                Err(err) if attempt < self.retries => {
                    last_error = Some(AppError::HttpRequest {
                        exchange: EXCHANGE.to_string(),
                        endpoint: endpoint.to_string(),
                        reason: err.to_string(),
                    });
                }
                Err(err) => {
                    return Err(AppError::HttpRequest {
                        exchange: EXCHANGE.to_string(),
                        endpoint: endpoint.to_string(),
                        reason: err.to_string(),
                    });
                }
            }

            sleep(backoff_for_attempt(attempt)).await;
        }

        Err(last_error.unwrap_or_else(|| AppError::HttpRequest {
            exchange: EXCHANGE.to_string(),
            endpoint: endpoint.to_string(),
            reason: "request retry loop exhausted without a response".to_string(),
        }))
    }

    async fn parse_response<T>(
        &self,
        endpoint: &'static str,
        response: reqwest::Response,
    ) -> AppResult<T>
    where
        T: for<'de> Deserialize<'de>,
    {
        let status = response.status();
        let body = response.text().await.map_err(|err| AppError::HttpRequest {
            exchange: EXCHANGE.to_string(),
            endpoint: endpoint.to_string(),
            reason: format!("failed to read response body: {err}"),
        })?;

        if !status.is_success() {
            return Err(AppError::HttpStatus {
                exchange: EXCHANGE.to_string(),
                endpoint: endpoint.to_string(),
                status: status.as_u16(),
                body,
            });
        }

        serde_json::from_str(&body).map_err(|err| AppError::ResponseParse {
            exchange: EXCHANGE.to_string(),
            endpoint: endpoint.to_string(),
            reason: err.to_string(),
        })
    }
}

#[async_trait]
impl ExchangeAdapter for BinanceReadonly {
    async fn fetch_exchange_info(&self) -> AppResult<ExchangeInfo> {
        let response: BinanceExchangeInfoResponse =
            self.get_json(EXCHANGE_INFO_ENDPOINT, &[]).await?;
        response.into_exchange_info()
    }

    async fn fetch_mark_price(&self, symbol: &str) -> AppResult<Price> {
        let (mark_price, _) = self.fetch_mark_index_prices(symbol).await?;
        Ok(mark_price)
    }

    async fn fetch_orderbook(&self, symbol: &str) -> AppResult<OrderBook> {
        self.fetch_orderbook_depth(symbol, 20).await
    }

    async fn fetch_funding_rate(&self, symbol: &str) -> AppResult<FundingRate> {
        let response: Vec<BinanceFundingRateResponse> = self
            .get_json(
                FUNDING_RATE_ENDPOINT,
                &[
                    ("symbol", normalize_symbol(symbol)?),
                    ("limit", "2".to_string()),
                ],
            )
            .await?;
        let latest = response.last().ok_or_else(|| AppError::ResponseParse {
            exchange: EXCHANGE.to_string(),
            endpoint: FUNDING_RATE_ENDPOINT.to_string(),
            reason: "funding rate response was empty".to_string(),
        })?;
        let interval_hours = infer_funding_interval_hours(&response);

        Ok(FundingRate {
            symbol: Symbol::new(&latest.symbol)?,
            rate: parse_decimal(FUNDING_RATE_ENDPOINT, "fundingRate", &latest.funding_rate)?,
            interval_hours,
        })
    }

    async fn fetch_open_interest(&self, symbol: &str) -> AppResult<OpenInterest> {
        let response: BinanceOpenInterestResponse = self
            .get_json(
                OPEN_INTEREST_ENDPOINT,
                &[("symbol", normalize_symbol(symbol)?)],
            )
            .await?;

        Ok(OpenInterest {
            symbol: Symbol::new(&response.symbol)?,
            quantity: Quantity::new(parse_decimal(
                OPEN_INTEREST_ENDPOINT,
                "openInterest",
                &response.open_interest,
            )?)?,
        })
    }

    async fn fetch_positions(&self) -> AppResult<Vec<Position>> {
        Err(AppError::Exchange(
            "Binance public read-only adapter cannot fetch positions because that requires a signed private endpoint"
                .to_string(),
        ))
    }

    async fn place_order_dry_run(&self, _order: OrderRequest) -> AppResult<OrderCandidate> {
        Err(AppError::ExecutionRejected(
            "Binance public read-only adapter does not implement order placement or simulation"
                .to_string(),
        ))
    }
}

#[derive(Debug, Deserialize)]
struct BinanceExchangeInfoResponse {
    symbols: Vec<BinanceSymbolInfo>,
}

impl BinanceExchangeInfoResponse {
    fn into_exchange_info(self) -> AppResult<ExchangeInfo> {
        let mut symbols = Vec::new();
        let mut min_notional: Option<Decimal> = None;

        for symbol in self.symbols {
            if symbol.status != "TRADING" {
                continue;
            }
            symbols.push(Symbol::new(&symbol.symbol)?);

            for filter in symbol.filters {
                if filter.get("filterType").and_then(Value::as_str) == Some("MIN_NOTIONAL") {
                    let Some(raw_notional) = filter.get("notional").and_then(Value::as_str) else {
                        return Err(AppError::ResponseParse {
                            exchange: EXCHANGE.to_string(),
                            endpoint: EXCHANGE_INFO_ENDPOINT.to_string(),
                            reason: "MIN_NOTIONAL filter missing notional".to_string(),
                        });
                    };
                    let parsed = parse_decimal(
                        EXCHANGE_INFO_ENDPOINT,
                        "MIN_NOTIONAL.notional",
                        raw_notional,
                    )?;
                    min_notional = Some(match min_notional {
                        Some(current) => current.min(parsed),
                        None => parsed,
                    });
                }
            }
        }

        if symbols.is_empty() {
            return Err(AppError::ResponseParse {
                exchange: EXCHANGE.to_string(),
                endpoint: EXCHANGE_INFO_ENDPOINT.to_string(),
                reason: "no TRADING symbols found".to_string(),
            });
        }

        let min_notional = min_notional.ok_or_else(|| AppError::ResponseParse {
            exchange: EXCHANGE.to_string(),
            endpoint: EXCHANGE_INFO_ENDPOINT.to_string(),
            reason: "no MIN_NOTIONAL filters found".to_string(),
        })?;

        Ok(ExchangeInfo {
            symbols,
            min_notional: Notional::new(min_notional)?,
            // Public exchangeInfo does not expose account-specific leverage brackets.
            max_leverage: Leverage::max_phase_one(Decimal::from(5))?,
        })
    }
}

#[derive(Debug, Deserialize)]
struct BinanceSymbolInfo {
    symbol: String,
    status: String,
    filters: Vec<Value>,
}

#[derive(Debug, Deserialize)]
struct BinanceMarkPriceResponse {
    #[serde(rename = "markPrice")]
    mark_price: String,
    #[serde(rename = "indexPrice")]
    index_price: String,
}

impl BinanceMarkPriceResponse {
    fn into_prices(self) -> AppResult<(Price, Price)> {
        Ok((
            Price::new(parse_decimal(
                MARK_PRICE_ENDPOINT,
                "markPrice",
                &self.mark_price,
            )?)?,
            Price::new(parse_decimal(
                MARK_PRICE_ENDPOINT,
                "indexPrice",
                &self.index_price,
            )?)?,
        ))
    }
}

#[derive(Debug, Deserialize)]
struct BinanceFundingRateResponse {
    symbol: String,
    #[serde(rename = "fundingRate")]
    funding_rate: String,
    #[serde(rename = "fundingTime")]
    funding_time: u64,
}

#[derive(Debug, Deserialize)]
struct BinanceOpenInterestResponse {
    symbol: String,
    #[serde(rename = "openInterest")]
    open_interest: String,
}

#[derive(Debug, Deserialize)]
struct BinanceDepthResponse {
    bids: Vec<[String; 2]>,
    asks: Vec<[String; 2]>,
}

impl BinanceDepthResponse {
    fn into_orderbook(self, symbol: &str) -> AppResult<OrderBook> {
        let bids = parse_levels(ORDERBOOK_ENDPOINT, "bids", self.bids)?;
        let asks = parse_levels(ORDERBOOK_ENDPOINT, "asks", self.asks)?;
        OrderBook::from_levels(Symbol::new(symbol)?, bids, asks)
    }
}

fn parse_levels(
    endpoint: &'static str,
    side: &'static str,
    raw_levels: Vec<[String; 2]>,
) -> AppResult<Vec<OrderBookLevel>> {
    raw_levels
        .into_iter()
        .map(|level| {
            Ok(OrderBookLevel {
                price: Price::new(parse_decimal(endpoint, side, &level[0])?)?,
                quantity: Quantity::new(parse_decimal(endpoint, side, &level[1])?)?,
            })
        })
        .collect()
}

fn parse_decimal(endpoint: &'static str, field: &'static str, raw: &str) -> AppResult<Decimal> {
    Decimal::from_str(raw).map_err(|err| AppError::ResponseParse {
        exchange: EXCHANGE.to_string(),
        endpoint: endpoint.to_string(),
        reason: format!("invalid decimal in {field}: {err}"),
    })
}

fn normalize_symbol(symbol: &str) -> AppResult<String> {
    Ok(Symbol::new(symbol)?.as_str().to_string())
}

fn validate_depth(depth: u16) -> AppResult<u16> {
    match depth {
        5 | 10 | 20 | 50 | 100 | 500 | 1000 => Ok(depth),
        _ => Err(AppError::Exchange(
            "Binance orderbook depth must be one of 5, 10, 20, 50, 100, 500, 1000".to_string(),
        )),
    }
}

fn infer_funding_interval_hours(response: &[BinanceFundingRateResponse]) -> u32 {
    if response.len() < 2 {
        return 8;
    }

    let previous = response[response.len() - 2].funding_time;
    let latest = response[response.len() - 1].funding_time;
    let hours = latest.saturating_sub(previous) / 3_600_000;
    u32::try_from(hours)
        .ok()
        .filter(|hours| *hours > 0)
        .unwrap_or(8)
}

fn should_retry_error(err: &AppError) -> bool {
    match err {
        AppError::HttpStatus { status, .. } => StatusCode::from_u16(*status)
            .map(|status| status.is_server_error() || status == StatusCode::TOO_MANY_REQUESTS)
            .unwrap_or(false),
        AppError::HttpRequest { .. } => true,
        _ => false,
    }
}

fn backoff_for_attempt(attempt: usize) -> Duration {
    Duration::from_millis(100 * (u64::try_from(attempt).unwrap_or(0) + 1))
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use rust_decimal_macros::dec;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path, query_param},
    };

    use super::*;

    #[tokio::test]
    async fn normalizes_exchange_info_from_public_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(EXCHANGE_INFO_ENDPOINT))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "symbols": [
                    {
                        "symbol": "BTCUSDT",
                        "status": "TRADING",
                        "filters": [{"filterType": "MIN_NOTIONAL", "notional": "5.0"}]
                    },
                    {
                        "symbol": "DELISTEDUSDT",
                        "status": "BREAK",
                        "filters": [{"filterType": "MIN_NOTIONAL", "notional": "10.0"}]
                    }
                ]
            })))
            .mount(&server)
            .await;
        let client = test_client(&server);

        let info = client.fetch_exchange_info().await.unwrap();

        assert_eq!(info.symbols.len(), 1);
        assert_eq!(info.symbols[0].as_str(), "BTCUSDT");
        assert_eq!(info.min_notional.as_decimal(), dec!(5.0));
        assert_eq!(info.max_leverage.as_decimal(), dec!(5));
    }

    #[tokio::test]
    async fn fetches_mark_price_from_public_endpoint() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(MARK_PRICE_ENDPOINT))
            .and(query_param("symbol", "BTCUSDT"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "symbol": "BTCUSDT",
                "markPrice": "12345.67",
                "indexPrice": "12340.00"
            })))
            .mount(&server)
            .await;
        let client = test_client(&server);

        let price = client.fetch_mark_price("btcusdt").await.unwrap();

        assert_eq!(price.as_decimal(), dec!(12345.67));
    }

    #[tokio::test]
    async fn fetches_mark_and_index_prices_from_public_endpoint() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(MARK_PRICE_ENDPOINT))
            .and(query_param("symbol", "BTCUSDT"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "symbol": "BTCUSDT",
                "markPrice": "101.00",
                "indexPrice": "100.00"
            })))
            .mount(&server)
            .await;
        let client = test_client(&server);

        let (mark, index) = client.fetch_mark_index_prices("btcusdt").await.unwrap();

        assert_eq!(mark.as_decimal(), dec!(101.00));
        assert_eq!(index.as_decimal(), dec!(100.00));
    }

    #[tokio::test]
    async fn fetches_latest_funding_rate_and_interval() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(FUNDING_RATE_ENDPOINT))
            .and(query_param("symbol", "BTCUSDT"))
            .and(query_param("limit", "2"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {"symbol": "BTCUSDT", "fundingRate": "0.00010000", "fundingTime": 1000},
                {"symbol": "BTCUSDT", "fundingRate": "0.00020000", "fundingTime": 28801000}
            ])))
            .mount(&server)
            .await;
        let client = test_client(&server);

        let funding = client.fetch_funding_rate("BTCUSDT").await.unwrap();

        assert_eq!(funding.symbol.as_str(), "BTCUSDT");
        assert_eq!(funding.rate, dec!(0.00020000));
        assert_eq!(funding.interval_hours, 8);
    }

    #[tokio::test]
    async fn fetches_open_interest_from_public_endpoint() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(OPEN_INTEREST_ENDPOINT))
            .and(query_param("symbol", "BTCUSDT"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "symbol": "BTCUSDT",
                "openInterest": "10659.509",
                "time": 1589437530011u64
            })))
            .mount(&server)
            .await;
        let client = test_client(&server);

        let open_interest = client.fetch_open_interest("BTCUSDT").await.unwrap();

        assert_eq!(open_interest.quantity.as_decimal(), dec!(10659.509));
    }

    #[tokio::test]
    async fn fetches_orderbook_depth_snapshot_from_public_endpoint() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(ORDERBOOK_ENDPOINT))
            .and(query_param("symbol", "BTCUSDT"))
            .and(query_param("limit", "20"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "lastUpdateId": 1027024,
                "bids": [["100.0", "1.5"], ["99.5", "2.0"]],
                "asks": [["101.0", "1.0"], ["101.5", "3.0"]]
            })))
            .mount(&server)
            .await;
        let client = test_client(&server);

        let book = client.fetch_orderbook_depth("BTCUSDT", 20).await.unwrap();

        assert_eq!(book.bid.as_decimal(), dec!(100.0));
        assert_eq!(book.ask.as_decimal(), dec!(101.0));
        assert_eq!(book.bids.len(), 2);
        assert_eq!(book.asks.len(), 2);
    }

    #[tokio::test]
    async fn surfaces_structured_http_status_errors() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(MARK_PRICE_ENDPOINT))
            .and(query_param("symbol", "BTCUSDT"))
            .respond_with(ResponseTemplate::new(418).set_body_string("rate limited"))
            .mount(&server)
            .await;
        let client = test_client(&server);

        let err = client.fetch_mark_price("BTCUSDT").await.unwrap_err();

        assert!(matches!(err, AppError::HttpStatus { status: 418, .. }));
    }

    #[test]
    fn rejects_invalid_depth_before_http_call() {
        assert!(validate_depth(25).is_err());
    }

    fn test_client(server: &MockServer) -> BinanceReadonly {
        BinanceReadonly::new(server.uri(), Duration::from_secs(2), 0).unwrap()
    }
}
