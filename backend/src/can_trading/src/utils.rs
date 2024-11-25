use std::cell::RefCell;

use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager},
    Cell, DefaultMemoryImpl, StableBTreeMap,
};
use shared::trading::{state::TradingState, types::PriceInfo};

thread_local! {
    pub static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    pub static STATE: RefCell<TradingState> = RefCell::new(
        TradingState {
            price_info: Cell::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(0))), PriceInfo::new()).expect("Unable to create raffle round info cell"),
            balances: StableBTreeMap::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(1))),),

            stats: StableBTreeMap::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(2))),),
            price_history: StableBTreeMap::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(3))),),
            order_history: StableBTreeMap::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(4))),),
        }
    );
}
