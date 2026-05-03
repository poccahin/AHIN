use domain::SignalDirection;
use rust_decimal::Decimal;

pub fn gross_pnl(
    direction: SignalDirection,
    entry_price: Decimal,
    exit_price: Decimal,
    notional: Decimal,
) -> Decimal {
    if entry_price <= Decimal::ZERO {
        return Decimal::ZERO;
    }

    let move_pct = match direction {
        SignalDirection::Long => (exit_price - entry_price) / entry_price,
        SignalDirection::Short => (entry_price - exit_price) / entry_price,
        SignalDirection::Neutral => Decimal::ZERO,
    };
    notional * move_pct
}
