use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum MarketStatus {
    Pending,
    Open,
    Halted,
    Closed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum Outcome {
    Yes,
    No,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub id: u32,
    pub open_ts: i64,
    pub close_ts: i64,
    pub status: MarketStatus,
    pub strike: i64,
    /// Oracle price at close_market time (same scale as strike).
    pub close_price: i64,
    pub oracle_feed: Pubkey,
    pub yes_reserve: u128,
    pub no_reserve: u128,
    pub k: u128,
    pub seeded_liquidity: u64,
    pub total_yes_shares: u128,
    pub total_no_shares: u128,
    pub total_collateral: u64,
    pub winner: Option<Outcome>,
    pub bump: u8,
}
