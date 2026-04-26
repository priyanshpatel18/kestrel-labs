use anchor_lang::prelude::*;

use crate::constants::{AGENT_SEED, MARKET_SEED};
use crate::error::KestrelError;
use crate::events::AgentSettled;
use crate::state::{AgentProfile, Market, MarketStatus, OpenPosition, Outcome};

#[derive(Accounts)]
#[instruction(id: u32, agent_owner: Pubkey)]
pub struct SettlePosition<'info> {
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [MARKET_SEED, &id.to_le_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [AGENT_SEED, agent_owner.as_ref()],
        bump = agent.bump,
    )]
    pub agent: Account<'info, AgentProfile>,
}

pub fn handler(ctx: Context<SettlePosition>, _id: u32, _agent_owner: Pubkey) -> Result<()> {
    let market = &ctx.accounts.market;
    let agent = &mut ctx.accounts.agent;

    require!(market.status == MarketStatus::Closed, KestrelError::MarketNotSettled);
    let winner = market.winner.ok_or(KestrelError::MarketNotSettled)?;

    let market_id = market.id;
    let slot = agent
        .find_position(market_id)
        .ok_or(KestrelError::PositionNotFound)?;

    require!(
        !agent.positions[slot].settled,
        KestrelError::PositionAlreadySettled
    );

    let payout: u64 = match winner {
        Outcome::Yes => agent.positions[slot].yes_shares,
        Outcome::No => agent.positions[slot].no_shares,
    };

    let solvency_budget = (market.seeded_liquidity as u128)
        .checked_add(market.total_collateral as u128)
        .ok_or(KestrelError::MathOverflow)?;
    require!((payout as u128) <= solvency_budget, KestrelError::Insolvent);

    agent.balance = agent
        .balance
        .checked_add(payout)
        .ok_or(KestrelError::MathOverflow)?;

    // Free the slot for later markets (same as cancel_bet leaving zeros).
    agent.positions[slot] = OpenPosition::default();

    let owner = agent.owner;
    msg!(
        "settle_position: agent={} market={} winner={:?} payout={}",
        owner,
        market_id,
        winner,
        payout
    );

    emit!(AgentSettled {
        owner,
        market_id,
        side_won: winner,
        payout,
        slot: Clock::get()?.slot,
    });

    Ok(())
}
