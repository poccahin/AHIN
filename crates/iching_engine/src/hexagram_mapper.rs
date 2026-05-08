use domain::{Trigram, YiState};

pub fn map_hexagram_state(upper: Trigram, lower: Trigram) -> YiState {
    if upper == Trigram::Kan || lower == Trigram::Kan {
        return YiState::KanRisk;
    }
    match (upper, lower) {
        (Trigram::Kun, Trigram::Gen) => YiState::BoCollapse,
        (Trigram::Kun, Trigram::Kun) => YiState::PiBlockage,
        (Trigram::Qian, Trigram::Xun) | (Trigram::Li, Trigram::Xun) => YiState::XunTrend,
        (Trigram::Qian, _) => YiState::QianMomentum,
        (Trigram::Zhen, _) | (_, Trigram::Zhen) => YiState::ZhenImpulse,
        (Trigram::Li, _) => YiState::LiClarity,
        (Trigram::Dui, _) => YiState::DuiDistribution,
        (_, Trigram::Gen) => YiState::GenPause,
        _ => YiState::KunStillness,
    }
}

pub fn hexagram_name(upper: Trigram, lower: Trigram, state: YiState) -> String {
    format!("{upper:?}-{lower:?}::{state:?}")
}
