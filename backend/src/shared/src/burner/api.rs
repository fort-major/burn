use candid::{CandidType, Nat, Principal};
use ic_e8s::c::E8s;
use ic_ledger_types::AccountIdentifier;

use serde::Deserialize;

use super::types::{TCycles, TimestampNs};

#[derive(CandidType, Deserialize)]
pub struct GetBurnersRequest {
    pub start: Option<Principal>,
    pub take: u32,
}

#[derive(CandidType, Deserialize)]
pub struct BurnerInfo {
    pub pid: Principal,
    pub share: TCycles,
    pub unclaimed_reward: E8s,
    pub is_lottery_participant: bool,
    pub lottery_rounds_won: u64,
}

#[derive(CandidType, Deserialize)]
pub struct GetBurnersResponse {
    pub entries: Vec<BurnerInfo>,
}

#[derive(CandidType, Deserialize)]
pub struct GetKamikazesRequest {
    pub start: Option<Principal>,
    pub take: u32,
}

#[derive(CandidType, Deserialize)]
pub struct KamikazeInfo {
    pub pid: Principal,
    pub share: TCycles,
    pub created_at: TimestampNs,
    pub rounds_won: u64,
}

#[derive(CandidType, Deserialize)]
pub struct GetKamikazesResponse {
    pub entries: Vec<KamikazeInfo>,
}

#[derive(CandidType, Deserialize)]
pub struct GetTotalsResponse {
    pub total_share_supply: TCycles,
    pub total_tcycles_burned: TCycles,
    pub total_burn_token_minted: E8s,
    pub current_burn_token_reward: E8s,
    pub pos_start_key: Option<Principal>,
    pub current_pos_round: u64,
    pub pos_round_delay_ns: u64,
    pub current_share_fee: TCycles,
    pub is_lottery_enabled: bool,

    pub total_burners: u64,
    pub total_verified_accounts: u64,
    pub total_lottery_participants: u64,

    pub total_kamikaze_pool_supply: TCycles,
    pub icp_to_cycles_exchange_rate: TCycles,

    pub is_kamikaze_pool_enabled: bool,

    pub your_kamikaze_share_tcycles: TCycles,
    pub your_kamikaze_position_created_at: Option<u64>,
    pub your_share_tcycles: TCycles,
    pub your_unclaimed_reward_e8s: E8s,
    pub your_decide_id_verification_status: bool,
    pub your_lottery_eligibility_status: bool,

    pub icp_spike_target: E8s,
}

#[derive(CandidType, Deserialize)]
pub enum RefundTokenKind {
    ICP(Vec<(AccountIdentifier, u64)>),
}

#[derive(CandidType, Deserialize)]
pub struct RefundLostTokensRequest {
    pub kind: RefundTokenKind,
}

#[derive(CandidType, Deserialize)]
pub struct RefundLostTokensResponse {
    pub results: Vec<Result<Nat, String>>,
}

#[derive(CandidType, Deserialize)]
pub struct ClaimRewardRequest {
    pub to: Principal,
}

#[derive(CandidType, Deserialize)]
pub struct ClaimRewardResponse {
    pub result: Result<Nat, String>,
}

#[derive(CandidType, Deserialize)]
pub struct StakeRequest {
    pub qty_e8s_u64: u64,
}

#[derive(CandidType, Deserialize)]
pub struct StakeResponse {}

#[derive(CandidType, Deserialize)]
pub struct WithdrawRequest {
    pub qty_e8s: E8s,
    pub to: Principal,
}

#[derive(CandidType, Deserialize)]
pub struct WithdrawResponse {
    pub block_idx: Nat,
}

#[derive(CandidType, Deserialize)]
pub struct VerifyDecideIdRequest {
    pub jwt: String,
}

#[derive(CandidType, Deserialize)]
pub struct VerifyDecideIdResponse {}

#[derive(CandidType, Deserialize)]
pub struct MigrateMsqAccountRequest {
    pub to: Principal,
}

#[derive(CandidType, Deserialize)]
pub struct MigrateMsqAccountResponse {}
