use std::u32;

use candid::{decode_one, encode_one, CandidType, Nat, Principal};
use ic_e8s::c::E8s;
use ic_stable_structures::{storable::Bound, Storable};
use serde::Deserialize;
use sha2::Digest;

use crate::{burner::types::TimestampNs, ENV_VARS, ONE_WEEK_NS};

pub const DEFAULT_ROUND_DELAY_NS: u64 = ONE_WEEK_NS;
pub const UPDATE_FURNACE_SEED_DOMAIN: &[u8] = b"msq-burn-furnace-update-seed";
pub const GEN_FURNACE_POSITION_ID_DOMAIN: &[u8] = b"msq-burn-furnace-position-id";
pub const DEFAULT_WINNER_ICP_THRESHOLD: u64 = 1_000_0000_0000; // 1k ICP ~ $10k
pub const MIN_ALLOWED_USD_POSITION_QTY_E8S: u64 = 1_00_0000; // 1 cent

pub const FURNACE_REDISTRIBUTION_SUBACCOUNT: [u8; 32] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
];
pub const FURNACE_DEV_FEE_SUBACCOUNT: [u8; 32] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2,
];
pub const FURNACE_ICP_PRIZE_DISTRIBUTION_SUBACCOUNT: [u8; 32] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3,
];

#[derive(CandidType, Deserialize, Default, Clone)]
pub struct FurnaceInfo {
    pub seed: Vec<u8>,

    pub current_round: u64,
    pub round_delay: u64,
    pub prev_round_timestamp: u64,

    pub icp_won_total: E8s,
    pub cur_token_x: TokenX,

    pub cur_round_pledged_usd: E8s,
    pub cur_round_pledged_burn_usd: E8s,

    pub total_pledged_usd: E8s,
    pub winner_icp_threshold: E8s,

    pub is_looking_for_winners: bool,
    pub is_on_maintenance: bool,
    pub dev_pid: Option<Principal>,
}

#[derive(CandidType, Deserialize, Default, Clone)]
pub struct FurnaceInfoPub {
    pub current_round: u64,
    pub round_delay: u64,
    pub prev_round_timestamp: u64,

    pub icp_won_total: E8s,
    pub cur_token_x: TokenX,

    pub cur_round_pledged_usd: E8s,
    pub cur_round_pledged_burn_usd: E8s,
    pub total_pledged_usd: E8s,
    pub winner_icp_threshold: E8s,

    pub is_looking_for_winners: bool,
    pub is_on_maintenance: bool,
    pub dev_pid: Option<Principal>,
}

impl FurnaceInfo {
    pub fn init(&mut self, dev_pid: Principal, seed: Vec<u8>, now: TimestampNs) {
        self.seed = seed;
        self.round_delay = DEFAULT_ROUND_DELAY_NS;
        self.prev_round_timestamp = now;
        self.winner_icp_threshold = E8s::from(DEFAULT_WINNER_ICP_THRESHOLD);
        self.dev_pid = Some(dev_pid);
    }

    pub fn to_pub(&self) -> FurnaceInfoPub {
        FurnaceInfoPub {
            current_round: self.current_round,
            round_delay: self.round_delay,
            prev_round_timestamp: self.prev_round_timestamp,

            icp_won_total: self.icp_won_total.clone(),
            cur_token_x: self.cur_token_x.clone(),

            cur_round_pledged_usd: self.cur_round_pledged_usd.clone(),
            cur_round_pledged_burn_usd: self.cur_round_pledged_burn_usd.clone(),
            total_pledged_usd: self.total_pledged_usd.clone(),
            winner_icp_threshold: self.winner_icp_threshold.clone(),

            is_looking_for_winners: self.is_looking_for_winners,
            is_on_maintenance: self.is_on_maintenance,
            dev_pid: self.dev_pid,
        }
    }

    pub fn is_dev(&self, pid: &Principal) -> bool {
        &self.dev_pid.unwrap() == pid
    }

    pub fn note_pledged_usd(&mut self, qty: &E8s) {
        self.cur_round_pledged_usd += qty;
        self.total_pledged_usd += qty;
    }

    pub fn note_pledged_burn_usd(&mut self, qty: &E8s) {
        self.cur_round_pledged_burn_usd += qty;
    }

    pub fn update_token_x(&mut self, token_x: TokenX) {
        self.cur_token_x = token_x;
    }

