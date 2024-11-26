use std::{cell::RefCell, time::Duration};

use ic_cdk::{
    api::{management_canister::main::raw_rand, time},
    spawn,
};
use ic_cdk_timers::set_timer_interval;
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager},
    Cell, DefaultMemoryImpl, StableBTreeMap, StableVec,
};
use shared::{
    trading::{
        state::TradingState,
        types::{OrderHistory, PriceInfo},
    },
    ONE_MINUTE_NS,
};

thread_local! {
    pub static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    pub static STATE: RefCell<TradingState> = RefCell::new(
        TradingState {
            price_info: Cell::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(0))), PriceInfo::new()).expect("Unable to create price info cell"),
            balances: StableBTreeMap::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(1))),),

            stats: StableBTreeMap::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(2))),),
            price_history: StableVec::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(3))),).expect("Unable to create price history vec"),
            order_history: Cell::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(4))), OrderHistory::default()).expect("Unable to create order history cell"),
        }
    );
}

pub fn set_produce_new_price_timer() {
    set_timer_interval(Duration::from_nanos(ONE_MINUTE_NS), || {
        spawn(produce_new_price())
    });
}

async fn produce_new_price() {
    let (rand,) = raw_rand()
        .await
        .expect("Unable to produce a new random number");

    STATE.with_borrow_mut(|s| s.increment_prices(rand, time()));
}
