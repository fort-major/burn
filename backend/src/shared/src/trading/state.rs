use candid::Principal;
use ic_e8s::c::E8s;
use ic_stable_structures::{Cell, StableBTreeMap, StableVec};

use crate::burner::types::{Memory, TimestampNs};

use super::{
    api::{CandleKind, GetPriceHistoryRequest},
    types::{
        assert_slippage_fit, f64_to_e8s, BalancesInfo, Candle, Order, OrderHistory, PriceInfo,
        TraderStats, INVITERS_CUT_E8S, LPS_CUT_E8S,
    },
};

pub struct TradingState {
    pub price_info: Cell<PriceInfo, Memory>,
    pub stats: StableBTreeMap<Principal, TraderStats, Memory>,
    pub balances: StableBTreeMap<Principal, BalancesInfo, Memory>,

    pub long_price_history_4h: StableVec<Candle, Memory>,
    pub short_price_history_4h: StableVec<Candle, Memory>,

    pub long_price_history_1d: StableVec<Candle, Memory>,
    pub short_price_history_1d: StableVec<Candle, Memory>,

    pub order_history: Cell<OrderHistory, Memory>,

    pub fees_received: StableBTreeMap<Principal, u64, Memory>,
}

impl TradingState {
    pub fn get_price_history(&self, req: GetPriceHistoryRequest) -> Vec<Candle> {
        let v = match req.kind {
            CandleKind::FourHours => {
                if req.short {
                    &self.short_price_history_4h
                } else {
                    &self.long_price_history_4h
                }
            }
            CandleKind::OneDay => {
                if req.short {
                    &self.short_price_history_1d
                } else {
                    &self.long_price_history_1d
                }
            }
        };

        let mut result = Vec::new();
        if v.is_empty() {
            return result;
        }

        let mut from = v.len() as i64;
        from -= req.skip as i64;
        if from < 0 {
            from = 0;
        }

        let mut to = from;
        to -= req.take as i64;
        if to < 0 {
            to = 0;
        }

        for i in to..from {
            result.push(v.get(i as u64).unwrap());
        }

        return result;
    }

    pub fn get_order_history(&self) -> Vec<Order> {
        self.order_history.get().clone().0
    }

    pub fn get_balances_of(&self, pid: &Principal) -> Option<BalancesInfo> {
        self.balances.get(pid).clone()
    }

    pub fn get_stats_of(&self, pid: &Principal) -> TraderStats {
        self.stats.get(pid).map(|it| it.clone()).unwrap_or_default()
    }

    pub fn get_all_stats(
        &self,
        skip: u64,
        take: u64,
    ) -> Vec<(Principal, TraderStats, BalancesInfo)> {
        self.stats
            .iter()
            .skip(skip as usize)
            .take(take as usize)
            .map(|(pid, stats)| (pid, stats, self.balances.get(&pid).unwrap_or_default()))
            .collect()
    }

    pub fn order(
        &mut self,
        pid: Principal,
        sell: bool,
        short: bool,
        qty: E8s,
        expected_price: f64,
        dev_pid: Principal,
        now: TimestampNs,
    ) -> Order {
        let (buy, long) = (!sell, !short);
        let mut balances = self.balances.get(&pid).expect("The user is not registered");
        let mut info = self.get_price_info();

        let base_qty = if buy {
            if balances.real < qty {
                panic!("Unable to buy, insufficient balance");
            }

            balances.real -= &qty;
            let actual_qty = self.pay_fees(&balances, &qty, dev_pid);

            info.total_real = Some(info.total_real.expect("Total real not enough") - &actual_qty);

            if long {
                assert_slippage_fit(expected_price, info.cur_long_price);

                let long_qty = &actual_qty / f64_to_e8s(info.cur_long_price);

                balances.long += &long_qty;
                info.total_long = Some(info.total_long.unwrap_or_default() + long_qty);
            } else {
                assert_slippage_fit(expected_price, info.cur_short_price);

                let short_qty = &actual_qty / f64_to_e8s(info.cur_short_price);

                balances.short += &short_qty;
                info.total_short = Some(info.total_short.unwrap_or_default() + short_qty);
            }

            actual_qty
        } else {
            let base_qty = if long {
                assert_slippage_fit(expected_price, info.cur_long_price);

                if balances.long < qty {
                    panic!("Unable to sell long, insufficient funds");
                }
                balances.long -= &qty;
                info.total_long = Some(info.total_long.expect("Total long not enough") - &qty);

                qty * f64_to_e8s(info.cur_long_price)
            } else {
                assert_slippage_fit(expected_price, info.cur_short_price);

                if balances.short < qty {
                    panic!("Unable to sell short, insufficient funds");
                }
                balances.short -= &qty;
                info.total_short = Some(info.total_short.expect("Total short not enough") - &qty);

                qty * f64_to_e8s(info.cur_short_price)
            };

            info.total_real = Some(info.total_real.unwrap_or_default() + &base_qty);

            let actual_qty = self.pay_fees(&balances, &base_qty, dev_pid);
            balances.real += &actual_qty;

            base_qty
        };

        info.account_volume(short, base_qty.clone());
        self.set_price_info(info);

        self.balances.insert(pid, balances);

        let o = Order {
            pid,
            short,
            sell,
            base_qty: base_qty.clone(),
            timestmap: now,
        };
        self.add_order(o.clone());

        o
    }