    pub fn complete_round(&mut self, now: TimestampNs) {
        self.current_round += 1;
        self.prev_round_timestamp = now;
        self.cur_round_pledged_usd = E8s::zero();
        self.cur_round_pledged_burn_usd = E8s::zero();

        self.update_seed();
    }

    // TODO: make burn into voting power

    // returns decimal point position if true
    pub fn get_decimals(&self, can_id: &Principal) -> Option<u8> {
        if can_id == &ENV_VARS.burn_token_canister_id {
            Some(8)
        } else if can_id == &self.cur_token_x.can_id {
            Some(self.cur_token_x.decimals)
        } else {
            None
        }
    }

    pub fn burn_token_discount(&self, can_id: &Principal, qty_usd: E8s) -> E8s {
        if can_id == &self.cur_token_x.can_id {
            qty_usd
        } else if can_id == &ENV_VARS.burn_token_canister_id {
            qty_usd * E8s::from(9500_0000u64)
        } else {
            unreachable!();
        }
    }

    pub fn note_won_icps(&mut self, won: &E8s) {
        self.icp_won_total += won;
    }

    // tells you how many winners there will be and amounts of their prizes in ICP
    pub fn calculate_prize_distribution(&self, cur_round_prize_fund_icp: &E8s) -> Vec<E8s> {
        let mut i = E8s::zero();
        let mut result = Vec::new();
        let zero = E8s::zero();
        let mut leftover_prize_icp = cur_round_prize_fund_icp.clone();

        loop {
            if leftover_prize_icp == zero {
                break;
            }

            i += E8s::one();
            result.push(E8s::zero());

            let unit = if leftover_prize_icp < self.winner_icp_threshold {
                leftover_prize_icp.clone()
            } else {
                self.winner_icp_threshold.clone()
            };

            let portion = &unit / &i;

            for it in result.iter_mut() {
                *it += &portion;
            }

            leftover_prize_icp -= unit;
        }

        result
    }

    // generates COUNT random E8s from 0 to 1, updating seed if needed
    pub fn generate_random_numbers(&mut self, count: usize) -> Vec<E8s> {
        let mut result = Vec::new();
        let base = E8s::from(u32::MAX as u64);

        for i in 0..count {
            let idx = i % 8; // because 32 bytes of seed can generate 8 4-byte random numbers

            if idx == 0 {
                self.update_seed();
            }

            let num = self.sample_random_u32(idx);
            let num_e8s = E8s::from(num as u64);
            let num_normalized = num_e8s / &base;

            result.push(num_normalized);
        }

        result
    }

    pub fn generate_random_bools(&mut self, count: usize) -> Vec<bool> {
        let mut result = Vec::new();

        for i in 0..count {
            let idx = i % 32; // because 32 bytes of seed can generate 32 random bools

            if idx == 0 {
                self.update_seed();
            }

            let byte = self.sample_random_u8(idx);
            let random_bool = byte > 127;

            result.push(random_bool);
        }

        result
    }

    fn sample_random_u8(&self, i: usize) -> u8 {
        self.seed[i]
    }

    fn sample_random_u32(&self, i: usize) -> u32 {
        let mut num_buf = [0u8; 4];
        let from = i * 4;
        let to = (i + 1) * 4;

        num_buf.copy_from_slice(&self.seed[from..to]);

        u32::from_le_bytes(num_buf)
    }

    fn update_seed(&mut self) {
        let mut hasher = sha2::Sha256::default();
        hasher.update(UPDATE_FURNACE_SEED_DOMAIN);
        hasher.update(&self.seed);

        self.seed = hasher.finalize().to_vec();
    }

    pub fn get_timer_delay_before_next_round(&self, now: TimestampNs) -> u64 {
        let next_round_timestamp = self.prev_round_timestamp + self.round_delay;

        if now > next_round_timestamp {
            next_round_timestamp - now
        } else {
            0
        }
    }

    pub fn start_looking_for_winners(&mut self) {
        self.is_looking_for_winners = true;
    }

    pub fn stop_looking_for_winners(&mut self) {
        self.is_looking_for_winners = false;
    }

    pub fn start_maintenance(&mut self) {
        self.is_on_maintenance = true;
    }

    pub fn stop_maintenance(&mut self) {
        self.is_on_maintenance = false;
    }
}

