use domain::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FalseBreakoutInput {
    pub breakout_triggered: bool,
    pub volume_confirmed: bool,
    pub closed_back_inside_range: bool,
}

pub fn ensure_not_false_breakout(input: FalseBreakoutInput) -> AppResult<()> {
    if input.breakout_triggered && (!input.volume_confirmed || input.closed_back_inside_range) {
        return Err(AppError::RiskRejected(
            "false breakout guard blocked the signal".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_breakout_without_confirmation() {
        let input = FalseBreakoutInput {
            breakout_triggered: true,
            volume_confirmed: false,
            closed_back_inside_range: false,
        };

        assert!(ensure_not_false_breakout(input).is_err());
    }
}
