use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, MARKET_SEED};
use crate::error::KestrelError;
use crate::events::{MarketHalted, MarketResumed};
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
    let market_id = market.id;
    let by = ctx.accounts.admin.key();
    let slot = Clock::get()?.slot;
    msg!("Market {} halted by admin", market_id);
    emit!(MarketHalted { market_id, by, slot });
    Ok(())
}

pub fn handle_resume(ctx: Context<HaltMarket>, _id: u32) -> Result<()> {
    let market = &mut ctx.accounts.market;
    require!(market.status == MarketStatus::Halted, KestrelError::MarketNotOpen);
    let clock = Clock::get()?;
    require!(clock.unix_timestamp < market.close_ts, KestrelError::OutsideMarketWindow);
    market.status = MarketStatus::Open;
    let market_id = market.id;
    let by = ctx.accounts.admin.key();
    msg!("Market {} resumed by admin", market_id);
    emit!(MarketResumed {
        market_id,
        by,
        slot: clock.slot,
    });
    Ok(())
}
