use rust_decimal::Decimal;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StructureState {
    Breakout,
    Range,
    Breakdown,
}

pub fn classify_structure(
    close: Decimal,
    range_high: Decimal,
    range_low: Decimal,
) -> StructureState {
    if close > range_high {
        StructureState::Breakout
    } else if close < range_low {
        StructureState::Breakdown
    } else {
        StructureState::Range
    }
}
