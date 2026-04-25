use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub usdc_mint: Pubkey,
    /// Pyth-style PriceUpdate account pubkey used by open/close for strike/settlement.
    pub btc_usd_price_update: Pubkey,
    pub fee_bps: u16,
    pub market_count: u32,
    pub vault_bump: u8,
    pub bump: u8,
}
