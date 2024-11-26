use std::cell::RefCell;

use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager},
    Cell, DefaultMemoryImpl, StableBTreeMap,
};
use shared::{
    trading::{state::TradingState, types::PriceInfo},
    trading_invites::state::TradingInvitesState,
};

thread_local! {
    pub static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    pub static STATE: RefCell<TradingInvitesState> = RefCell::new(
        TradingInvitesState {
            members: StableBTreeMap::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(0))),),
            invites: StableBTreeMap::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(1))),),
        }
    );
}
