use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, MARKET_SEED};
use crate::error::KestrelError;
use crate::state::{read_oracle_price, Config, Market, MarketStatus, Outcome};

#[derive(Accounts)]
#[instruction(id: u32)]
pub struct CloseMarket<'info> {
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

pub fn handler(ctx: Context<CloseMarket>, _id: u32) -> Result<()> {
    let market = &mut ctx.accounts.market;
    require!(
        matches!(market.status, MarketStatus::Open | MarketStatus::Halted),
        KestrelError::MarketClosed
    );
    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp >= market.close_ts,
        KestrelError::OutsideMarketWindow
    );

    let close_price = read_oracle_price(&ctx.accounts.price_update, &clock)?;
    let winner = if close_price >= market.strike {
        Outcome::Yes
    } else {
        Outcome::No
    };

    market.close_price = close_price;
    market.winner = Some(winner);
    market.status = MarketStatus::Closed;

    msg!(
        "Market {} closed: strike={} close={} winner={:?}",
        market.id,
        market.strike,
        close_price,
        winner
    );
    Ok(())
}
