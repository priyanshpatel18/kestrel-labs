use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, MARKET_SEED, MIN_SEED_LIQUIDITY};
use crate::error::KestrelError;
use crate::state::{read_oracle_price, Config, Market, MarketStatus};

#[derive(Accounts)]
#[instruction(id: u32)]
pub struct OpenMarket<'info> {
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

    /// CHECK: oracle feed account; layout validated in read_oracle_price.
    #[account(address = market.oracle_feed @ KestrelError::OracleMismatch)]
    pub price_update: AccountInfo<'info>,
}

pub fn handler(ctx: Context<OpenMarket>, _id: u32, seed_liquidity: u64) -> Result<()> {
    require!(
        seed_liquidity >= MIN_SEED_LIQUIDITY,
        KestrelError::SeedLiquidityTooSmall
    );

    let market = &mut ctx.accounts.market;
    require!(market.status == MarketStatus::Pending, KestrelError::MarketClosed);

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    require!(now >= market.open_ts, KestrelError::OutsideMarketWindow);
    require!(now < market.close_ts, KestrelError::OutsideMarketWindow);

    let strike = read_oracle_price(&ctx.accounts.price_update, &clock)?;
    let seed_u128 = seed_liquidity as u128;
    let k = seed_u128
        .checked_mul(seed_u128)
        .ok_or(KestrelError::MathOverflow)?;

    market.strike = strike;
    market.seeded_liquidity = seed_liquidity;
    market.yes_reserve = seed_u128;
    market.no_reserve = seed_u128;
    market.k = k;
    market.status = MarketStatus::Open;

    msg!(
        "Market {} opened: strike={} seed={} reserves=({}, {})",
        market.id,
        market.strike,
        seed_liquidity,
        market.yes_reserve,
        market.no_reserve,
    );
    Ok(())
}

