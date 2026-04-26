use anchor_lang::prelude::*;

use crate::constants::{AGENT_SEED, MARKET_SEED};
use crate::error::KestrelError;
use crate::events::AgentSettled;
use crate::state::{AgentProfile, Market, MarketStatus, OpenPosition, Outcome};

#[derive(Accounts)]
#[instruction(id: u32)]
pub struct SettlePositions<'info> {
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [MARKET_SEED, &id.to_le_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, SettlePositions<'info>>,
    _id: u32,
) -> Result<()> {
    let market = &ctx.accounts.market;
    require!(market.status == MarketStatus::Closed, KestrelError::MarketNotSettled);
    let winner = market.winner.ok_or(KestrelError::MarketNotSettled)?;

    let market_id = market.id;
    let solvency_budget = (market.seeded_liquidity as u128)
        .checked_add(market.total_collateral as u128)
        .ok_or(KestrelError::MathOverflow)?;

    let chain_slot = Clock::get()?.slot;

    for ai in ctx.remaining_accounts.iter() {
        require!(ai.is_writable, KestrelError::Unauthorized);
        require_keys_eq!(*ai.owner, crate::ID, KestrelError::Unauthorized);

        let mut agent: Account<AgentProfile> = Account::try_from(ai)?;
        let (expected, _) =
            Pubkey::find_program_address(&[AGENT_SEED, agent.owner.as_ref()], &crate::ID);
        require_keys_eq!(expected, agent.key(), KestrelError::Unauthorized);

        let pos_slot = match agent.find_position(market_id) {
            Some(s) => s,
            None => continue,
        };
        if agent.positions[pos_slot].settled {
            continue;
        }

        let payout: u64 = match winner {
            Outcome::Yes => agent.positions[pos_slot].yes_shares,
            Outcome::No => agent.positions[pos_slot].no_shares,
        };

        require!((payout as u128) <= solvency_budget, KestrelError::Insolvent);

        agent.balance = agent
            .balance
            .checked_add(payout)
            .ok_or(KestrelError::MathOverflow)?;

        // Free the slot for later markets.
        agent.positions[pos_slot] = OpenPosition::default();

        let owner = agent.owner;

        agent.exit(&crate::ID)?;

        emit!(AgentSettled {
            owner,
            market_id,
            side_won: winner,
            payout,
            slot: chain_slot,
        });
    }

    Ok(())
}

