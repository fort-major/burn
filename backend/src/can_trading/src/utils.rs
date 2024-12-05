use std::{cell::RefCell, time::Duration};

use ic_cdk::{
    api::{management_canister::main::raw_rand, time},
    spawn,
};
use ic_cdk_timers::set_timer_interval;
use ic_e8s::c::E8s;
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager},
    Cell, DefaultMemoryImpl, StableBTreeMap, StableVec,
};
use shared::{
    icrc1::ICRC1CanisterClient,
    trading::{
        state::TradingState,
        types::{OrderHistory, PriceInfo},
    },
    ENV_VARS, ONE_DAY_NS, ONE_MINUTE_NS,
};

thread_local! {
    pub static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    pub static STATE: RefCell<TradingState> = RefCell::new(
        TradingState {
            price_info: Cell::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(0))), PriceInfo::new(0)).expect("Unable to create price info cell"),

            balances: StableBTreeMap::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(1))),),
            stats: StableBTreeMap::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(2))),),

            long_price_history_4h: StableVec::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(3))),).expect("Unable to create price history vec 1"),
            long_price_history_1d: StableVec::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(4))),).expect("Unable to create price history vec 2"),
            short_price_history_4h: StableVec::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(5))),).expect("Unable to create price history vec 3"),
            short_price_history_1d: StableVec::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(6))),).expect("Unable to create price history vec 4"),

            order_history: Cell::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(7))), OrderHistory::default()).expect("Unable to create order history cell"),
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

pub fn set_fetch_total_supply_timer() {
    set_timer_interval(Duration::from_nanos(ONE_DAY_NS), || {
        spawn(fetch_burn_total_supply());
    });
}

async fn fetch_burn_total_supply() {
    let burn_token = ICRC1CanisterClient::new(ENV_VARS.burn_token_canister_id);
    let (total_supply,) = burn_token
        .icrc1_total_supply()
        .await
        .expect("Unable to fetch $BURN total supply");

    STATE.with_borrow_mut(|s| {
        let mut info = s.get_price_info();
        info.total_supply = E8s::new(total_supply.0);
    });
}
