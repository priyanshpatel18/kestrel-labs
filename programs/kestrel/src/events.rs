use anchor_lang::prelude::*;

use crate::state::{AgentPolicy, Outcome};

/// Emitted by `register_agent` after a new AgentProfile PDA has been
/// initialised. Indexer keys the per-agent feed off this event.
#[event]
pub struct AgentRegistered {
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub policy: AgentPolicy,
    pub slot: u64,
}

/// Emitted by `update_policy` (and any future policy mutation paths). Carries
/// the full old and new policy so the timeline can render a diff card.
#[event]
pub struct PolicyUpdated {
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub old: AgentPolicy,
    pub new: AgentPolicy,
    pub slot: u64,
}

/// Emitted on every successful `place_bet`. Anchor reverts emits on failure,
/// so this fires only when the bet actually moved reserves; the matching
/// `PlaceBetAttempted` / `PlaceBetBlocked` rows are synthesised by the indexer
/// from the failed-tx ix decode.
#[event]
pub struct BetPlaced {
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub market_id: u32,
    pub side: Outcome,
    pub amount: u64,
    pub shares_out: u64,
    pub yes_reserve: u128,
    pub no_reserve: u128,
    pub slot: u64,
}

#[event]
pub struct MarketHalted {
    pub market_id: u32,
    pub by: Pubkey,
    pub slot: u64,
}

#[event]
pub struct MarketResumed {
    pub market_id: u32,
    pub by: Pubkey,
    pub slot: u64,
}

#[event]
pub struct MarketClosed {
    pub market_id: u32,
    pub strike: i64,
    pub close_price: i64,
    pub winner: Outcome,
    pub slot: u64,
}

/// One per agent settled in `settle_position` / `settle_positions`. `payout`
/// is the gross share-to-USDC payout credited to `agent.balance`. Fee is zero
/// here — the protocol fee is taken at `withdraw` time.
#[event]
pub struct AgentSettled {
    pub owner: Pubkey,
    pub market_id: u32,
    pub side_won: Outcome,
    pub payout: u64,
    pub slot: u64,
}

#[event]
pub struct Withdrawn {
    pub owner: Pubkey,
    pub amount_gross: u64,
    pub principal: u64,
    pub profit: u64,
    pub fee: u64,
    pub amount_net: u64,
    pub slot: u64,
}
