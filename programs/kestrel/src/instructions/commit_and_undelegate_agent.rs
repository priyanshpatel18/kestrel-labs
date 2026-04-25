use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;

use crate::constants::AGENT_SEED;
use crate::error::KestrelError;
use crate::state::AgentProfile;

#[commit]
#[derive(Accounts)]
pub struct CommitAndUndelegateAgent<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [AGENT_SEED, owner.key().as_ref()],
        bump = agent.bump,
        has_one = owner @ KestrelError::Unauthorized,
    )]
    pub agent: Account<'info, AgentProfile>,
}

pub fn handler(ctx: Context<CommitAndUndelegateAgent>) -> Result<()> {
    commit_and_undelegate_accounts(
        &ctx.accounts.owner.to_account_info(),
        vec![&ctx.accounts.agent.to_account_info()],
        &ctx.accounts.magic_context.to_account_info(),
        &ctx.accounts.magic_program.to_account_info(),
    )?;
    Ok(())
}