impl Storable for FurnaceInfo {
    fn to_bytes(&self) -> std::borrow::Cow<[u8]> {
        std::borrow::Cow::Owned(encode_one(self).expect("Unable to encode"))
    }

    fn from_bytes(bytes: std::borrow::Cow<[u8]>) -> Self {
        decode_one(&bytes).expect("Unable to decode")
    }

    const BOUND: Bound = Bound::Unbounded;
}

#[derive(CandidType, Deserialize, Clone)]
pub struct FurnaceWinnerHistoryEntry {
    pub timestamp: TimestampNs,
    pub token_can_id: Principal,
    pub pledged_usd: E8s,
    pub round: u64,
    pub prize_fund_icp: E8s,
    pub winners: Vec<FurnaceWinner>,
}

impl Storable for FurnaceWinnerHistoryEntry {
    fn to_bytes(&self) -> std::borrow::Cow<[u8]> {
        std::borrow::Cow::Owned(encode_one(self).expect("Unable to encode"))
    }

    fn from_bytes(bytes: std::borrow::Cow<[u8]>) -> Self {
        decode_one(&bytes).expect("Unable to decode")
    }

    const BOUND: Bound = Bound::Unbounded;
}

#[derive(CandidType, Deserialize, Clone)]
pub struct FurnaceWinner {
    pub pid: Principal,
    pub prize_icp: E8s,
    pub claimed: bool,
}

#[derive(CandidType, Deserialize, Clone)]
pub struct TokenX {
    pub can_id: Principal,
    pub fee: Nat,
    pub decimals: u8,
}

impl Default for TokenX {
    fn default() -> Self {
        Self {
            can_id: ENV_VARS.burn_token_canister_id,
            fee: Nat::from(10_000u64),
            decimals: 8,
        }
    }
}

impl Storable for TokenX {
    fn to_bytes(&self) -> std::borrow::Cow<[u8]> {
        std::borrow::Cow::Owned(encode_one(self).expect("Unable to encode"))
    }

    fn from_bytes(bytes: std::borrow::Cow<[u8]>) -> Self {
        decode_one(&bytes).expect("Unable to decode")
    }

    const BOUND: Bound = Bound::Unbounded;
}

#[derive(CandidType, Deserialize, Default, Clone)]
pub struct RaffleRoundInfo {
    pub prize_fund_icp: E8s,
    pub prize_distribution: Vec<E8s>,
    pub random_numbers: Vec<E8s>,
    pub winners: Vec<(Principal, E8s)>,
    pub winner_selection_cursor: Option<Principal>,
    pub elimination_cursor: Option<Principal>,
    pub from: E8s,
}

impl RaffleRoundInfo {
    pub fn match_winner(&mut self, to: &E8s, position_id: Principal) -> bool {
        let mut is_winner = false;
        let mut indices_to_remove = Vec::new();

        for (i, rng) in self.random_numbers.iter().enumerate() {
            if rng <= to {
                self.winners.push((
                    position_id,
                    self.prize_distribution
                        .pop()
                        .expect("A prize should be available"),
                ));
                is_winner = true;
            }

            if is_winner {
                indices_to_remove.push(i);
            }
        }

        for i in indices_to_remove {
            self.random_numbers.remove(i);
        }

        is_winner
    }

    pub fn round_is_over(&self) -> bool {
        self.random_numbers.is_empty()
    }
}

impl Storable for RaffleRoundInfo {
    fn to_bytes(&self) -> std::borrow::Cow<[u8]> {
        std::borrow::Cow::Owned(encode_one(self).expect("Unable to encode"))
    }

    fn from_bytes(bytes: std::borrow::Cow<[u8]>) -> Self {
        decode_one(&bytes).expect("Unable to decode")
    }

    const BOUND: Bound = Bound::Unbounded;
}

#[derive(CandidType, Deserialize, Default, Clone)]
pub struct TokenXVote {
    pub can_ids_and_normalized_weights: Vec<(Principal, E8s)>,
}

impl Storable for TokenXVote {
    fn to_bytes(&self) -> std::borrow::Cow<[u8]> {
        std::borrow::Cow::Owned(encode_one(self).expect("Unable to encode"))
    }

    fn from_bytes(bytes: std::borrow::Cow<[u8]>) -> Self {
        decode_one(&bytes).expect("Unable to decode")
    }

    const BOUND: Bound = Bound::Unbounded;
}
