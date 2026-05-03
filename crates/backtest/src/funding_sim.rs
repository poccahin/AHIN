use rust_decimal::Decimal;

pub fn simulated_funding_payment(notional: Decimal, funding_rate: Decimal) -> Decimal {
    notional * funding_rate
}
