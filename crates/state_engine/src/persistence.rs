use domain::{AppError, AppResult};

use crate::EngineState;

pub fn serialize_state(state: &EngineState) -> AppResult<String> {
    serde_json::to_string_pretty(state)
        .map_err(|err| AppError::Config(format!("failed to serialize engine state: {err}")))
}

pub fn deserialize_state(raw: &str) -> AppResult<EngineState> {
    serde_json::from_str(raw)
        .map_err(|err| AppError::Config(format!("failed to deserialize engine state: {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_state_round_trips() {
        let state = EngineState::default();
        let raw = serialize_state(&state).unwrap();
        let restored = deserialize_state(&raw).unwrap();

        assert_eq!(state, restored);
    }
}
