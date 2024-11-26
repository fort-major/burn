use candid::Principal;
use ic_e8s::c::E8s;
use ic_stable_structures::{Cell, StableBTreeMap, StableVec};

use crate::burner::types::{Memory, TimestampNs};

use super::types::{
    BalancesInfo, Order, OrderHistory, PriceHistoryEntry, PriceInfo, TraderStats, INVITERS_CUT_E8S,
    LPS_CUT_E8S,
};

pub struct TradingState {
    pub price_info: Cell<PriceInfo, Memory>,
    pub stats: StableBTreeMap<Principal, TraderStats, Memory>,
    pub balances: StableBTreeMap<Principal, BalancesInfo, Memory>,

    pub price_history: StableVec<PriceHistoryEntry, Memory>,
    pub order_history: Cell<OrderHistory, Memory>,
}

impl TradingState {
    pub fn get_price_history(&self, skip: u64, take: u64) -> Vec<PriceHistoryEntry> {
        self.price_history
            .iter()
            .rev()
            .skip(skip as usize)
            .take(take as usize)
            .collect()
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

    pub fn get_all_stats(&self, skip: u64, take: u64) -> Vec<(Principal, TraderStats)> {
        let mut iter = self.stats.iter().skip(skip as usize);
        let mut result = Vec::new();

        let mut i = 0;
        loop {
            let e = iter.next();
            if let Some(entry) = e {
                result.push(entry);

                i += 1;
                if i == take {
                    break;
                }
            }

            break;
        }

        result
    }

    pub fn order(&mut self, pid: Principal, sell: bool, short: bool, qty: E8s, now: TimestampNs) {
        let (buy, long) = (!sell, !short);
        let mut balances = self.balances.get(&pid).expect("The user is not registered");
        let info = self.get_price_info();

        let base_qty = if buy {
            if balances.real < qty {
                panic!("Unable to buy, insufficient balance");
            }
            balances.real -= &qty;

            if long {
                balances.long += &qty * info.cur_long_price;
            } else {
                balances.long += &qty * info.cur_short_price;
            }

            qty
        } else {
            let base_qty = if long {
                if balances.long < qty {
                    panic!("Unable to sell long, insufficient funds");
                }
                balances.long -= &qty;
                qty / info.cur_long_price
            } else {
                if balances.short < qty {
                    panic!("Unable to sell short, insufficient funds");
                }
                balances.short -= &qty;
                qty / info.cur_short_price
            };

            balances.real += &base_qty;

            base_qty
        };

        self.balances.insert(pid, balances);
        self.add_order(Order {
            pid,
            short,
            sell,
            base_qty,
            timestmap: now,
        });
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

    pub fn calc_deposit_layout(
        &self,
        pid: Principal,
        qty: &E8s,
    ) -> (E8s, E8s, Option<(Principal, E8s)>) {
        let user_balances = self.balances.get(&pid).expect("The user is not registered");

        if let Some(inviter) = user_balances.inviter {
            if !self.balances.contains_key(&inviter) {
                panic!("The inviter is not registered");
            }

            let inviters_cut = qty * E8s::from(INVITERS_CUT_E8S);
            let lps_cut = qty * E8s::from(LPS_CUT_E8S);
            let user_cut = qty - (&inviters_cut + &lps_cut);

            (user_cut, lps_cut, Some((inviter, inviters_cut)))
        } else {
            let lps_cut = qty * (E8s::from(LPS_CUT_E8S) + E8s::from(INVITERS_CUT_E8S));
            let user_cut = qty - &lps_cut;

            (user_cut, lps_cut, None)
        }
    }

    // call calc_deposit_layout() first
    pub fn deposit(
        &mut self,
        user_pid: Principal,
        user_qty: E8s,
        inviter: Option<(Principal, E8s)>,
    ) {
        self.add_real_to_balance(user_pid, user_qty);

        if let Some((inviter_pid, inviter_qty)) = inviter {
            self.add_real_to_balance(inviter_pid, inviter_qty);
        }
    }

    pub fn withdraw(&mut self, pid: Principal) -> E8s {
        let mut user_balances = self.balances.get(&pid).expect("The user is not registered");
        let real = user_balances.real.clone();

        user_balances.real = E8s::zero();
        self.balances.insert(pid, user_balances);

        real
    }

    pub fn revert_withdraw(&mut self, pid: Principal, qty: E8s) {
        self.add_real_to_balance(pid, qty);
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
        let entry = info.step(buf, now);

        self.price_history
            .push(&entry)
            .expect("OOM: unable to store price history entry");

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
        self.order_history.set(order_history);
    }

    fn set_price_info(&mut self, info: PriceInfo) {
        self.price_info
            .set(info)
            .expect("Unable to store price info");
    }
}
