use domain::{SignalPacket, Symbol};

pub fn invalidate(packet: &mut SignalPacket, reason: impl Into<String>) {
    packet.valid = false;
    packet.reason = Some(reason.into());
}

pub fn packet_symbol(packet: &SignalPacket) -> &Symbol {
    &packet.symbol
}
