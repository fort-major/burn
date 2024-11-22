use std::u64;

use candid::{decode_one, encode_one, CandidType, Principal};
use ic_e8s::c::E8s;
use ic_stable_structures::{storable::Bound, Storable};
use serde::Deserialize;

use crate::{burner::types::TimestampNs, ONE_MINUTE_NS};

pub const STEPS_PER_MINUTE: u64 = 1;
pub const STEPS_PER_DAY: u64 = STEPS_PER_MINUTE * 60 * 24;
pub const PRICE_UPDATE_DELAY_NS: u64 = ONE_MINUTE_NS / STEPS_PER_MINUTE;

pub const BASE_APD_E8S: u64 = 55000;
pub const APD_BONUS_E8S: u64 = 28000;

pub const MIN_PRICE_E8S: u64 = 2000_0000;
pub const MAX_PRICE_E8S: u64 = 100_0000_0000;

pub const TREND_SIGN_CHANGE_PROBABILITY_E8S: u64 = 100_0000;
pub const TREND_SIGN_CHANGE_PROBABILITY_FACTOR_E8S: u64 = 20_0000;
pub const START_PRICE_E8S: u64 = 1_0000_0000;
pub const TREND_MODIFIER_E8S: u64 = 100;
pub const DEFAULT_TREND_E8S: u64 = 1_0000;

pub const DEFAULT_TOTAL_SUPPLY: u64 = 10_000_000_0000_0000u64;

#[derive(CandidType, Deserialize, Debug)]
pub struct Order {
    pub pid: Principal,
    pub short: bool,
    pub sell: bool,
    pub base_qty: E8s,
    pub timestmap: TimestampNs,
}

impl Storable for Order {
    fn to_bytes(&self) -> std::borrow::Cow<[u8]> {
        std::borrow::Cow::Owned(encode_one(self).expect("Unable to encode"))
    }

    fn from_bytes(bytes: std::borrow::Cow<[u8]>) -> Self {
        decode_one(&bytes).expect("Unable to decode")
    }

    const BOUND: Bound = Bound::Unbounded;
}

#[derive(CandidType, Deserialize, Debug, Default)]
pub struct TraderStats {
    pub total_long_bought: E8s,
    pub total_short_bought: E8s,
    pub total_long_sold: E8s,
    pub total_short_sold: E8s,

    pub buy_long_timestamps: Vec<TimestampNs>,
    pub buy_short_timestamps: Vec<TimestampNs>,
    pub sell_long_timestamps: Vec<TimestampNs>,
    pub sell_short_timestamps: Vec<TimestampNs>,
}

impl Storable for TraderStats {
    fn to_bytes(&self) -> std::borrow::Cow<[u8]> {
        std::borrow::Cow::Owned(encode_one(self).expect("Unable to encode"))
    }

    fn from_bytes(bytes: std::borrow::Cow<[u8]>) -> Self {
        decode_one(&bytes).expect("Unable to decode")
    }

    const BOUND: Bound = Bound::Unbounded;
}

#[derive(CandidType, Deserialize, Debug, Clone)]
pub struct PriceInfo {
    pub cur_trend: E8s,
    pub cur_trend_sign: bool,

    pub cur_long_price: E8s,
    pub cur_short_price: E8s,

    pub target_price: E8s,
    pub cur_step: u64,

    pub total_supply: E8s,
}

impl PriceInfo {
    pub fn new() -> Self {
        Self {
            cur_trend: E8s::from(DEFAULT_TREND_E8S),
            cur_trend_sign: true,

            cur_long_price: E8s::from(START_PRICE_E8S),
            cur_short_price: E8s::from(START_PRICE_E8S),

            target_price: E8s::from(START_PRICE_E8S),
            cur_step: 0,

            total_supply: E8s::from(DEFAULT_TOTAL_SUPPLY),
        }
    }

    pub fn step(&mut self, seed: [u8; 32]) -> (E8s, E8s, E8s) {
        let (r1, r2, _, _) = Self::create_random_nums(seed);

        self.update_trend_sign(r1);
        self.update_trend(r2);
        self.update_price();

        (
            self.cur_long_price.clone(),
            self.cur_short_price.clone(),
            self.target_price.clone(),
        )
    }

