use candid::{decode_one, encode_one, CandidType, Nat, Principal};
use garde::Validate;
use ic_e8s::d::EDs;
use ic_stable_structures::{storable::Bound, Storable};
use serde::Deserialize;
use sha2::Digest;

use crate::{
    burner::types::{TCycles, TimestampNs},
    ONE_DAY_NS, ONE_HOUR_NS,
};

pub type DistributionId = u64;

pub const DISPENSER_DEFAULT_TICK_DELAY_NS: u64 = ONE_HOUR_NS;
pub const UPDATE_DISPENSER_SEED_DOMAIN: &[u8] = b"msq-burn-dispenser-update-seed";
pub const DISPENSER_DISTRIBUTION_SUBACCOUNT: [u8; 32] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
];
pub const DISPENSER_ICP_FEE_SUBACCOUNT: [u8; 32] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2,
];
pub const DISPENSER_DEV_FEE_SUBACCOUNT: [u8; 32] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3,
];
pub const DISPENSER_ICP_FEE_E8S: u64 = 9990_0000;
pub const DISPENSER_ICP_FEE_TRANSFORM_DELAY_NS: u64 = ONE_DAY_NS;

#[derive(CandidType, Deserialize, Clone, Default)]
pub struct DispenserInfo {
    pub initted: bool,
    pub seed: Vec<u8>,

    pub token_can_id: Option<Principal>,
    pub token_decimals: u8,
    pub token_fee: Nat,

    pub total_distributed: Nat,

    pub prev_tick_timestamp: TimestampNs,
    pub tick_delay_ns: u64,
    pub cur_tick: u64,

    pub distribution_id_gen: DistributionId,

    pub is_distributing: bool,
    pub is_stopped: bool,

    pub total_common_pool_members_weight: TCycles,
    pub total_bonfire_pool_members_weight: TCycles,
    pub total_kamikaze_pool_members_weight: TCycles,
}

#[derive(CandidType, Deserialize)]
pub struct DispenserInfoPub {
    pub initted: bool,

    pub token_can_id: Option<Principal>,
    pub token_decimals: u8,
    pub token_fee: Nat,

    pub total_distributed: Nat,

    pub prev_tick_timestamp: TimestampNs,
    pub tick_delay_ns: u64,
    pub cur_tick: u64,

    pub is_distributing: bool,
    pub is_stopped: bool,
}

impl DispenserInfo {
    pub fn to_pub(&self) -> DispenserInfoPub {
        DispenserInfoPub {
            initted: self.initted,
            token_can_id: self.token_can_id,
            token_decimals: self.token_decimals,
            token_fee: self.token_fee.clone(),
            total_distributed: self.total_distributed.clone(),
            prev_tick_timestamp: self.prev_tick_timestamp,
            tick_delay_ns: self.tick_delay_ns,
            cur_tick: self.cur_tick,
            is_distributing: self.is_distributing,
            is_stopped: self.is_stopped,
        }
    }

    pub fn init(&mut self, seed: Vec<u8>, token_decimals: u8, token_fee: Nat, now: TimestampNs) {
        self.seed = seed;
        self.prev_tick_timestamp = now;
        self.tick_delay_ns = DISPENSER_DEFAULT_TICK_DELAY_NS;
        self.token_decimals = token_decimals;
        self.token_fee = token_fee;
        self.initted = true;
    }

    pub fn start_round(&mut self) {
        self.cur_tick += 1;
        self.is_distributing = true;
    }

    pub fn complete_round(&mut self, now: TimestampNs) {
        self.total_common_pool_members_weight = TCycles::zero();
        self.total_kamikaze_pool_members_weight = TCycles::zero();
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
pub struct Distribution {
    pub id: DistributionId,
    pub owner: Principal,
    pub name: String,

    pub start_condition: DistributionStartCondition,
    pub status: DistributionStatus,
    pub duration_ticks: u64,
    pub cur_tick_reward: EDs,

    pub hidden: bool,
    pub distribute_to_bonfire: bool,

    pub scheme: DistributionScheme,

    pub scheduled_qty: EDs,
    pub leftover_qty: EDs,
}

impl Distribution {
    pub fn try_to_hidden(mut self) -> Self {
        if matches!(self.status, DistributionStatus::Scheduled) {
            if self.hidden {
                self.leftover_qty = EDs::zero(self.leftover_qty.decimals);
                self.scheduled_qty = EDs::zero(self.leftover_qty.decimals);
                self.cur_tick_reward = EDs::zero(self.leftover_qty.decimals);
            }
        }

        self
    }

    pub fn get_cur_tick_reward(&self, fee: Nat) -> Option<EDs> {
        if self.leftover_qty.val < fee.0 {
            None
        } else if self.leftover_qty < self.cur_tick_reward {
            Some(self.leftover_qty.clone())
        } else {
            Some(self.cur_tick_reward.clone())
        }
    }

    pub fn try_activate(&mut self) -> bool {
        match &mut self.start_condition {
            DistributionStartCondition::AtTickDelay(delay) => {
                *delay -= 1;

                if *delay == 0 {
                    self.status = DistributionStatus::InProgress;
                    true
                } else {
                    false
                }
            }
            DistributionStartCondition::AtFurnaceTrigger => false,
        }
    }

    pub fn try_complete(&mut self, fee: Nat) -> bool {
        if self.get_cur_tick_reward(fee).is_some() {
            false
        } else {
            self.status = DistributionStatus::Completed;
            true
        }
    }
}

impl Storable for Distribution {
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

#[derive(CandidType, Deserialize, Clone, Validate)]
pub enum DistributionStartCondition {
    AtTickDelay(#[garde(range(max = 720))] u64),
    AtFurnaceTrigger,
}

#[derive(CandidType, Deserialize, Clone, Copy)]
pub enum DistributionStatus {
    Scheduled,
    InProgress,
    Canceled,
    Completed,
}

#[derive(CandidType, Deserialize, Default, Clone)]
pub struct CurrentDistributionInfo {
    pub distribution_id: Option<DistributionId>,
    pub common_pool_cursor: Option<Principal>,
    pub bonfire_pool_cursor: Option<Principal>,
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
