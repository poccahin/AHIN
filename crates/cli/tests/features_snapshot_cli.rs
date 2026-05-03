#![forbid(unsafe_code)]

use std::{path::Path, process::Command};

use serde_json::Value;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path, query_param},
};

#[tokio::test]
async fn feature_snapshot_cli_uses_mocked_binance_public_endpoints() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/fapi/v1/premiumIndex"))
        .and(query_param("symbol", "BTCUSDT"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "symbol": "BTCUSDT",
            "markPrice": "101.00",
            "indexPrice": "100.00"
        })))
        .mount(&server)
        .await;

    Mock::given(method("GET"))
        .and(path("/fapi/v1/fundingRate"))
        .and(query_param("symbol", "BTCUSDT"))
        .and(query_param("limit", "2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            {"symbol": "BTCUSDT", "fundingRate": "0.00010000", "fundingTime": 1000},
            {"symbol": "BTCUSDT", "fundingRate": "0.00020000", "fundingTime": 28801000}
        ])))
        .mount(&server)
        .await;

    Mock::given(method("GET"))
        .and(path("/fapi/v1/openInterest"))
        .and(query_param("symbol", "BTCUSDT"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "symbol": "BTCUSDT",
            "openInterest": "1234.5"
        })))
        .mount(&server)
        .await;

    Mock::given(method("GET"))
        .and(path("/fapi/v1/depth"))
        .and(query_param("symbol", "BTCUSDT"))
        .and(query_param("limit", "100"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "lastUpdateId": 1,
            "bids": [["100.00", "100"], ["99.98", "200"]],
            "asks": [["100.10", "100"], ["100.12", "200"]]
        })))
        .mount(&server)
        .await;

    let config = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../config/default.toml");
    let output = Command::new(env!("CARGO_BIN_EXE_cli"))
        .arg("--config")
        .arg(config)
        .arg("--binance-base-url")
        .arg(server.uri())
        .args([
            "features",
            "snapshot",
            "--exchange",
            "binance",
            "--symbol",
            "BTCUSDT",
            "--depth",
            "100",
        ])
        .output()
        .expect("cli binary should run");

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8(output.stdout).expect("stdout should be utf8");
    let json: Value = serde_json::from_str(&stdout).expect("stdout should be JSON");

    assert_eq!(json["exchange"], "binance");
    assert_eq!(json["symbol"], "BTCUSDT");
    assert_eq!(json["mark_price"], "101.00");
    assert_eq!(json["index_price"], "100.00");
    assert_eq!(json["premium_bps"], "100.00");
    assert_eq!(json["funding_regime"], "positive");
    assert_eq!(json["liquidity"]["bid_depth_10bps"], "29996.00");
    assert_eq!(json["cost"]["round_trip_fee_bps"], "8");
}
