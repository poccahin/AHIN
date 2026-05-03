use rust_decimal::Decimal;

pub fn linear_slippage_bps(order_notional: Decimal, top_of_book_notional: Decimal) -> Decimal {
    if top_of_book_notional <= Decimal::ZERO {
        return Decimal::MAX;
    }
    (order_notional / top_of_book_notional) * Decimal::from(10)
}
