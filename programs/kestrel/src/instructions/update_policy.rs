use anchor_lang::prelude::*;

use crate::constants::AGENT_SEED;
use crate::error::KestrelError;
use crate::events::PolicyUpdated;
use crate::state::{AgentPolicy, AgentProfile};

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [AGENT_SEED, owner.key().as_ref()],
        bump = agent.bump,
        has_one = owner @ KestrelError::Unauthorized,
    )]
    pub agent: Account<'info, AgentProfile>,
}

pub fn handler(ctx: Context<UpdatePolicy>, new_policy: AgentPolicy) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    let old = agent.policy;
    agent.policy = new_policy;

    let owner = agent.owner;
    let agent_key = agent.key();
    let slot = Clock::get()?.slot;

    msg!(
        "update_policy: owner={} agent={} max_stake_old={} max_stake_new={} paused_old={} paused_new={}",
        owner,
        agent_key,
        old.max_stake_per_window,
        new_policy.max_stake_per_window,
        old.paused,
        new_policy.paused,
    );

    emit!(PolicyUpdated {
        owner,
        agent: agent_key,
        old,
        new: new_policy,
        slot,
    });

    Ok(())
}