    fn pay_fees(&mut self, balances: &BalancesInfo, base_qty: &E8s, dev_pid: Principal) -> E8s {
        if let Some(inviter) = balances.inviter {
            let inviter_qty = base_qty * E8s::from(INVITERS_CUT_E8S);
            let lp_qty = base_qty * E8s::from(LPS_CUT_E8S);

            let result = base_qty - &inviter_qty - &lp_qty;
            self.add_real_to_balance(dev_pid, lp_qty);
            self.add_real_to_balance(inviter, inviter_qty.clone());

            let new_fees: u64 = inviter_qty.val.try_into().unwrap();
            let prev_fees = self.fees_received.get(&inviter).unwrap_or_default();
            self.fees_received.insert(inviter, prev_fees + new_fees);

            result
        } else {
            let lp_qty = base_qty * E8s::from(LPS_CUT_E8S + INVITERS_CUT_E8S);
            let result = base_qty - &lp_qty;

            self.add_real_to_balance(dev_pid, lp_qty);

            result
        }
    }

    pub fn register(&mut self, pid: Principal, inviter: Option<Principal>) {
        if self.balances.contains_key(&pid) {
            panic!("The user is already registered");
        }

        self.balances.insert(
            pid,
            BalancesInfo {
                long: E8s::zero(),
                short: E8s::zero(),
                real: E8s::zero(),
                inviter,
            },
        );
    }

    pub fn deposit(&mut self, user_pid: Principal, user_qty: E8s) {
        let mut info = self.get_price_info();
        info.total_real = Some(info.total_real.unwrap_or_default() + &user_qty);
        self.set_price_info(info);

        self.add_real_to_balance(user_pid, user_qty);
    }

    pub fn withdraw(&mut self, pid: Principal) -> E8s {
        let mut user_balances = self.balances.get(&pid).expect("The user is not registered");
        let real = user_balances.real.clone();

        let mut info = self.get_price_info();
        info.total_real = Some(info.total_real.expect("Total real not enough") - &real);
        self.set_price_info(info);

        user_balances.real = E8s::zero();
        self.balances.insert(pid, user_balances);

        real
    }

    pub fn revert_withdraw(&mut self, pid: Principal, qty: E8s) {
        self.deposit(pid, qty);
    }

    fn add_real_to_balance(&mut self, pid: Principal, qty: E8s) {
        let mut user_balances = self.balances.get(&pid).expect("The user is not registered");
        user_balances.real += qty;
        self.balances.insert(pid, user_balances);
    }

    pub fn increment_prices(&mut self, seed: Vec<u8>, now: TimestampNs) {
        let mut buf = [0u8; 32];
        buf.copy_from_slice(&seed);

        let mut info = self.get_price_info();
        info.step(buf, now);

        let (c_4h_opt, c_1d_opt) = info.try_reset_candles();

        if let Some((long_4h, short_4h)) = c_4h_opt {
            self.long_price_history_4h
                .push(&long_4h)
                .expect("Unable to push long 4h entry");

            self.short_price_history_4h
                .push(&short_4h)
                .expect("Unable to push short 4h entry");
        }

        if let Some((long_1d, short_1d)) = c_1d_opt {
            self.long_price_history_1d
                .push(&long_1d)
                .expect("Unable to push long 1d entry");

            self.short_price_history_1d
                .push(&short_1d)
                .expect("Unable to push short 1d entry");
        }

        self.set_price_info(info);
    }

    pub fn get_price_info(&self) -> PriceInfo {
        self.price_info.get().clone()
    }

    fn add_order(&mut self, order: Order) {
        let mut stat = self.stats.get(&order.pid).unwrap_or_default();
        match (order.sell, order.short) {
            /* buy long */
            (false, false) => stat.add_buy_long(&order.base_qty, order.timestmap),
            /* buy short */
            (false, true) => stat.add_buy_short(&order.base_qty, order.timestmap),
            /* sell long */
            (true, false) => stat.add_sell_long(&order.base_qty, order.timestmap),
            /* sell short */
            (true, true) => stat.add_sell_short(&order.base_qty, order.timestmap),
        }
        self.stats.insert(order.pid, stat);

        let mut order_history = self.order_history.get().clone();
        order_history.push(order);
        self.order_history
            .set(order_history)
            .expect("Unable to store order history");
    }

    pub fn set_price_info(&mut self, info: PriceInfo) {
        self.price_info
            .set(info)
            .expect("Unable to store price info");
    }
}
