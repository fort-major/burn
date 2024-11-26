use std::{cmp::Ordering, u64};

use candid::{decode_one, encode_one, CandidType, Principal};
use ic_e8s::c::E8s;
use ic_stable_structures::{storable::Bound, Storable};
use serde::Deserialize;

use crate::{burner::types::TimestampNs, ONE_MINUTE_NS};

pub const STEPS_PER_MINUTE: u64 = 1;
pub const STEPS_PER_DAY: u64 = STEPS_PER_MINUTE * 60 * 24;
pub const PRICE_UPDATE_DELAY_NS: u64 = ONE_MINUTE_NS / STEPS_PER_MINUTE;

pub const BASE_APD_E8S: u64 = 0_0005_5000;
pub const APD_BONUS_E8S: u64 = 0_0002_8000;

pub const MIN_PRICE_E8S: u64 = 0_2000_0000;
pub const MAX_PRICE_E8S: u64 = 100_0000_0000;

pub const TREND_SIGN_CHANGE_PROBABILITY_E8S: u64 = 0_0100_0000;
pub const TREND_SIGN_CHANGE_PROBABILITY_FACTOR_E8S: u64 = 0_0020_0000;
pub const START_PRICE_E8S: u64 = 1_0000_0000;
pub const TREND_MODIFIER_E8S: u64 = 0_0000_0100;
pub const DEFAULT_TREND_E8S: u64 = 0_0001_0000;

pub const DEFAULT_TOTAL_SUPPLY: u64 = 10_000_000_0000_0000u64;

// %0.3 fee, %0.15 for the inviter, %0.15 for the LPs
pub const INVITERS_CUT_E8S: u64 = 0_0015_0000;
pub const LPS_CUT_E8S: u64 = 0_0015_0000;

pub const TRADING_LP_SUBACCOUNT: [u8; 32] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
];

pub const E8S_BASE_F64: f64 = 1_0000_0000.0;

#[derive(CandidType, Deserialize, Debug, Default, Clone)]
pub struct OrderHistory(pub Vec<Order>);

impl OrderHistory {
    pub fn push(&mut self, order: Order) {
        if self.0.len() == 100 {
            self.0.remove(0);
        }

        self.0.push(order);
    }
}

impl Storable for OrderHistory {
    fn to_bytes(&self) -> std::borrow::Cow<[u8]> {
        std::borrow::Cow::Owned(encode_one(&self.0).expect("Unable to encode"))
    }

    fn from_bytes(bytes: std::borrow::Cow<[u8]>) -> Self {
        OrderHistory(decode_one(&bytes).expect("Unable to decode"))
    }

    const BOUND: Bound = Bound::Unbounded;
}

#[derive(CandidType, Deserialize, Debug)]
pub struct PriceHistoryEntry {
    pub timestamp: TimestampNs,
    pub long: f64,
    pub short: f64,
    pub target: f64,
}

impl Storable for PriceHistoryEntry {
    fn to_bytes(&self) -> std::borrow::Cow<[u8]> {
        let mut buf = vec![0u8; 32];

        buf[0..8].copy_from_slice(&self.timestamp.to_le_bytes());
        buf[8..16].copy_from_slice(&self.long.to_le_bytes());
        buf[16..24].copy_from_slice(&self.short.to_le_bytes());
        buf[24..32].copy_from_slice(&self.target.to_le_bytes());

        std::borrow::Cow::Owned(buf)
    }

    fn from_bytes(bytes: std::borrow::Cow<[u8]>) -> Self {
        let mut timestamp_buf = [0u8; 8];
        let mut long_buf = [0u8; 8];
        let mut short_buf = [0u8; 8];
        let mut target_buf = [0u8; 8];

        timestamp_buf.copy_from_slice(&bytes[0..8]);
        long_buf.copy_from_slice(&bytes[8..16]);
        short_buf.copy_from_slice(&bytes[16..24]);
        target_buf.copy_from_slice(&bytes[24..32]);

        Self {
            timestamp: TimestampNs::from_le_bytes(timestamp_buf),
            long: f64::from_le_bytes(long_buf),
            short: f64::from_le_bytes(short_buf),
            target: f64::from_le_bytes(target_buf),
        }
    }

    const BOUND: Bound = Bound::Bounded {
        max_size: 32,
        is_fixed_size: true,
    };
}

#[derive(CandidType, Deserialize, Debug, Default, Clone)]
pub struct BalancesInfo {
    pub long: E8s,
    pub short: E8s,
    pub real: E8s,

    pub inviter: Option<Principal>,
}

impl Storable for BalancesInfo {
    fn to_bytes(&self) -> std::borrow::Cow<[u8]> {
        std::borrow::Cow::Owned(encode_one(self).expect("Unable to encode"))
    }

    fn from_bytes(bytes: std::borrow::Cow<[u8]>) -> Self {
        decode_one(&bytes).expect("Unable to decode")
    }

    const BOUND: Bound = Bound::Unbounded;
}

#[derive(CandidType, Deserialize, Debug, Clone)]
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

#[derive(CandidType, Deserialize, Debug, Default, Clone)]
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

impl TraderStats {
    pub fn add_buy_long(&mut self, qty: &E8s, now: TimestampNs) {
        self.total_long_bought += qty;

        if self.buy_long_timestamps.len() == 30 {
            self.buy_long_timestamps.remove(0);
        }

        self.buy_long_timestamps.push(now);
    }

    pub fn add_buy_short(&mut self, qty: &E8s, now: TimestampNs) {
        self.total_short_bought += qty;

        if self.buy_short_timestamps.len() == 30 {
            self.buy_short_timestamps.remove(0);
        }

        self.buy_short_timestamps.push(now);
    }

    pub fn add_sell_long(&mut self, qty: &E8s, now: TimestampNs) {
        self.total_long_sold += qty;

        if self.sell_long_timestamps.len() == 30 {
            self.sell_long_timestamps.remove(0);
        }

        self.sell_long_timestamps.push(now);
    }

    pub fn add_sell_short(&mut self, qty: &E8s, now: TimestampNs) {
        self.total_short_sold += qty;

        if self.sell_short_timestamps.len() == 30 {
            self.sell_short_timestamps.remove(0);
        }

        self.sell_short_timestamps.push(now);
    }
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

    pub fn step(&mut self, seed: [u8; 32], now: TimestampNs) -> PriceHistoryEntry {
        let (r1, r2, _, _) = Self::create_random_nums(seed);

        self.update_trend_sign(r1);
        self.update_trend(r2);
        self.update_price();

        let long_u64: u64 = self
            .cur_long_price
            .val
            .clone()
            .try_into()
            .expect("Unable to convert long price");
        let long_f64 = (long_u64 as f64) / E8S_BASE_F64;

        let short_u64: u64 = self
            .cur_short_price
            .val
            .clone()
            .try_into()
            .expect("Unable to convert short price");
        let short_f64 = (short_u64 as f64) / E8S_BASE_F64;

        let target_u64: u64 = self
            .target_price
            .val
            .clone()
            .try_into()
            .expect("Unable to convert target price");
        let target_f64 = (target_u64 as f64) / E8S_BASE_F64;

        PriceHistoryEntry {
            timestamp: now,
            long: long_f64,
            short: short_f64,
            target: target_f64,
        }
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
