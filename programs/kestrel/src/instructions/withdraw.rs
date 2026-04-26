use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::{AGENT_SEED, CONFIG_SEED, VAULT_SEED};
use crate::error::KestrelError;
use crate::events::Withdrawn;
use crate::state::{AgentProfile, Config};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump = config.vault_bump,
        token::mint = config.usdc_mint,
        token::authority = config,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: agent PDA; deserialized and checked in handler.
    #[account(
        mut,
        seeds = [AGENT_SEED, owner.key().as_ref()],
        bump,
    )]
    pub agent: AccountInfo<'info>,

    #[account(address = config.usdc_mint)]
    pub usdc_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = user_ata.owner == owner.key() @ KestrelError::Unauthorized,
        constraint = user_ata.mint == config.usdc_mint @ KestrelError::Unauthorized,
    )]
    pub user_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = treasury_ata.owner == config.treasury @ KestrelError::Unauthorized,
        constraint = treasury_ata.mint == config.usdc_mint @ KestrelError::Unauthorized,
    )]
    pub treasury_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, KestrelError::InvalidAmount);

    require_keys_eq!(
        *ctx.accounts.agent.owner,
        crate::ID,
        KestrelError::WithdrawWhileDelegated
    );

    let agent_ai = ctx.accounts.agent.to_account_info();
    let mut data = agent_ai.try_borrow_mut_data()?;
    let mut agent = AgentProfile::try_deserialize(&mut data.as_ref())?;

    require_keys_eq!(agent.owner, ctx.accounts.owner.key(), KestrelError::Unauthorized);
    require!(amount <= agent.balance, KestrelError::WithdrawExceedsFree);

    let principal_returned = amount.min(agent.deposited_amount);
    let profit_returned = amount
        .checked_sub(principal_returned)
        .ok_or(KestrelError::MathOverflow)?;

    let fee_bps = ctx.accounts.config.fee_bps as u128;
    let fee = (profit_returned as u128)
        .checked_mul(fee_bps)
        .ok_or(KestrelError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(KestrelError::MathOverflow)? as u64;

    let to_user = amount.checked_sub(fee).ok_or(KestrelError::MathOverflow)?;

    let config_bump = ctx.accounts.config.bump;
    let signer_seeds: &[&[u8]] = &[CONFIG_SEED, std::slice::from_ref(&config_bump)];
    let signer = &[signer_seeds];

    if to_user > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user_ata.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer,
            ),
            to_user,
        )?;
    }

    if fee > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.treasury_ata.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer,
            ),
            fee,
        )?;
    }

    agent.balance = agent
        .balance
        .checked_sub(amount)
        .ok_or(KestrelError::MathOverflow)?;
    agent.deposited_amount = agent
        .deposited_amount
        .checked_sub(principal_returned)
        .ok_or(KestrelError::MathOverflow)?;
    agent.realized_high_water = agent
        .realized_high_water
        .saturating_sub(amount);

    agent.try_serialize(&mut &mut data[..])?;

    let owner = ctx.accounts.owner.key();
    msg!(
        "Withdraw: agent={} amount={} principal={} profit={} fee={} to_user={}",
        owner,
        amount,
        principal_returned,
        profit_returned,
        fee,
        to_user
    );

    emit!(Withdrawn {
        owner,
        amount_gross: amount,
        principal: principal_returned,
        profit: profit_returned,
        fee,
        amount_net: to_user,
        slot: Clock::get()?.slot,
    });

    Ok(())
}
