use candid::{CandidType, Principal};
use ic_e8s::c::E8s;
use serde::Deserialize;

use super::types::TCycles;

#[derive(CandidType, Deserialize)]
pub struct GetBurnersRequest {
    pub start: Option<Principal>,
    pub take: u32,
}

#[derive(CandidType, Deserialize)]
pub struct GetBurnersResponse {
    pub entries: Vec<(Principal, TCycles, E8s)>,
}

#[derive(CandidType, Deserialize)]
pub struct GetTotalsResponse {
    pub total_share_supply: TCycles,
    pub total_tcycles_burned: TCycles,
    pub total_burners: u64,
    pub total_burn_token_minted: E8s,
    pub current_burn_token_reward: E8s,
    pub pos_start_key: Option<Principal>,
    pub current_pos_round: u64,
    pub pos_round_delay_ns: u64,
    pub current_share_fee: TCycles,
    pub your_share_tcycles: TCycles,
    pub your_unclaimed_reward_e8s: E8s,
}
