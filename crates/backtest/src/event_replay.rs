#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplayEvent {
    pub sequence: u64,
    pub kind: String,
}

pub fn events_are_ordered(events: &[ReplayEvent]) -> bool {
    events
        .windows(2)
        .all(|pair| pair[0].sequence <= pair[1].sequence)
}
