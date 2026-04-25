use anchor_lang::prelude::*;

use crate::constants::ORACLE_MAX_AGE_SECS;
use crate::error::KestrelError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum VerificationLevel {
    Partial { num_signatures: u8 },
    Full,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct PriceFeedMessage {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
    pub prev_publish_time: i64,
    pub ema_price: i64,
    pub ema_conf: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PriceUpdateLite {
    pub write_authority: Pubkey,
    pub verification_level: VerificationLevel,
    pub price_message: PriceFeedMessage,
    pub posted_slot: u64,
}

impl PriceUpdateLite {
    pub fn try_from_account_data(data: &[u8]) -> Result<Self> {
        require!(data.len() > 8, KestrelError::OracleDeserialize);
        let mut payload = &data[8..];
        let parsed = <PriceUpdateLite as AnchorDeserialize>::deserialize(&mut payload)
            .map_err(|_| KestrelError::OracleDeserialize)?;
        Ok(parsed)
    }

    pub fn price_no_older_than(&self, now: i64) -> Result<i64> {
        let max_age = ORACLE_MAX_AGE_SECS as i64;
        let age = now.saturating_sub(self.price_message.publish_time);
        require!(age >= 0, KestrelError::OracleStale);
        require!(age <= max_age, KestrelError::OracleStale);
        Ok(self.price_message.price)
    }
}

pub fn read_oracle_price(price_update_ai: &AccountInfo, clock: &Clock) -> Result<i64> {
    let data = price_update_ai.try_borrow_data()?;
    let update = PriceUpdateLite::try_from_account_data(&data)?;
    update.price_no_older_than(clock.unix_timestamp)
}
