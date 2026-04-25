use anchor_lang::prelude::*;

use crate::constants::MAX_POSITIONS;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum AgentStatus {
    Active,
    Paused,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct AgentPolicy {
    pub max_stake_per_window: u64,
    pub max_open_positions: u8,
    pub allowed_markets_root: [u8; 32],
    pub paused: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace)]
pub struct OpenPosition {
    pub market_id: u32,
    pub yes_shares: u64,
    pub no_shares: u64,
    pub stake: u64,
    pub settled: bool,
}

impl OpenPosition {
    pub fn is_empty(&self) -> bool {
        self.yes_shares == 0 && self.no_shares == 0 && self.stake == 0 && !self.settled
    }
}

#[account]
#[derive(InitSpace)]
pub struct AgentProfile {
    pub owner: Pubkey,
    pub deposited_amount: u64,
    pub balance: u64,
    pub realized_high_water: u64,
    pub policy: AgentPolicy,
    pub status: AgentStatus,
    pub positions: [OpenPosition; MAX_POSITIONS],
    pub positions_len: u8,
    pub bump: u8,
}

impl AgentProfile {
    pub fn find_or_alloc_slot(&mut self, market_id: u32) -> Option<usize> {
        for i in 0..self.positions.len() {
            if self.positions[i].market_id == market_id && !self.positions[i].is_empty() {
                return Some(i);
            }
        }
        for i in 0..self.positions.len() {
            if self.positions[i].is_empty() {
                self.positions[i] = OpenPosition {
                    market_id,
                    ..Default::default()
                };
                return Some(i);
            }
        }
        None
    }

    pub fn find_position(&self, market_id: u32) -> Option<usize> {
        self.positions
            .iter()
            .position(|p| p.market_id == market_id && !p.is_empty())
    }

    pub fn is_paused(&self) -> bool {
        matches!(self.status, AgentStatus::Paused) || self.policy.paused
    }

    pub fn open_positions_count(&self) -> u8 {
        self.positions
            .iter()
            .filter(|p| !p.is_empty() && !p.settled)
            .count() as u8
    }
}
