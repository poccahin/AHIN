use domain::{AppError, AppResult};
use rust_decimal::Decimal;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LiquidationHeatmapSignal {
    pub cluster_score: Decimal,
    pub independent_confirmation: bool,
}

pub fn ensure_heatmap_not_standalone(signal: LiquidationHeatmapSignal) -> AppResult<()> {
    if signal.cluster_score > Decimal::ZERO && !signal.independent_confirmation {
        return Err(AppError::RiskRejected(
            "liquidation heatmap cannot be used without independent confirmation".to_string(),
        ));
    }
    Ok(())
}
