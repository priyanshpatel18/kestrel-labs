use anchor_lang::prelude::*;

use crate::constants::{AGENT_SEED, MARKET_SEED};
use crate::error::KestrelError;
use crate::state::{AgentProfile, Market, MarketStatus, Outcome};

#[derive(Accounts)]
#[instruction(id: u32)]
pub struct ClosePosition<'info> {
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

fn ceil_div(num: u128, denom: u128) -> Result<u128> {
    require!(denom > 0, KestrelError::MathOverflow);
    let base = num.checked_div(denom).ok_or(KestrelError::MathOverflow)?;
    if num % denom == 0 {
        Ok(base)
    } else {
        base.checked_add(1).ok_or(KestrelError::MathOverflow.into())
    }
}

pub fn handler(ctx: Context<ClosePosition>, _id: u32, side: Outcome, shares: u64) -> Result<()> {
    require!(shares > 0, KestrelError::InvalidAmount);

    let market = &mut ctx.accounts.market;
    let agent = &mut ctx.accounts.agent;

    require!(market.status == MarketStatus::Open, KestrelError::MarketNotOpen);
    let now = Clock::get()?.unix_timestamp;
    require!(now < market.close_ts, KestrelError::OutsideMarketWindow);

    let market_id = market.id;
    let slot = agent
        .find_position(market_id)
        .ok_or(KestrelError::PositionNotFound)?;
    {
        let pos = &agent.positions[slot];
        require!(!pos.settled, KestrelError::PositionAlreadySettled);
        let held = match side {
            Outcome::Yes => pos.yes_shares,
            Outcome::No => pos.no_shares,
        };
        require!(shares <= held, KestrelError::InsufficientShares);
    }

    let shares_u = shares as u128;
    let usdc_out_u = match side {
        Outcome::Yes => {
            let new_yes = market
                .yes_reserve
                .checked_add(shares_u)
                .ok_or(KestrelError::MathOverflow)?;
            let new_no = ceil_div(market.k, new_yes)?;
            let usdc_out = market
                .no_reserve
                .checked_sub(new_no)
                .ok_or(KestrelError::MathOverflow)?;
            market.yes_reserve = new_yes;
            market.no_reserve = new_no;
            market.total_yes_shares = market
                .total_yes_shares
                .checked_sub(shares_u)
                .ok_or(KestrelError::MathOverflow)?;
            usdc_out
        }
        Outcome::No => {
            let new_no = market
                .no_reserve
                .checked_add(shares_u)
                .ok_or(KestrelError::MathOverflow)?;
            let new_yes = ceil_div(market.k, new_no)?;
            let usdc_out = market
                .yes_reserve
                .checked_sub(new_yes)
                .ok_or(KestrelError::MathOverflow)?;
            market.yes_reserve = new_yes;
            market.no_reserve = new_no;
            market.total_no_shares = market
                .total_no_shares
                .checked_sub(shares_u)
                .ok_or(KestrelError::MathOverflow)?;
            usdc_out
        }
    };

    let usdc_out: u64 = usdc_out_u
        .try_into()
        .map_err(|_| KestrelError::MathOverflow)?;
    require!(
        usdc_out <= market.total_collateral,
        KestrelError::Insolvent
    );

    market.total_collateral = market
        .total_collateral
        .checked_sub(usdc_out)
        .ok_or(KestrelError::MathOverflow)?;

    let pos = &mut agent.positions[slot];
    match side {
        Outcome::Yes => {
            pos.yes_shares = pos
                .yes_shares
                .checked_sub(shares)
                .ok_or(KestrelError::MathOverflow)?;
        }
        Outcome::No => {
            pos.no_shares = pos
                .no_shares
                .checked_sub(shares)
                .ok_or(KestrelError::MathOverflow)?;
        }
    }
    pos.stake = pos.stake.saturating_sub(usdc_out);

    agent.balance = agent
        .balance
        .checked_add(usdc_out)
        .ok_or(KestrelError::MathOverflow)?;

    msg!(
        "close_position: agent={} market={} side={:?} shares={} usdc_out={}",
        agent.owner,
        market_id,
        side,
        shares,
        usdc_out
    );
    Ok(())
}
