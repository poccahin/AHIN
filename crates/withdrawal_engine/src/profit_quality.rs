use rust_decimal::Decimal;

pub fn profit_quality_is_realized(realized_profit: Decimal, unrealized_profit: Decimal) -> bool {
    realized_profit > Decimal::ZERO && unrealized_profit <= realized_profit
}
