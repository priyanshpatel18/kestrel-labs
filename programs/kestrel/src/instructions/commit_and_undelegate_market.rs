use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;

use crate::constants::{CONFIG_SEED, MARKET_SEED};
use crate::error::KestrelError;
use crate::state::{Config, Market, MarketStatus};

#[commit]
#[derive(Accounts)]
#[instruction(id: u32)]
pub struct CommitAndUndelegateMarket<'info> {
    #[account(mut)]
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
        constraint = market.status == MarketStatus::Closed @ KestrelError::MarketNotSettled,
    )]
    pub market: Account<'info, Market>,
}

pub fn handler(ctx: Context<CommitAndUndelegateMarket>, _id: u32) -> Result<()> {
    commit_and_undelegate_accounts(
        &ctx.accounts.admin.to_account_info(),
        vec![&ctx.accounts.market.to_account_info()],
        &ctx.accounts.magic_context.to_account_info(),
        &ctx.accounts.magic_program.to_account_info(),
    )?;
    Ok(())
}
