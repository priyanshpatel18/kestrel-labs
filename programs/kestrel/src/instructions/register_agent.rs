use anchor_lang::prelude::*;

use crate::constants::AGENT_SEED;
use crate::events::AgentRegistered;
use crate::state::{AgentPolicy, AgentProfile, AgentStatus, OpenPosition};

#[derive(Accounts)]
pub struct RegisterAgent<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + AgentProfile::INIT_SPACE,
        seeds = [AGENT_SEED, owner.key().as_ref()],
        bump
    )]
    pub agent: Account<'info, AgentProfile>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RegisterAgent>, policy: AgentPolicy) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    agent.owner = ctx.accounts.owner.key();
    agent.deposited_amount = 0;
    agent.balance = 0;
    agent.realized_high_water = 0;
    agent.policy = policy;
    agent.status = AgentStatus::Active;
    agent.positions = [OpenPosition::default(); crate::constants::MAX_POSITIONS];
    agent.positions_len = 0;
    agent.bump = ctx.bumps.agent;
    msg!("Agent registered: owner={}", agent.owner);

    let slot = Clock::get()?.slot;
    emit!(AgentRegistered {
        owner: agent.owner,
        agent: agent.key(),
        policy,
        slot,
    });

    Ok(())
}
