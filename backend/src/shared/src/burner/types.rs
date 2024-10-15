use std::{cmp::max, collections::BTreeSet};

use candid::{CandidType, Principal};
use ic_e8s::c::{E8s, ECs};
use ic_stable_structures::{memory_manager::VirtualMemory, DefaultMemoryImpl};
use num_bigint::BigUint;
use serde::Deserialize;
use sha2::Digest;

use crate::{cmc::XdrData, ONE_DAY_NS, ONE_HOUR_NS, ONE_MINUTE_NS, ONE_WEEK_NS};

pub type TCycles = ECs<12>;
pub type TimestampNs = u64;
pub type Memory = VirtualMemory<DefaultMemoryImpl>;

pub const TCYCLE_POS_ROUND_BASE_FEE: u64 = 25_000_000_000_u64;

pub const POS_ROUND_START_REWARD_E8S: u64 = 1024_0000_0000_u64;
pub const POS_ROUND_END_REWARD_E8S: u64 = 1_0000_0000_u64;
pub const POS_ROUND_DELAY_NS: u64 = ONE_MINUTE_NS * 2;
pub const POS_ROUNDS_PER_HALVING: u64 = 5040;
pub const POS_ACCOUNTS_PER_BATCH: u64 = 300;

pub const UPDATE_SEED_DOMAIN: &[u8] = b"msq-burn-update-seed";

pub const BURNER_REDISTRIBUTION_SUBACCOUNT: [u8; 32] = [0u8; 32];
pub const BURNER_SPIKE_SUBACCOUNT: [u8; 32] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
];
pub const BURNER_DEV_FEE_SUBACCOUNT: [u8; 32] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2,
];

pub const REDISTRIBUTION_SPIKE_SHARE_E8S: u64 = 4750_0000; // 47.5%
pub const REDISTRIBUTION_FURNACE_SHARE_E8S: u64 = 5000_0000; // 50%
pub const REDISTRIBUTION_DEV_SHARE_E8S: u64 = 0250_0000; // 2.5%

pub const KAMIKAZE_POOL_POSITION_LIFESPAN_NS: TimestampNs = ONE_DAY_NS;
pub const ICPSWAP_PRICE_UPDATE_INTERVAL_NS: u64 = ONE_MINUTE_NS * 10;
pub const ICP_REDISTRIBUTION_INTERVAL_NS: u64 = ONE_HOUR_NS * 3;
pub const SPIKING_INTERVAL_NS: u64 = ONE_HOUR_NS * 6;
pub const SPIKE_RECORD_DOWNGRADE_TIMEOUT_NS: TimestampNs = ONE_WEEK_NS * 2;
pub const DEFAULT_SPIKE_TARGET_E8S: u64 = 20_000_0000_0000u64; // 20k ICP

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

    pub lottery_enabled: Option<bool>,

    pub kamikaze_pool_total_shares: Option<TCycles>,
    pub next_kamikaze_id: Option<Principal>,
    pub kamikaze_pool_random_number: Option<TCycles>,
    pub kamikaze_pool_counter: Option<TCycles>,
    pub kamikaze_pool_enabled: Option<bool>,

    pub tmp_can_migrate: Option<BTreeSet<Principal>>,

    pub icp_to_cycles_exchange_rate: Option<TCycles>,
    pub icp_burn_spike_target: Option<u64>,
    pub prev_icp_burn_spike_timestamp_ns: Option<TimestampNs>,
}

impl BurnerStateInfo {
    pub fn init(&mut self, seed: Vec<u8>) {
        self.seed = seed;
        self.current_burn_token_reward = E8s::from(POS_ROUND_START_REWARD_E8S);
        self.pos_round_delay_ns = POS_ROUND_DELAY_NS;
    }

    pub fn get_icp_burn_spike_target(&self) -> u64 {
        self.icp_burn_spike_target
            .unwrap_or(DEFAULT_SPIKE_TARGET_E8S)
    }

