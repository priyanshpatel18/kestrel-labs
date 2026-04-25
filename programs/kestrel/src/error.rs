use anchor_lang::prelude::*;

#[error_code]
pub enum KestrelError {
    #[msg("Unauthorized signer for this instruction")]
    Unauthorized,
    #[msg("Market is not in Open status")]
    MarketNotOpen,
    #[msg("Market is closed or already resolved")]
    MarketClosed,
    #[msg("Market is halted; only close-position is allowed")]
    MarketHalted,
    #[msg("Market has already been settled")]
    MarketAlreadySettled,
    #[msg("Market has not been settled yet")]
    MarketNotSettled,
    #[msg("Market window is not open at the current timestamp")]
    OutsideMarketWindow,
    #[msg("close_ts must be strictly after open_ts and in the future")]
    InvalidMarketWindow,
    #[msg("Oracle price feed pubkey does not match market.oracle_feed")]
    OracleMismatch,
    #[msg("Oracle price update is older than the allowed maximum age")]
    OracleStale,
    #[msg("Failed to deserialize oracle price update account")]
    OracleDeserialize,
    #[msg("Bet amount exceeds the agent policy max_stake_per_window")]
    OverPolicyCap,
    #[msg("Agent already holds the maximum number of open positions")]
    TooManyPositions,
    #[msg("Agent has insufficient ER-side balance for this bet")]
    InsufficientBalance,
    #[msg("Market is not allowed by this agent's policy")]
    MarketNotAllowed,
    #[msg("Agent is paused")]
    AgentPaused,
    #[msg("Cannot withdraw while AgentProfile is delegated; commit_and_undelegate_agent first")]
    WithdrawWhileDelegated,
    #[msg("Cannot deposit while AgentProfile is delegated")]
    DepositWhileDelegated,
    #[msg("Position not found for this market on this agent")]
    PositionNotFound,
    #[msg("Position has already been settled")]
    PositionAlreadySettled,
    #[msg("Withdraw amount exceeds free (non-realized) balance")]
    WithdrawExceedsFree,
    #[msg("Seed liquidity below minimum floor")]
    SeedLiquidityTooSmall,
    #[msg("Bet amount must be > 0")]
    InvalidAmount,
    #[msg("Math overflow / underflow in CPMM swap or settlement")]
    MathOverflow,
    #[msg("Position size mismatch with stored shares")]
    InsufficientShares,
    #[msg("Outcome shares would exceed protocol solvency budget")]
    Insolvent,
}
