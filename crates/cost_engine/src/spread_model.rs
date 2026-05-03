use domain::OrderBook;
use rust_decimal::Decimal;

pub fn spread_bps(book: &OrderBook) -> Decimal {
    book.spread_bps()
}
