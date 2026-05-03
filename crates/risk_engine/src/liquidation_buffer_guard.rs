use domain::{ExposureState, RiskBudgetConfig, RiskDecisionReason};

pub fn liquidation_buffer_reason(
    exposure: &ExposureState,
    config: &RiskBudgetConfig,
) -> Option<RiskDecisionReason> {
    let buffer_bps = exposure.liquidation_buffer_bps?;

    if buffer_bps < config.min_liquidation_buffer_bps {
        Some(RiskDecisionReason::LiquidationBufferTooSmall)
    } else {
        None
    }
}
