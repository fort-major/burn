use std::{collections::BTreeMap, u32};

use candid::{decode_one, encode_one, CandidType, Nat, Principal};
use ic_e8s::{c::E8s, d::EDs};
use ic_stable_structures::{storable::Bound, Storable};
use serde::Deserialize;
use sha2::Digest;

use crate::{burner::types::TimestampNs, ONE_WEEK_NS};

pub const DEFAULT_ROUND_DELAY_NS: u64 = ONE_WEEK_NS;
pub const UPDATE_FURNACE_SEED_DOMAIN: &[u8] = b"msq-burn-furnace-update-seed";
pub const GEN_FURNACE_POSITION_ID_DOMAIN: &[u8] = b"msq-burn-furnace-position-id";
pub const DEFAULT_WINNER_USD_THRESHOLD: u64 = 10_000_0000_0000; // $10k
pub const MIN_ALLOWED_USD_BURN_QTY_E8S: u64 = 1_00_0000; // 1 cent

pub type PositionId = [u8; 32];

#[derive(CandidType, Deserialize, Default, Clone)]
pub struct FurnaceInfo {
    pub seed: Vec<u8>,

    pub current_round: u64,
    pub round_delay: u64,
    pub prev_round_timestamp: u64,

    pub usd_burnt_total: E8s,
    pub usd_burnt_cur_round: E8s,

    pub icp_won_total: E8s,
    pub whitelisted_tokens: BTreeMap<Principal, WhitelistedToken>,

    pub winner_usd_threshold: E8s,
    pub icp_exchange_rate_usd: E8s,

    pub is_looking_for_winners: bool,
    pub is_on_maintenance: bool,
}

impl FurnaceInfo {
    pub fn init(&mut self, seed: Vec<u8>, now: TimestampNs) {
        self.seed = seed;
        self.round_delay = DEFAULT_ROUND_DELAY_NS;
        self.prev_round_timestamp = now;
        self.winner_usd_threshold = E8s::from(DEFAULT_WINNER_USD_THRESHOLD);
    }

    pub fn whitelist_token(
        &mut self,
        can_id: Principal,
        minter_account_owner: Principal,
        minter_account_subaccount: Option<[u8; 32]>,
        fee: Nat,
        exchange_rate_usd: E8s,
        decimals: u8,
    ) {
        let token_info = WhitelistedToken {
            can_id,
            minter_account_owner,
            minter_account_subaccount,
            is_enabled: true,
            fee: EDs::new(fee.0, decimals),
            exchange_rate_usd,
            burnt_this_round: EDs::zero(decimals),
            burnt_total: EDs::zero(decimals),
        };

        self.whitelisted_tokens.insert(can_id, token_info);
    }

    pub fn get_whitelisted_token_usd_value(&self, can_id: &Principal, qty: Nat) -> Option<E8s> {
        if let Some(token) = self.whitelisted_tokens.get(can_id) {
            let qty_eds = EDs::new(qty.0, token.fee.decimals);
            let qty_e8s = qty_eds.to_decimals(8).to_const::<8>();

            Some(qty_e8s * &token.exchange_rate_usd)
        } else {
            None
        }
    }

    pub fn enable_whitelisted_token(&mut self, can_id: &Principal) {
        if let Some(token) = self.whitelisted_tokens.get_mut(can_id) {
            token.is_enabled = true;
        }
    }

    pub fn disable_whitelisted_token(&mut self, can_id: &Principal) {
        if let Some(token) = self.whitelisted_tokens.get_mut(can_id) {
            token.is_enabled = false;
        }
    }

    pub fn complete_round(&mut self, now: TimestampNs) {
        self.current_round += 1;
        self.prev_round_timestamp = now;
        self.usd_burnt_cur_round = E8s::zero();

        for token in self.whitelisted_tokens.values_mut() {
            token.burnt_this_round = EDs::zero(token.burnt_this_round.decimals);
        }

        self.update_seed();
    }

    pub fn can_burn_token(&self, can_id: &Principal) -> Option<E8s> {
        if let Some(token) = self.whitelisted_tokens.get(can_id) {
            if token.is_enabled {
                Some(token.exchange_rate_usd.clone())
            } else {
                None
            }
        } else {
            None
        }
    }

