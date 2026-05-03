use rust_decimal::Decimal;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OptionsIvSnapshot {
    pub atm_iv: Decimal,
    pub skew_25_delta: Decimal,
}

impl OptionsIvSnapshot {
    pub fn convexity_is_supportive(self) -> bool {
        self.atm_iv > Decimal::ZERO
    }
}
