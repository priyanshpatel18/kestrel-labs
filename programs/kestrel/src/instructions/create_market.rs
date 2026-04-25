use anchor_lang::prelude::*;

use crate::constants::{BTC_USD_FEED, CONFIG_SEED, MARKET_SEED};
use crate::error::KestrelError;
use crate::state::{Config, Market, MarketStatus};

#[derive(Accounts)]
#[instruction(id: u32)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.admin == admin.key() @ KestrelError::Unauthorized,
    )]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = admin,
        space = 8 + Market::INIT_SPACE,
        seeds = [MARKET_SEED, &id.to_le_bytes()],
        bump
    )]
    pub market: Account<'info, Market>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateMarket>,
    id: u32,
    open_ts: i64,
    close_ts: i64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(close_ts > open_ts, KestrelError::InvalidMarketWindow);
    require!(close_ts > now, KestrelError::InvalidMarketWindow);

    let market = &mut ctx.accounts.market;
    market.id = id;
    market.open_ts = open_ts;
    market.close_ts = close_ts;
    market.status = MarketStatus::Pending;
    market.strike = 0;
    market.oracle_feed = BTC_USD_FEED;
    market.yes_reserve = 0;
    market.no_reserve = 0;
    market.k = 0;
    market.seeded_liquidity = 0;
    market.total_yes_shares = 0;
    market.total_no_shares = 0;
    market.total_collateral = 0;
    market.winner = None;
    market.bump = ctx.bumps.market;

    let config = &mut ctx.accounts.config;
    config.market_count = config.market_count.saturating_add(1);

    msg!(
        "Market created: id={} open_ts={} close_ts={} oracle={}",
        market.id,
        market.open_ts,
        market.close_ts,
        market.oracle_feed
    );
    Ok(())
}
