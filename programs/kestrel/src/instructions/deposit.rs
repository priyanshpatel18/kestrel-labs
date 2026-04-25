use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::{AGENT_SEED, CONFIG_SEED, VAULT_SEED};
use crate::error::KestrelError;
use crate::state::{AgentProfile, Config};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump = config.vault_bump,
        token::mint = config.usdc_mint,
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

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, KestrelError::InvalidAmount);

    require_keys_eq!(
        *ctx.accounts.agent.owner,
        crate::ID,
        KestrelError::DepositWhileDelegated
    );

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_ata.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
    )?;

    let agent_ai = ctx.accounts.agent.to_account_info();
    let mut data = agent_ai.try_borrow_mut_data()?;
    let mut agent = AgentProfile::try_deserialize(&mut data.as_ref())?;
    require_keys_eq!(agent.owner, ctx.accounts.owner.key(), KestrelError::Unauthorized);

    agent.deposited_amount = agent
        .deposited_amount
        .checked_add(amount)
        .ok_or(KestrelError::MathOverflow)?;
    agent.balance = agent
        .balance
        .checked_add(amount)
        .ok_or(KestrelError::MathOverflow)?;
    agent.realized_high_water = agent
        .realized_high_water
        .checked_add(amount)
        .ok_or(KestrelError::MathOverflow)?;

    agent.try_serialize(&mut &mut data[..])?;
    msg!(
        "Deposit: agent={} amount={} new_balance={}",
        ctx.accounts.owner.key(),
        amount,
        agent.balance
    );
    Ok(())
}
