use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

#[constant]
pub const AGENT_SEED: &[u8] = b"agent";

#[constant]
pub const MARKET_SEED: &[u8] = b"market";

pub const MAX_POSITIONS: usize = 16;

pub const MIN_SEED_LIQUIDITY: u64 = 1_000_000;

pub const DEFAULT_FEE_BPS: u16 = 100;

pub const ORACLE_MAX_AGE_SECS: u64 = 60;

pub const BTC_USD_FEED: Pubkey = pubkey!("71wtTRDY8Gxgw56bXFt2oc6qeAbTxzStdNiC425Z51sr");
