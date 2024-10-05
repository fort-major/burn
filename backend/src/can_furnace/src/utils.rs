use std::{cell::RefCell, time::Duration};

use ic_cdk::{
    api::{management_canister::main::raw_rand, time},
    spawn,
};
use ic_cdk_timers::set_timer;
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager},
    Cell, DefaultMemoryImpl, StableBTreeMap,
};
use shared::furnace::{state::FurnaceState, types::FurnaceInfo};

thread_local! {
    pub static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    pub static STATE: RefCell<FurnaceState> = RefCell::new(
        FurnaceState {
            cur_round_entries: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(0))),
            ),
            positions: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(1))),
            ),
            winners: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(2))),
            ),
            furnace_info: Cell::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(3))), FurnaceInfo::default()).expect("Unable to create furnace info cell"),
            raffle_round_info: Cell::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(3))), None).expect("Unable to create raffle round info cell")
        }
    )
}

pub fn set_init_seed_one_timer() {
    set_timer(Duration::from_nanos(0), init_seed);
}

fn init_seed() {
    spawn(async {
        let (rand,) = raw_rand().await.expect("Unable to fetch rand");

        STATE.with_borrow_mut(|s| s.init(rand, time()));
    });
}
