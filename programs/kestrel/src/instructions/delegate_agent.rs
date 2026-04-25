use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::constants::AGENT_SEED;

#[delegate]
#[derive(Accounts)]
pub struct DelegateAgent<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: agent PDA passed to delegation program.
    #[account(mut, del, seeds = [AGENT_SEED, payer.key().as_ref()], bump)]
    pub agent: AccountInfo<'info>,

    /// CHECK: optional validator identity for hosted ER delegate CPI.
    pub validator: Option<AccountInfo<'info>>,
}

pub fn handler(ctx: Context<DelegateAgent>) -> Result<()> {
    let owner_key = ctx.accounts.payer.key();
    let seeds: &[&[u8]] = &[AGENT_SEED, owner_key.as_ref()];

    let validator = ctx
        .accounts
        .validator
        .as_ref()
        .map(|a| a.key())
        .or_else(|| ctx.remaining_accounts.first().map(|a| a.key()));

    ctx.accounts.delegate_agent(
        &ctx.accounts.payer,
        seeds,
        DelegateConfig {
            validator,
            ..Default::default()
        },
    )?;
    Ok(())
}