    pub fn update_icp_burn_spike_target(&mut self, prev_target_reached: bool, now: TimestampNs) {
        if self.prev_icp_burn_spike_timestamp_ns.is_none() {
            self.prev_icp_burn_spike_timestamp_ns = Some(now);
        }

        let prev_target = self.get_icp_burn_spike_target();

        if prev_target_reached {
            self.prev_icp_burn_spike_timestamp_ns = Some(now);
            self.icp_burn_spike_target = Some(prev_target / 2 * 3); // +50% of the current target
        } else {
            let prev_spike_timestamp = self.prev_icp_burn_spike_timestamp_ns.unwrap();

            if now - prev_spike_timestamp > SPIKE_RECORD_DOWNGRADE_TIMEOUT_NS {
                let new_target = max(DEFAULT_SPIKE_TARGET_E8S, prev_target / 2); // -50% of the current target

                self.prev_icp_burn_spike_timestamp_ns = Some(now);
                self.icp_burn_spike_target = Some(new_target);
            }
        }
    }

    pub fn get_icp_to_cycles_exchange_rate(&self) -> TCycles {
        self.icp_to_cycles_exchange_rate
            .clone()
            // shouldn't ever be the case, since we're fetching the rate each 10 minutes, but defaults to 8T per ICP
            .unwrap_or(TCycles::from(8_0000_0000_0000u64))
    }

    pub fn update_icp_to_cycles_exchange_rate(&mut self, new_rate: XdrData) {
        let rate_e4s = ECs::<4>::from(new_rate.xdr_permyriad_per_icp);
        let rate_tcycles = rate_e4s.to_dynamic().to_decimals(12).to_const::<12>();

        self.icp_to_cycles_exchange_rate = Some(rate_tcycles);
    }

    pub fn is_kamikaze_pool_enabled(&self) -> bool {
        self.kamikaze_pool_enabled.unwrap_or_default()
    }

    pub fn enable_kamikaze_pool(&mut self) {
        self.kamikaze_pool_enabled = Some(true);
    }

    pub fn disable_kamikaze_pool(&mut self) {
        self.kamikaze_pool_enabled = Some(false);
    }

    pub fn is_lottery_enabled(&self) -> bool {
        self.lottery_enabled.unwrap_or_default()
    }

    pub fn enable_lottery(&mut self) {
        self.lottery_enabled = Some(true);
    }

    pub fn disable_lottery(&mut self) {
        self.lottery_enabled = Some(false);
    }

    pub fn complete_round(&mut self) {
        self.current_pos_round += 1;
        self.next_burner_id = None;
        self.update_seed();

        // each 5040 blocks we half the reward, until it reaches 0.0014 BURN per block
        if (self.current_pos_round % POS_ROUNDS_PER_HALVING) == 0 {
            let end_reward = E8s::from(POS_ROUND_END_REWARD_E8S);

            if self.current_burn_token_reward > end_reward {
                self.current_burn_token_reward.val /= BigUint::from(2u64);

                if self.current_burn_token_reward < end_reward {
                    self.current_burn_token_reward = end_reward;
                }
            }
        }
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

    pub fn current_winning_idx(&self, total_options: u64) -> u64 {
        let mut rng_buf = [0u8; 8];
        rng_buf.copy_from_slice(&self.seed[0..8]);

        u64::from_le_bytes(rng_buf) % total_options
    }

    pub fn update_seed(&mut self) {
        let mut hasher = sha2::Sha256::default();
        hasher.update(UPDATE_SEED_DOMAIN);
        hasher.update(&self.seed);

        self.seed = hasher.finalize().to_vec();
    }

    pub fn note_minted_reward(&mut self, qty: E8s) {
        self.total_burn_token_minted += qty;
    }

    pub fn note_burned_cycles(&mut self, qty: TCycles) {
        self.total_tcycles_burned += qty;
    }

    pub fn can_migrate(&self, caller: &Principal) -> bool {
        self.tmp_can_migrate
            .as_ref()
            .map(|it| it.contains(caller))
            .unwrap_or_default()
    }

    pub fn note_migrated(&mut self, caller: &Principal) {
        if let Some(can_migrate) = &mut self.tmp_can_migrate {
            can_migrate.remove(caller);
        }
    }

    pub fn get_current_fee() -> TCycles {
        TCycles::from(TCYCLE_POS_ROUND_BASE_FEE)
    }
}
