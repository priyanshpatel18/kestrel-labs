use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, MARKET_SEED};
use crate::error::KestrelError;
use crate::state::{Config, Market, MarketStatus};

#[derive(Accounts)]
#[instruction(id: u32)]
pub struct HaltMarket<'info> {
    pub admin: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.admin == admin.key() @ KestrelError::Unauthorized,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [MARKET_SEED, &id.to_le_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,
}

pub fn handle_halt(ctx: Context<HaltMarket>, _id: u32) -> Result<()> {
    let market = &mut ctx.accounts.market;
    require!(market.status == MarketStatus::Open, KestrelError::MarketNotOpen);
    market.status = MarketStatus::Halted;
    msg!("Market {} halted by admin", market.id);
    Ok(())
}

pub fn handle_resume(ctx: Context<HaltMarket>, _id: u32) -> Result<()> {
    let market = &mut ctx.accounts.market;
    require!(market.status == MarketStatus::Halted, KestrelError::MarketNotOpen);
    let now = Clock::get()?.unix_timestamp;
    require!(now < market.close_ts, KestrelError::OutsideMarketWindow);
    market.status = MarketStatus::Open;
    msg!("Market {} resumed by admin", market.id);
    Ok(())
}
