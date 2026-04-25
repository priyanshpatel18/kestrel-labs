use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::commit_accounts;

use crate::constants::MARKET_SEED;
use crate::state::Market;

#[commit]
#[derive(Accounts)]
#[instruction(id: u32)]
pub struct CommitMarket<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [MARKET_SEED, &id.to_le_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,
}

pub fn handler(ctx: Context<CommitMarket>, _id: u32) -> Result<()> {
    commit_accounts(
        &ctx.accounts.payer.to_account_info(),
        vec![&ctx.accounts.market.to_account_info()],
        &ctx.accounts.magic_context.to_account_info(),
        &ctx.accounts.magic_program.to_account_info(),
    )?;
    Ok(())
}
