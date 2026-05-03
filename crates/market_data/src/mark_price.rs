use domain::{AppError, AppResult};

pub fn ensure_stream_fresh(
    websocket_connected: bool,
    age_ms: u64,
    max_age_ms: u64,
) -> AppResult<()> {
    if !websocket_connected {
        return Err(AppError::Exchange(
            "websocket disconnected; mark price stream is unsafe".to_string(),
        ));
    }
    if age_ms > max_age_ms {
        return Err(AppError::Exchange(format!(
            "mark price age {age_ms}ms exceeds max {max_age_ms}ms"
        )));
    }
    Ok(())
}
