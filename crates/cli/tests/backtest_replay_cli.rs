#![forbid(unsafe_code)]

use std::{path::Path, process::Command};

use serde_json::Value;

#[test]
fn backtest_replay_cli_uses_local_jsonl_events() {
    let config = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../config/default.toml");
    let input = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/replay/sample_events.jsonl");

    let output = Command::new(env!("CARGO_BIN_EXE_cli"))
        .arg("--config")
        .arg(config)
        .args(["backtest", "replay", "--input"])
        .arg(input)
        .output()
        .expect("cli binary should run");

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8(output.stdout).expect("stdout should be utf8");
    let json: Value = serde_json::from_str(&stdout).expect("stdout should be JSON");

    assert_eq!(json["events_processed"], 3);
    let decisions = json["decisions"]
        .as_array()
        .expect("decisions should be array");
    assert!(decisions.iter().any(|decision| {
        decision["simulated_trade"]["executable"] == false
            && decision["simulated_trade"]["real_order_id"].is_null()
    }));
}
