use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{CONFIG_SEED, VAULT_SEED};
use crate::state::Config;

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,

    pub usdc_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        seeds = [VAULT_SEED],
        bump,
        token::mint = usdc_mint,
        token::authority = config,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<InitConfig>,
    treasury: Pubkey,
    btc_usd_price_update: Pubkey,
    fee_bps: u16,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.treasury = treasury;
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.btc_usd_price_update = btc_usd_price_update;
    config.fee_bps = fee_bps;
    config.market_count = 0;
    config.vault_bump = ctx.bumps.vault;
    config.bump = ctx.bumps.config;
    msg!(
        "Kestrel config initialized: admin={}, treasury={}, mint={}, btc_usd_price_update={}, fee_bps={}",
        config.admin,
        config.treasury,
        config.usdc_mint,
        config.btc_usd_price_update,
        config.fee_bps
    );
    Ok(())
}
