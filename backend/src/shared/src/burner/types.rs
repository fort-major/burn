use candid::{CandidType, Nat, Principal};
use ic_cdk::{api::call::CallResult, call};
use ic_e8s::{
    c::{E8s, ECs},
    d::EDs,
};
use ic_stable_structures::{memory_manager::VirtualMemory, DefaultMemoryImpl};
use num_bigint::BigUint;
use serde::Deserialize;

use crate::ONE_MINUTE_NS;

pub type TCycles = ECs<12>;
pub type TimestampNs = u64;
pub type Memory = VirtualMemory<DefaultMemoryImpl>;

pub const TCYCLE_POS_ROUND_BASE_FEE: u64 = 50_000_000_000_u64;

pub const POS_ROUND_START_REWARD_E8S: u64 = 1024_0000_0000_u64;
pub const POS_ROUND_END_REWARD_E8S: u64 = 1_0000_0000_u64;
pub const POS_ROUND_START_DELAY_NS: u64 = ONE_MINUTE_NS * 2;
pub const POS_ROUND_END_DELAY_NS: u64 = ONE_MINUTE_NS * 720;
pub const POS_ROUNDS_PER_HALVING: u64 = 5040;
pub const POS_ACCOUNTS_PER_BATCH: u64 = 300;

pub struct CMCClient(pub Principal);

#[derive(CandidType, Deserialize)]
pub struct NotifyTopUpRequest {
    pub block_index: u64,
    pub canister_id: Principal,
}

#[derive(CandidType, Deserialize, Debug)]
pub enum NotifyTopUpError {
    Refunded {
        block_index: Option<u64>,
        reason: String,
    },
    InvalidTransaction(String),
    Other {
        error_message: String,
        error_code: u64,
    },
    Processing,
    TransactionTooOld(u64),
}

impl CMCClient {
    pub async fn notify_top_up(
        &self,
        req: NotifyTopUpRequest,
    ) -> CallResult<(Result<Nat, NotifyTopUpError>,)> {
        call(self.0, "notify_top_up", (req,)).await
    }
}

#[derive(CandidType, Deserialize, Clone, Default, Debug)]
pub struct BurnerStateInfo {
    pub total_shares_supply: TCycles,
    pub total_tcycles_burned: TCycles,
    pub total_burn_token_minted: E8s,
    pub current_burn_token_reward: E8s,
    pub next_burner_id: Option<Principal>,
    pub seed: Vec<u8>,
    pub current_pos_round: u64,
    pub pos_round_delay_ns: u64,
}

impl BurnerStateInfo {
    pub fn init(&mut self, seed: Vec<u8>) {
        self.seed = seed;
        self.current_burn_token_reward = E8s::from(POS_ROUND_START_REWARD_E8S);
        self.pos_round_delay_ns = POS_ROUND_START_DELAY_NS;
    }

    pub fn complete_round(&mut self) {
        self.current_pos_round += 1;
        self.next_burner_id = None;

        // each 5040 blocks we half the reward, until it reaches 1.0 BURN
        // then we double the block time, until it reaches 720 minutes
        if (self.current_pos_round % POS_ROUNDS_PER_HALVING) == 0 {
            if self.current_burn_token_reward > E8s::from(POS_ROUND_END_REWARD_E8S) {
                self.current_burn_token_reward.val /= BigUint::from(2u64);
            } else if self.pos_round_delay_ns < POS_ROUND_END_DELAY_NS {
                self.pos_round_delay_ns *= 2;
            }
        }
    }

    pub fn note_minted_reward(&mut self, qty: E8s) {
        self.total_burn_token_minted += qty;
    }

    pub fn note_burned_cycles(&mut self, qty: TCycles) {
        self.total_tcycles_burned += qty;
    }

    // the fuel burns with constant speed of 25B/minute
    pub fn get_current_fee(&self) -> TCycles {
        let base_round_fee = TCycles::from(TCYCLE_POS_ROUND_BASE_FEE).to_dynamic();
        let block_time_multiplier = EDs::from((
            self.pos_round_delay_ns / (ONE_MINUTE_NS / 2) * 1_000_000_000_000,
            12,
        ));

        (base_round_fee * block_time_multiplier).to_const()
    }
}
