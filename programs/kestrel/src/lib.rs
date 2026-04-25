#![allow(unexpected_cfgs)]

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub use constants::*;
pub use error::*;
pub use instructions::*;
pub use state::*;

declare_id!("ELJUMkFGjCAyLu7YWsYN9k8nk3GMtDG1P6BYqBtzVFvd");

#[ephemeral]
#[program]
pub mod kestrel {
    use super::*;

    pub fn init_config(
        ctx: Context<InitConfig>,
        treasury: Pubkey,
        btc_usd_price_update: Pubkey,
        fee_bps: u16,
    ) -> Result<()> {
        instructions::init_config::handler(ctx, treasury, btc_usd_price_update, fee_bps)
    }

    pub fn migrate_config(
        ctx: Context<MigrateConfig>,
        btc_usd_price_update: Pubkey,
    ) -> Result<()> {
        instructions::migrate_config::handler(ctx, btc_usd_price_update)
    }

    pub fn register_agent(ctx: Context<RegisterAgent>, policy: AgentPolicy) -> Result<()> {
        instructions::register_agent::handler(ctx, policy)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    pub fn create_market(
        ctx: Context<CreateMarket>,
        id: u32,
        open_ts: i64,
        close_ts: i64,
    ) -> Result<()> {
        instructions::create_market::handler(ctx, id, open_ts, close_ts)
    }

    pub fn delegate_market(ctx: Context<DelegateMarket>, id: u32) -> Result<()> {
        instructions::delegate_market::handler(ctx, id)
    }

    pub fn delegate_agent(ctx: Context<DelegateAgent>) -> Result<()> {
        instructions::delegate_agent::handler(ctx)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::handler(ctx, amount)
    }

    pub fn open_market(
        ctx: Context<OpenMarket>,
        id: u32,
        seed_liquidity: u64,
    ) -> Result<()> {
        instructions::open_market::handler(ctx, id, seed_liquidity)
    }

    pub fn place_bet(
        ctx: Context<PlaceBet>,
        id: u32,
        side: Outcome,
        amount: u64,
    ) -> Result<()> {
        instructions::place_bet::handler(ctx, id, side, amount)
    }

    pub fn cancel_bet(ctx: Context<CancelBet>, id: u32) -> Result<()> {
        instructions::cancel_bet::handler(ctx, id)
    }

    pub fn close_position(
        ctx: Context<ClosePosition>,
        id: u32,
        side: Outcome,
        shares: u64,
    ) -> Result<()> {
        instructions::close_position::handler(ctx, id, side, shares)
    }

    pub fn halt_market(ctx: Context<HaltMarket>, id: u32) -> Result<()> {
        instructions::halt_market::handle_halt(ctx, id)
    }

    pub fn resume_market(ctx: Context<HaltMarket>, id: u32) -> Result<()> {
        instructions::halt_market::handle_resume(ctx, id)
    }

    pub fn close_market(ctx: Context<CloseMarket>, id: u32) -> Result<()> {
        instructions::close_market::handler(ctx, id)
    }

    pub fn settle_position(
        ctx: Context<SettlePosition>,
        id: u32,
        agent_owner: Pubkey,
    ) -> Result<()> {
        instructions::settle_position::handler(ctx, id, agent_owner)
    }

    pub fn settle_positions<'info>(
        ctx: Context<'_, '_, 'info, 'info, SettlePositions<'info>>,
        id: u32,
    ) -> Result<()> {
        instructions::settle_positions::handler(ctx, id)
    }

    pub fn commit_market(ctx: Context<CommitMarket>, id: u32) -> Result<()> {
        instructions::commit_market::handler(ctx, id)
    }

    pub fn commit_and_undelegate_agent(ctx: Context<CommitAndUndelegateAgent>) -> Result<()> {
        instructions::commit_and_undelegate_agent::handler(ctx)
    }

    pub fn commit_and_undelegate_market(
        ctx: Context<CommitAndUndelegateMarket>,
        id: u32,
    ) -> Result<()> {
        instructions::commit_and_undelegate_market::handler(ctx, id)
    }
}