    /// Precondition: token is whitelisted and enabled, returns the amount of burned funds in USD
    pub fn note_burned_tokens(&mut self, can_id: &Principal, qty: Nat) -> E8s {
        let token = self
            .whitelisted_tokens
            .get_mut(can_id)
            .expect("The token is not whitelisted");

        let decimals = token.fee.decimals;
        let exchange_rate = &token.exchange_rate_usd;

        let qty_eds = EDs::new(qty.0, decimals);
        let qty_e8s = qty_eds.clone().to_decimals(8).to_const::<8>();

        let result = qty_e8s * exchange_rate;

        token.burnt_this_round += &qty_eds;
        token.burnt_total += &qty_eds;

        self.usd_burnt_total += &result;
        self.usd_burnt_cur_round += &result;

        result
    }

    pub fn note_won_icps(&mut self, won: &E8s) {
        self.icp_won_total += won;
    }

    // tells you how many winners there will be and amounts of their prizes
    pub fn calculate_prize_distribution(&self, cur_round_prize_fund_icp: E8s) -> Vec<E8s> {
        let mut i = E8s::zero();
        let mut result = Vec::new();
        let zero = E8s::zero();
        let mut cur_round_prize_fund_usd = cur_round_prize_fund_icp * &self.icp_exchange_rate_usd;

        loop {
            if cur_round_prize_fund_usd == zero {
                break;
            }

            i += E8s::one();
            result.push(E8s::zero());

            let unit = if cur_round_prize_fund_usd < self.winner_usd_threshold {
                cur_round_prize_fund_usd.clone()
            } else {
                self.winner_usd_threshold.clone()
            };

            let portion = &unit / &i;

            for it in result.iter_mut() {
                *it += &portion;
            }

            cur_round_prize_fund_usd -= unit;
        }

        result
    }

    pub fn generate_position_id(&mut self) -> PositionId {
        let mut hasher = sha2::Sha256::default();
        hasher.update(GEN_FURNACE_POSITION_ID_DOMAIN);
        hasher.update(&self.seed);

        self.update_seed();

        hasher.finalize().into()
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

            let num = self.generate_random_u32(idx);
            let num_e8s = E8s::from(num as u64);
            let num_normalized = num_e8s / &base;

            result.push(num_normalized);
        }

        result
    }

    fn generate_random_u32(&self, i: usize) -> u32 {
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
    pub round: u64,
    pub jackpot: E8s,
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
    pub position: FurnacePosition,
    pub prize_icp: E8s,
}

#[derive(CandidType, Deserialize, Clone)]
pub struct FurnacePosition {
    pub id: PositionId,
    pub owner_pid: Principal,
    pub participant_pid: Principal,
    pub title: Option<String>,
    pub link: Option<String>,
}

impl Storable for FurnacePosition {
    fn to_bytes(&self) -> std::borrow::Cow<[u8]> {
        std::borrow::Cow::Owned(encode_one(self).expect("Unable to encode"))
    }

    fn from_bytes(bytes: std::borrow::Cow<[u8]>) -> Self {
        decode_one(&bytes).expect("Unable to decode")
    }

    const BOUND: Bound = Bound::Unbounded;
}

#[derive(CandidType, Deserialize, Clone)]
pub struct WhitelistedToken {
    pub can_id: Principal,
    pub is_enabled: bool,
    pub minter_account_owner: Principal,
    pub minter_account_subaccount: Option<[u8; 32]>,

    pub fee: EDs,
    pub exchange_rate_usd: E8s,
    pub burnt_this_round: EDs,
    pub burnt_total: EDs,
}

impl Storable for WhitelistedToken {
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
    pub prize_distribution: Vec<E8s>,
    pub random_numbers: Vec<E8s>,
    pub winners: Vec<(PositionId, E8s)>,
    pub cursor: Option<PositionId>,
    pub from: E8s,
}

impl RaffleRoundInfo {
    pub fn match_winner(&mut self, to: &E8s, position_id: PositionId, votes: E8s) -> bool {
        let mut is_winner = false;
        for i in 0..self.random_numbers.len() {
            {
                let rng = self.random_numbers.get(i).unwrap();

                if rng >= &self.from && rng <= to {
                    self.winners.push((position_id, votes.clone()));
                    is_winner = true;
                }
            }

            if is_winner {
                self.random_numbers.remove(i);
            }
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
