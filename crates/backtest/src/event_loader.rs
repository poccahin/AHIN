use std::{fs, path::Path};

use domain::{AppError, AppResult, MarketEvent};

pub fn load_jsonl_events(path: impl AsRef<Path>) -> AppResult<Vec<MarketEvent>> {
    let path = path.as_ref();
    let raw = fs::read_to_string(path)
        .map_err(|err| AppError::Config(format!("failed to read {}: {err}", path.display())))?;

    raw.lines()
        .enumerate()
        .filter(|(_, line)| !line.trim().is_empty())
        .map(|(idx, line)| {
            serde_json::from_str::<MarketEvent>(line).map_err(|err| {
                AppError::Config(format!(
                    "failed to parse {} line {} as MarketEvent: {err}",
                    path.display(),
                    idx + 1
                ))
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::*;

    #[test]
    fn loads_valid_jsonl_events() {
        let path = fixture_path("valid_events.jsonl");
        fs::write(
            &path,
            r#"{"sequence":1,"timestamp_ms":1,"exchange":"offline","symbol":"BTCUSDT","mark_price":"100","index_price":"99.9","funding_rate":"0.0002","open_interest":"1000","bid_levels":[{"price":"99.99","quantity":"100"}],"ask_levels":[{"price":"100.01","quantity":"100"}]}"#,
        )
        .unwrap();

        let events = load_jsonl_events(&path).unwrap();

        assert_eq!(events.len(), 1);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn rejects_malformed_jsonl() {
        let path = fixture_path("bad_events.jsonl");
        fs::write(&path, "{not-json}\n").unwrap();

        let err = load_jsonl_events(&path).unwrap_err();

        assert!(err.to_string().contains("failed to parse"));
        let _ = fs::remove_file(path);
    }

    fn fixture_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("rustquanteth-{name}-{}", std::process::id()))
    }
}