    fn create_random_nums(seed: [u8; 32]) -> (E8s, E8s, E8s, E8s) {
        let mut buf_1 = [0u8; 8];
        let mut buf_2 = [0u8; 8];
        let mut buf_3 = [0u8; 8];
        let mut buf_4 = [0u8; 8];

        buf_1.copy_from_slice(&seed[0..8]);
        buf_2.copy_from_slice(&seed[8..16]);
        buf_3.copy_from_slice(&seed[16..24]);
        buf_4.copy_from_slice(&seed[24..32]);

        let r_1 = E8s::from(u64::from_le_bytes(buf_1));
        let r_2 = E8s::from(u64::from_le_bytes(buf_2));
        let r_3 = E8s::from(u64::from_le_bytes(buf_3));
        let r_4 = E8s::from(u64::from_le_bytes(buf_4));

        let max = E8s::from(u64::MAX);

        (r_1 / &max, r_2 / &max, r_3 / &max, r_4 / max)
    }

    /// the actual price converges back to the target price
    fn update_trend_sign(&mut self, random: E8s) {
        let (d, underpriced, overpriced) = if self.target_price > self.cur_long_price {
            (&self.cur_long_price / &self.target_price, false, true)
        } else if self.target_price < self.cur_long_price {
            (&self.target_price / &self.cur_long_price, true, false)
        } else {
            (E8s::zero(), false, false)
        };

        let m: u64 = (d * E8s::from(TREND_SIGN_CHANGE_PROBABILITY_FACTOR_E8S))
            .val
            .try_into()
            .expect("Unable to downcast the modifier to u64");
        let mut p = TREND_SIGN_CHANGE_PROBABILITY_E8S;

        let (uptrend, downtrend) = if self.cur_trend_sign {
            (true, false)
        } else {
            (false, true)
        };

        if uptrend && overpriced || downtrend && underpriced {
            p += m;
        }

        if uptrend && underpriced || downtrend && overpriced {
            p = p.checked_sub(m).unwrap_or_default();
        }

        let p_e8s = E8s::from(p);

        if random < p_e8s {
            self.cur_trend_sign = !self.cur_trend_sign;
            self.cur_trend = E8s::zero();
        }
    }

    fn update_trend(&mut self, random: E8s) {
        self.cur_trend += E8s::from(TREND_MODIFIER_E8S) * random;
    }

    fn update_price(&mut self) {
        if self.cur_trend_sign {
            self.cur_long_price += &self.cur_trend;
            self.cur_short_price -= &self.cur_trend;
        } else {
            self.cur_long_price -= &self.cur_trend;
            self.cur_short_price += &self.cur_trend;
        }

        if self.cur_step % STEPS_PER_DAY == 0 {
            let apd = self.apd();

            self.cur_long_price += &apd;
            self.cur_short_price += &apd;
            self.target_price += apd;
        }

        let min_price = E8s::from(MIN_PRICE_E8S);
        if self.cur_long_price < min_price {
            self.cur_long_price = min_price.clone();
        }
        if self.cur_short_price < min_price {
            self.cur_short_price = min_price;
        }

        let max_price = E8s::from(MAX_PRICE_E8S);
        if self.cur_long_price > max_price {
            self.cur_long_price = max_price.clone();
        }
        if self.cur_short_price > max_price {
            self.cur_short_price = max_price;
        }
    }

    fn apd(&self) -> E8s {
        let mut base = E8s::from(BASE_APD_E8S);
        let t = E8s::from(DEFAULT_TOTAL_SUPPLY);

        if self.total_supply < t {
            base += (E8s::one() - &self.total_supply / t) * E8s::from(APD_BONUS_E8S);
        }

        base
    }
}

impl Storable for PriceInfo {
    fn to_bytes(&self) -> std::borrow::Cow<[u8]> {
        std::borrow::Cow::Owned(encode_one(self).expect("Unable to encode"))
    }

    fn from_bytes(bytes: std::borrow::Cow<[u8]>) -> Self {
        decode_one(&bytes).expect("Unable to decode")
    }

    const BOUND: Bound = Bound::Unbounded;
}
