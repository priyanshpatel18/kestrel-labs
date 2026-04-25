use anchor_lang::prelude::*;

use crate::constants::{AGENT_SEED, MARKET_SEED};
use crate::error::KestrelError;
use crate::state::{AgentProfile, Market, MarketStatus, Outcome};

#[derive(Accounts)]
#[instruction(id: u32)]
pub struct PlaceBet<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [MARKET_SEED, &id.to_le_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [AGENT_SEED, owner.key().as_ref()],
        bump = agent.bump,
        has_one = owner @ KestrelError::Unauthorized,
    )]
    pub agent: Account<'info, AgentProfile>,
}

pub fn handler(ctx: Context<PlaceBet>, _id: u32, side: Outcome, amount: u64) -> Result<()> {
    require!(amount > 0, KestrelError::InvalidAmount);

    let market = &mut ctx.accounts.market;
    let agent = &mut ctx.accounts.agent;

    require!(market.status == MarketStatus::Open, KestrelError::MarketNotOpen);
    require!(!agent.is_paused(), KestrelError::AgentPaused);
    if agent.policy.allowed_markets_root != [0u8; 32] {
        require!(
            agent.policy.allowed_markets_root == market.oracle_feed.to_bytes(),
            KestrelError::MarketNotAllowed
        );
    }
    require!(
        amount <= agent.policy.max_stake_per_window,
        KestrelError::OverPolicyCap
    );
    require!(amount <= agent.balance, KestrelError::InsufficientBalance);

    let now = Clock::get()?.unix_timestamp;
    require!(now < market.close_ts, KestrelError::OutsideMarketWindow);

    let amount_u = amount as u128;
    let (shares_out, new_yes, new_no) = match side {
        Outcome::Yes => {
            let new_no = market
                .no_reserve
                .checked_add(amount_u)
                .ok_or(KestrelError::MathOverflow)?;
            let new_yes = market
                .k
                .checked_div(new_no)
                .ok_or(KestrelError::MathOverflow)?;
            let shares_out = market
                .yes_reserve
                .checked_sub(new_yes)
                .ok_or(KestrelError::MathOverflow)?;
            (shares_out, new_yes, new_no)
        }
        Outcome::No => {
            let new_yes = market
                .yes_reserve
                .checked_add(amount_u)
                .ok_or(KestrelError::MathOverflow)?;
            let new_no = market
                .k
                .checked_div(new_yes)
                .ok_or(KestrelError::MathOverflow)?;
            let shares_out = market
                .no_reserve
                .checked_sub(new_no)
                .ok_or(KestrelError::MathOverflow)?;
            (shares_out, new_yes, new_no)
        }
    };

    require!(shares_out > 0, KestrelError::MathOverflow);
    let shares_out_u64: u64 = shares_out
        .try_into()
        .map_err(|_| KestrelError::MathOverflow)?;

    let market_id = market.id;
    let prior_open = agent.open_positions_count();
    let slot = agent
        .find_or_alloc_slot(market_id)
        .ok_or(KestrelError::TooManyPositions)?;

    if agent.positions[slot].yes_shares == 0 && agent.positions[slot].no_shares == 0 {
        require!(
            prior_open < agent.policy.max_open_positions,
            KestrelError::TooManyPositions
        );
    }

    market.yes_reserve = new_yes;
    market.no_reserve = new_no;
    market.total_collateral = market
        .total_collateral
        .checked_add(amount)
        .ok_or(KestrelError::MathOverflow)?;

    let pos = &mut agent.positions[slot];
    pos.market_id = market_id;
    pos.stake = pos
        .stake
        .checked_add(amount)
        .ok_or(KestrelError::MathOverflow)?;
    pos.settled = false;

    match side {
        Outcome::Yes => {
            pos.yes_shares = pos
                .yes_shares
                .checked_add(shares_out_u64)
                .ok_or(KestrelError::MathOverflow)?;
            market.total_yes_shares = market
                .total_yes_shares
                .checked_add(shares_out)
                .ok_or(KestrelError::MathOverflow)?;
        }
        Outcome::No => {
            pos.no_shares = pos
                .no_shares
                .checked_add(shares_out_u64)
                .ok_or(KestrelError::MathOverflow)?;
            market.total_no_shares = market
                .total_no_shares
                .checked_add(shares_out)
                .ok_or(KestrelError::MathOverflow)?;
        }
    }

    agent.balance = agent
        .balance
        .checked_sub(amount)
        .ok_or(KestrelError::MathOverflow)?;
    let new_len = (slot as u8).saturating_add(1);
    if agent.positions_len < new_len {
        agent.positions_len = new_len;
    }

    msg!(
        "place_bet: agent={} market={} side={:?} amount={} shares_out={} reserves=({}, {})",
        agent.owner,
        market_id,
        side,
        amount,
        shares_out_u64,
        market.yes_reserve,
        market.no_reserve,
    );

    Ok(())
}
