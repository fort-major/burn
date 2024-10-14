use candid::{decode_one, encode_one, CandidType, Nat, Principal};
use ic_e8s::{c::E8s, d::EDs};
use ic_stable_structures::{storable::Bound, Storable};
use serde::Deserialize;
use sha2::Digest;

use crate::{
    burner::types::{TCycles, TimestampNs},
    ONE_HOUR_NS,
};

pub type DistributionId = u64;

pub const DEFAULT_TICK_DELAY_NS: u64 = ONE_HOUR_NS;
pub const UPDATE_DISPENSER_SEED_DOMAIN: &[u8] = b"msq-burn-dispenser-update-seed";

#[derive(CandidType, Deserialize, Clone, Default)]
pub struct DispenserInfo {
    pub seed: Vec<u8>,

    pub token_can_id: Option<Principal>,
    pub token_decimals: u8,
    pub token_fee: Nat,

    pub prev_tick_timestamp: TimestampNs,
    pub tick_delay_ns: u64,
    pub cur_tick: u64,

    pub distribution_id_gen: DistributionId,

    pub is_distributing: bool,
    pub is_stopped: bool,

    pub tokens_to_burn: EDs,
    pub total_common_pool_members_weight: TCycles,
    pub total_kamikaze_pool_members_weight: TCycles,
}

impl DispenserInfo {
    pub fn init(
        &mut self,
        seed: Vec<u8>,
        token_can_id: Principal,
        token_decimals: u8,
        token_fee: Nat,
        now: TimestampNs,
    ) {
        self.seed = seed;
        self.prev_tick_timestamp = now;
        self.tick_delay_ns = DEFAULT_TICK_DELAY_NS;
        self.token_can_id = Some(token_can_id);
        self.token_decimals = token_decimals;
        self.token_fee = token_fee;
    }

    pub fn start_round(&mut self) {
        self.cur_tick += 1;
        self.is_distributing = true;
    }

    pub fn complete_round(&mut self, now: TimestampNs) {
        self.prev_tick_timestamp = now;
        self.is_distributing = false;
    }

    pub fn is_stopped(&self) -> bool {
        self.is_distributing || self.is_stopped
    }

    pub fn generate_distribution_id(&mut self) -> DistributionId {
        let id = self.distribution_id_gen;
        self.distribution_id_gen += 1;

        id
    }

    pub fn generate_random_number(&mut self) -> TCycles {
        self.update_seed();

        let mut v_buf = [0u8; 16];
        v_buf.copy_from_slice(&self.seed[0..16]);
        let v = u128::from_le_bytes(v_buf);

        let base = TCycles::from(u128::MAX);
        let value = TCycles::from(v);

        value / base
    }

    fn update_seed(&mut self) {
        let mut hasher = sha2::Sha256::default();
        hasher.update(UPDATE_DISPENSER_SEED_DOMAIN);
        hasher.update(&self.seed);

        self.seed = hasher.finalize().to_vec();
    }
}

impl Storable for DispenserInfo {
    fn to_bytes(&self) -> std::borrow::Cow<[u8]> {
        std::borrow::Cow::Owned(encode_one(self).expect("Unable to encode"))
    }

    fn from_bytes(bytes: std::borrow::Cow<[u8]>) -> Self {
        decode_one(&bytes).expect("Unable to decode")
    }

    const BOUND: Bound = Bound::Unbounded;
}

#[derive(CandidType, Deserialize, Clone)]
pub struct ScheduledDistribution {
    pub id: DistributionId,
    pub owner: Principal,
    pub name: String,

    pub start_at_tick: u64,
    pub duration_ticks: u64,
    pub cur_tick_reward: EDs,

    pub scheme: DistributionScheme,

    pub scheduled_qty: EDs,
    pub leftover_qty: EDs,
}

impl Storable for ScheduledDistribution {
    fn to_bytes(&self) -> std::borrow::Cow<[u8]> {
        std::borrow::Cow::Owned(encode_one(self).expect("Unable to encode"))
    }

    fn from_bytes(bytes: std::borrow::Cow<[u8]>) -> Self {
        decode_one(&bytes).expect("Unable to decode")
    }

    const BOUND: Bound = Bound::Unbounded;
}

#[derive(CandidType, Deserialize, Clone)]
pub enum DistributionScheme {
    Linear,
    Logarithmic,
}

#[derive(CandidType, Deserialize, Default, Clone)]
pub struct CurrentDistributionInfo {
    pub distribution_id: Option<DistributionId>,
    pub common_pool_cursor: Option<Principal>,
    pub kamikaze_pool_cursor: Option<Principal>,
    pub kamikaze_pool_counter: Option<TCycles>,
    pub kamikaze_random_number: Option<TCycles>,
}

impl Storable for CurrentDistributionInfo {
    fn to_bytes(&self) -> std::borrow::Cow<[u8]> {
        std::borrow::Cow::Owned(encode_one(self).expect("Unable to encode"))
    }

    fn from_bytes(bytes: std::borrow::Cow<[u8]>) -> Self {
        decode_one(&bytes).expect("Unable to decode")
    }

    const BOUND: Bound = Bound::Unbounded;
}
