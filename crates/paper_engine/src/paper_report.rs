use domain::{PaperEngineState, PaperRunConfig, PaperRunReport};

pub fn build_report(
    config: &PaperRunConfig,
    state: PaperEngineState,
    ticks_processed: u64,
    fills_generated: u64,
    rejected_candidates: u64,
) -> PaperRunReport {
    PaperRunReport {
        ticks_requested: config.ticks,
        ticks_processed,
        fills_generated,
        rejected_candidates,
        open_positions: state.positions.len() as u64,
        state_path: config.state_path.clone(),
        log_path: config.log_path.clone(),
        final_state: state,
    }
}
