use domain::{OpenInterest, Quantity};

pub fn open_interest_delta(previous: &OpenInterest, current: &OpenInterest) -> Option<Quantity> {
    if previous.symbol != current.symbol {
        return None;
    }
    Quantity::new(current.quantity.as_decimal() - previous.quantity.as_decimal()).ok()
}
