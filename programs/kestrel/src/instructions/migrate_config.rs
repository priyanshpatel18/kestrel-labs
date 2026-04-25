use anchor_lang::prelude::*;
use anchor_lang::solana_program::rent::Rent;

use crate::constants::CONFIG_SEED;
use crate::error::KestrelError;
use crate::state::Config;

/// Old devnet Config layout (pre oracle field).
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ConfigV1 {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub usdc_mint: Pubkey,
    pub fee_bps: u16,
    pub market_count: u32,
    pub vault_bump: u8,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct MigrateConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: we validate PDA + discriminator + admin manually, then realloc + rewrite.
    #[account(mut, seeds = [CONFIG_SEED], bump)]
    pub config: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<MigrateConfig>, btc_usd_price_update: Pubkey) -> Result<()> {
    let ai = ctx.accounts.config.to_account_info();
    let data = ai.try_borrow_data()?;

    // Validate discriminator matches the (old) Config account type.
    let disc = <Config as anchor_lang::Discriminator>::DISCRIMINATOR;
    require!(data.len() >= 8, KestrelError::OracleDeserialize);
    require!(&data[0..8] == disc, KestrelError::OracleDeserialize);

    // Decode v1 payload from bytes after discriminator.
    let mut payload: &[u8] = &data[8..];
    let old = ConfigV1::deserialize(&mut payload)
        .map_err(|_| KestrelError::OracleDeserialize)?;

    require!(
        old.admin == ctx.accounts.admin.key(),
        KestrelError::Unauthorized
    );

    // Realloc the account to the new size and top up rent if needed.
    let new_len = 8 + Config::INIT_SPACE;
    let old_len = data.len();
    drop(data); // release borrow before realloc

    if old_len != new_len {
        let rent = Rent::get()?;
        let needed = rent.minimum_balance(new_len);
        let have = ai.lamports();
        if have < needed {
            let topup = needed.saturating_sub(have);
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.admin.to_account_info(),
                        to: ai.clone(),
                    },
                ),
                topup,
            )?;
        }
        ai.resize(new_len)?;
    }

    // Write new config struct (with the same discriminator).
    let upgraded = Config {
        admin: old.admin,
        treasury: old.treasury,
        usdc_mint: old.usdc_mint,
        btc_usd_price_update,
        fee_bps: old.fee_bps,
        market_count: old.market_count,
        vault_bump: old.vault_bump,
        bump: old.bump,
    };

    let mut new_data = ai.try_borrow_mut_data()?;
    let mut dst: &mut [u8] = &mut new_data;
    upgraded.try_serialize(&mut dst)?; // writes discriminator + borsh payload

    msg!(
        "Config migrated: btc_usd_price_update={}",
        upgraded.btc_usd_price_update
    );
    Ok(())
}

