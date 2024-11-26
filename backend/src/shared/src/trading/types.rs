use std::{cmp::Ordering, u64};

use candid::{decode_one, encode_one, CandidType, Principal};
use ic_e8s::c::E8s;
use ic_stable_structures::{storable::Bound, Storable};
use serde::Deserialize;

use crate::{burner::types::TimestampNs, ONE_MINUTE_NS};

pub const STEPS_PER_MINUTE: u64 = 1;
pub const STEPS_PER_DAY: u64 = STEPS_PER_MINUTE * 60 * 24;
pub const PRICE_UPDATE_DELAY_NS: u64 = ONE_MINUTE_NS / STEPS_PER_MINUTE;

pub const BASE_APD: f64 = 0.00055;
pub const APD_BONUS: f64 = 0.00028;

pub const MIN_PRICE: f64 = 0.01;
pub const MAX_PRICE: f64 = 100.0;

pub const TREND_SIGN_CHANGE_PROBABILITY: f64 = 0.008;
pub const TREND_SIGN_CHANGE_PROBABILITY_FACTOR: f64 = 0.002;
pub const START_PRICE: f64 = 1.0;
pub const TREND_MODIFIER: f64 = 0.0000011;
pub const DEFAULT_TREND: f64 = 0.0001;

pub const VOLATILITY_MAX_SPIKE: f64 = 0.003;
pub const VOLATILITY_SPIKE_CHACE: f64 = 0.1;

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
    pub cur_trend: f64,
    pub cur_trend_sign: bool,

    pub cur_long_price: f64,
    pub cur_short_price: f64,
    pub target_price: f64,

    pub cur_step: u64,

    pub total_supply: E8s,
}

impl PriceInfo {
    pub fn new() -> Self {
        Self {
            cur_trend: DEFAULT_TREND,
            cur_trend_sign: true,

            cur_long_price: START_PRICE,
            cur_short_price: START_PRICE,
            target_price: START_PRICE,

            cur_step: 0,

            total_supply: E8s::from(DEFAULT_TOTAL_SUPPLY),
        }
    }

    pub fn step(&mut self, seed: [u8; 32], now: TimestampNs) -> PriceHistoryEntry {
        let (r1, r2, r3, r4) = Self::create_random_nums(seed);

        self.update_trend_sign(r1);
        self.update_trend(r2);
        self.update_price(r3, r4);

        self.cur_step += 1;

        PriceHistoryEntry {
            timestamp: now,
            long: self.cur_long_price,
            short: self.cur_short_price,
            target: self.target_price,
        }
    }

    fn bytes_to_f64(s: &[u8]) -> f64 {
        let mut buf = [0u8; 8];
        buf.copy_from_slice(&s);

        let as_u64 = u64::from_le_bytes(buf);
        as_u64 as f64 / u64::MAX as f64
    }

    fn create_random_nums(seed: [u8; 32]) -> (f64, f64, f64, f64) {
        let r_1 = Self::bytes_to_f64(&seed[0..8]);
        let r_2 = Self::bytes_to_f64(&seed[8..16]);
        let r_3 = Self::bytes_to_f64(&seed[16..24]);
        let r_4 = Self::bytes_to_f64(&seed[24..32]);

        (r_1, r_2, r_3, r_4)
    }

    /// the actual price converges back to the target price
    fn update_trend_sign(&mut self, random: f64) {
        let (d, underpriced, overpriced) = if self.target_price > self.cur_long_price {
            (&self.cur_long_price / &self.target_price, false, true)
        } else if self.target_price < self.cur_long_price {
            (&self.target_price / &self.cur_long_price, true, false)
        } else {
            (0.0, false, false)
        };

        let m = d * TREND_SIGN_CHANGE_PROBABILITY_FACTOR;
        let mut p = TREND_SIGN_CHANGE_PROBABILITY;

        let (uptrend, downtrend) = if self.cur_trend_sign {
            (true, false)
        } else {
            (false, true)
        };

        if uptrend && overpriced || downtrend && underpriced {
            p += m;
        }

        if uptrend && underpriced || downtrend && overpriced {
            p -= m;
        }

        if random < p {
            self.cur_trend_sign = !self.cur_trend_sign;
            self.cur_trend = 0.0;
        }
    }

