use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum AppError {
    #[error("invalid symbol: {0}")]
    InvalidSymbol(String),

    #[error("{field} must be positive, got {value}")]
    NonPositive { field: &'static str, value: String },

    #[error("requested leverage {requested} exceeds max allowed {max}")]
    LeverageTooHigh { requested: String, max: String },

    #[error("unsafe config: {0}")]
    UnsafeConfig(String),

    #[error("config error: {0}")]
    Config(String),

    #[error("exchange error: {0}")]
    Exchange(String),

    #[error("state reconciliation error: {0}")]
    Reconciliation(String),

    #[error("risk rejected: {0}")]
    RiskRejected(String),

    #[error("cost rejected: {0}")]
    CostRejected(String),

    #[error("execution rejected: {0}")]
    ExecutionRejected(String),
}
