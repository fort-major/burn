use candid::{Nat, Principal};
use ic_e8s::{c::E8s, d::EDs};
use ic_stable_structures::{Cell, Log, StableBTreeMap};

use crate::burner::types::{Memory, TimestampNs};

use super::types::{Order, PriceInfo, TraderStats};

pub struct TradingState {
    pub price_info: Cell<PriceInfo, Memory>,

    pub stats: StableBTreeMap<Principal, TraderStats, Memory>,

    // pid -> (long, short, real)
    pub balances: StableBTreeMap<Principal, (EDs, EDs, EDs), Memory>,
    // timestamp -> (long, short, target)
    pub price_history: StableBTreeMap<TimestampNs, (EDs, EDs, EDs), Memory>,

    pub order_history: StableBTreeMap<TimestampNs, Order, Memory>,
}

impl TradingState {
    pub fn order(&mut self, pid: Principal, sell: bool, short: bool, qty: E8s, now: TimestampNs) {
        let (buy, long) = (!sell, !short);
        let (mut long_balance, mut short_balance, mut real_balance) = self.get_balances(&pid);
        let info = self.get_price_info();

        let base_qty = if buy {
            if real_balance < qty {
                panic!("Unable to buy, insufficient balance");
            }
            real_balance -= &qty;

            if long {
                long_balance += &qty * info.cur_long_price;
            } else {
                short_balance += &qty * info.cur_short_price;
            }

            qty
        } else {
            let base_qty = if long {
                if long_balance < qty {
                    panic!("Unable to sell long, insufficient funds");
                }
                long_balance -= &qty;
                qty / info.cur_long_price
            } else {
                if short_balance < qty {
                    panic!("Unable to sell short, insufficient funds");
                }
                short_balance -= &qty;
                qty / info.cur_short_price
            };

            real_balance += &base_qty;

            base_qty
        };

        self.add_order(Order {
            pid,
            short,
            sell,
            base_qty,
            timestmap: now,
        });
    }

    pub fn deposit(&mut self, pid: Principal, qty: E8s) {
        let (l, s, prev) = self.get_balances(&pid);

        self.set_balances(pid, l, s, prev + qty);
    }

    pub fn withdraw(&mut self, pid: Principal) -> E8s {
        let (l, s, real) = self.get_balances(&pid);
        let zero = E8s::zero();

        if l == zero && s == zero {
            self.balances.remove(&pid);
        } else {
            self.set_balances(pid, l, s, zero);
        }

        real
    }

    pub fn revert_withdraw(&mut self, pid: Principal, qty: E8s) {
        self.deposit(pid, qty);
    }

    pub fn increment_prices(&mut self, seed: Vec<u8>, now: TimestampNs) {
        let mut buf = [0u8; 32];
        buf.copy_from_slice(&seed);

        let mut info = self.get_price_info();
        let (cur_long, cur_short, target) = info.step(buf);

        self.price_history.insert(
            now,
            (
                cur_long.to_dynamic(),
                cur_short.to_dynamic(),
                target.to_dynamic(),
            ),
        );

        self.set_price_info(info);
    }

    pub fn get_price_info(&self) -> PriceInfo {
        self.price_info.get().clone()
    }

    pub fn get_balances(&self, pid: &Principal) -> (E8s, E8s, E8s) {
        self.balances
            .get(&pid)
            .map(|(a, b, c)| (a.to_const(), b.to_const(), c.to_const()))
            .unwrap_or_default()
    }

    fn set_balances(&mut self, pid: Principal, long: E8s, short: E8s, real: E8s) {
        self.balances.insert(
            pid,
            (long.to_dynamic(), short.to_dynamic(), real.to_dynamic()),
        );
    }

    fn add_order(&mut self, order: Order) {
        // if the order history is overflowed, remove the first entry
        if self.order_history.len() == 100 && !self.order_history.contains_key(&order.timestmap) {
            let id = {
                let mut iter = self.order_history.iter();
                let (id, _) = iter.next().unwrap();

                id
            };

            self.order_history.remove(&id);
        }

        let mut stat = self.stats.get(&order.pid).unwrap_or_default();
        match (order.sell, order.short) {
            /* buy long */
            (false, false) => {
                stat.buy_long_timestamps.push(order.timestmap);
                stat.total_long_bought += &order.base_qty;
            }
            /* buy short */
            (false, true) => {
                stat.buy_short_timestamps.push(order.timestmap);
                stat.total_short_bought += &order.base_qty;
            }
            /* sell long */
            (true, false) => {
                stat.sell_long_timestamps.push(order.timestmap);
                stat.total_long_sold += &order.base_qty;
            }
            /* sell short */
            (true, true) => {
                stat.sell_short_timestamps.push(order.timestmap);
                stat.total_short_sold += &order.base_qty;
            }
        }
        self.stats.insert(order.pid, stat);

        self.order_history.insert(order.timestmap, order);
    }

    fn set_price_info(&mut self, info: PriceInfo) {
        self.price_info
            .set(info)
            .expect("Unable to store price info");
    }
}
