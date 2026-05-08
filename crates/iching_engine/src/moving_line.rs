use domain::{FeatureDelta, PositionLine, SignalDecision, SignalGrade, YiActionBias, YiState};
use rust_decimal::Decimal;

pub fn determine_moving_line(
    signal_decision: &SignalDecision,
    delta: &FeatureDelta,
    yi_state: YiState,
) -> PositionLine {
    if matches!(yi_state, YiState::BoCollapse | YiState::Cooldown)
        || delta.mark_price_return <= Decimal::new(-3, 2)
        || (delta.signal_strength_slope < Decimal::ZERO
            && delta.liquidity_score_slope < Decimal::ZERO
            && delta.cost_bps_slope > Decimal::ZERO)
    {
        return PositionLine::Line6;
    }
    if signal_decision.packet.grade == SignalGrade::APlus
        && signal_decision.packet.final_strength >= Decimal::from(92)
    {
        return PositionLine::Line5;
    }
    if signal_decision.packet.final_strength >= Decimal::from(85) {
        return PositionLine::Line4;
    }
    if signal_decision.packet.final_strength >= Decimal::from(70) {
        return PositionLine::Line3;
    }
    if signal_decision.packet.final_strength >= Decimal::from(55) {
        return PositionLine::Line2;
    }
    PositionLine::Line1
}

pub fn action_bias_for_line(line: PositionLine, yi_state: YiState) -> YiActionBias {
    if line == PositionLine::Line6 {
        return YiActionBias::Cooldown;
    }
    match yi_state {
        YiState::KanRisk => YiActionBias::Reduce,
        YiState::BoCollapse => YiActionBias::Exit,
        YiState::PiBlockage | YiState::Cooldown => YiActionBias::Cooldown,
        YiState::QianMomentum | YiState::XunTrend if line == PositionLine::Line5 => {
            YiActionBias::AddAllowed
        }
        YiState::QianMomentum | YiState::XunTrend | YiState::LiClarity => YiActionBias::Probe,
        YiState::ZhenImpulse | YiState::DuiDistribution => YiActionBias::Hold,
        YiState::GenPause | YiState::KunStillness => YiActionBias::Observe,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moving_line_six_maps_to_cooldown() {
        assert_eq!(
            action_bias_for_line(PositionLine::Line6, YiState::QianMomentum),
            YiActionBias::Cooldown
        );
    }
}
