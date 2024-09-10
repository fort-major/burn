use candid::{CandidType, Principal};
use ic_e8s::c::E8s;
use serde::Deserialize;

use super::types::TCycles;

#[derive(CandidType, Deserialize)]
pub struct GetBalanceRequest {
    pub ids: Vec<Principal>,
}

#[derive(CandidType, Deserialize)]
pub struct GetBalanceResponse {
    pub entries: Vec<TCycles>,
}

#[derive(CandidType, Deserialize)]
pub struct GetTotalsResponse {
    pub total_tcycles_supply: TCycles,
    pub total_tcycles_burned: TCycles,
    pub total_burners: u64,
    pub total_burn_token_minted: E8s,
    pub current_burn_token_reward: E8s,
    pub pos_start_key: Option<Principal>,
    pub current_pos_round: u64,
    pub your_share_tcycles: TCycles,
    pub your_unclaimed_reward_e8s: E8s,
}