    fn update_trend(&mut self, random: f64) {
        self.cur_trend += TREND_MODIFIER * random;
    }

    fn update_price(&mut self, r1: f64, r2: f64) {
        if self.cur_trend_sign {
            self.cur_long_price += &self.cur_trend;
            self.cur_short_price -= &self.cur_trend;
        } else {
            self.cur_long_price -= &self.cur_trend;
            self.cur_short_price += &self.cur_trend;
        }

        if r1 < VOLATILITY_SPIKE_CHACE {
            let spike = VOLATILITY_MAX_SPIKE * r2;

            if self.cur_trend_sign {
                self.cur_long_price -= spike;
                self.cur_short_price += spike;
            } else {
                self.cur_long_price += spike;
                self.cur_short_price -= spike;
            }
        }

        if self.cur_step % STEPS_PER_DAY == 0 {
            let apd = self.apd();

            self.cur_long_price += &apd;
            self.cur_short_price += &apd;
            self.target_price += apd;
        }

        if self.cur_long_price < MIN_PRICE {
            self.cur_long_price = MIN_PRICE;
        }
        if self.cur_short_price < MIN_PRICE {
            self.cur_short_price = MIN_PRICE;
        }

        if self.cur_long_price > MAX_PRICE {
            self.cur_long_price = MAX_PRICE;
        }
        if self.cur_short_price > MAX_PRICE {
            self.cur_short_price = MAX_PRICE;
        }
    }

    fn apd(&self) -> f64 {
        let mut apd = BASE_APD;
        let t = E8s::from(DEFAULT_TOTAL_SUPPLY);

        if self.total_supply < t {
            let bonus_factor_e8s = E8s::one() - &self.total_supply / t;

            apd += e8s_to_f64(bonus_factor_e8s) * APD_BONUS;
        }

        apd
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

pub fn e8s_to_f64(e8s: E8s) -> f64 {
    let val_u64: u64 = e8s.val.try_into().expect("Unable to convert long price");

    (val_u64 as f64) / E8S_BASE_F64
}

pub fn f64_to_e8s(f: f64) -> E8s {
    let val_u64 = (f * E8S_BASE_F64) as u64;

    E8s::from(val_u64)
}

#[cfg(test)]
mod tests {
    use plotlib::{page::Page, repr::Plot, style::LineStyle, view::ContinuousView};
    use rand::{thread_rng, Rng};
    use std::{fs, u64};

    use super::{PriceInfo, STEPS_PER_DAY};

    const TOTAL_POINTS: u64 = STEPS_PER_DAY * 365;

    #[test]
    fn generate_example_price_chart() {
        let mut rng = thread_rng();

        let mut info = PriceInfo::new();

        let mut long_price = Vec::new();
        let mut short_price = Vec::new();
        let mut target_price = Vec::new();

        let mut seed = [0u8; 32];
        let mut max_price = 1.0;

        for i in 0..TOTAL_POINTS {
            rng.fill(&mut seed);

            let entry = info.step(seed, i);

            if entry.long > max_price {
                max_price = entry.long;
            }
            if entry.short > max_price {
                max_price = entry.short;
            }

            long_price.push((i as f64, entry.long));
            short_price.push((i as f64, entry.short));
            target_price.push((i as f64, entry.target));
        }

        let long_chart: Plot = Plot::new(long_price)
            .line_style(LineStyle::new().colour("green").width(1.0))
            .legend(String::from("Long Price"));

        let short_chart: Plot = Plot::new(short_price)
            .line_style(LineStyle::new().colour("red").width(1.0))
            .legend(String::from("Short Price"));

        let target_chart: Plot = Plot::new(target_price)
            .line_style(LineStyle::new().colour("gray").width(1.0))
            .legend(String::from("Expected Price"));

        let view = ContinuousView::new()
            .add(long_chart)
            //.add(short_chart)
            .add(target_chart)
            .x_label("Minutes")
            .y_label("Prices");

        let svg_content = Page::single(&view).to_svg().unwrap().to_string();

        let mut id_buf = [0u8; 8];
        rng.fill(&mut id_buf);
        let id = u64::from_le_bytes(id_buf);
        let file_name = format!("test_plot_{}.svg", id);

        fs::write(file_name.clone(), svg_content).unwrap();

        opener::open(file_name).expect("Unable to open");
    }
}
