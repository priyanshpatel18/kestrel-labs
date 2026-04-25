use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::constants::{CONFIG_SEED, MARKET_SEED};
use crate::error::KestrelError;
use crate::state::Config;

#[delegate]
#[derive(Accounts)]
#[instruction(id: u32)]
pub struct DelegateMarket<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.admin == payer.key() @ KestrelError::Unauthorized,
    )]
    pub config: Account<'info, Config>,

    /// CHECK: market PDA passed to delegation program.
    #[account(mut, del, seeds = [MARKET_SEED, &id.to_le_bytes()], bump)]
    pub market: AccountInfo<'info>,

    /// CHECK: optional validator identity for hosted ER delegate CPI.
    pub validator: Option<AccountInfo<'info>>,
}

pub fn handler(ctx: Context<DelegateMarket>, id: u32) -> Result<()> {
    let id_bytes = id.to_le_bytes();
    let seeds: &[&[u8]] = &[MARKET_SEED, &id_bytes];

    let validator = ctx
        .accounts
        .validator
        .as_ref()
        .map(|a| a.key())
        .or_else(|| ctx.remaining_accounts.first().map(|a| a.key()));

    ctx.accounts.delegate_market(
        &ctx.accounts.payer,
        seeds,
        DelegateConfig {
            validator,
            ..Default::default()
        },
    )?;
    Ok(())
}
