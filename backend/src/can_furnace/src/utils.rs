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
use shared::{
    furnace::{state::FurnaceState, types::FurnaceInfo},
    icpswap::ICPSwapClient,
    CanisterMode, ENV_VARS, ONE_MINUTE_NS,
};

thread_local! {
    pub static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    pub static STATE: RefCell<FurnaceState> = RefCell::new(
        FurnaceState {
            cur_round_positions: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(0))),
            ),
            raffle_round_info: Cell::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(1))), None).expect("Unable to create raffle round info cell"),

            winners: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(2))),
            ),
            furnace_info: Cell::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(3))), FurnaceInfo::default()).expect("Unable to create furnace info cell"),
            supported_tokens: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(4))),
            ),

            next_token_x_alternatives: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(5))),
            ),
            next_token_x_votes: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(6))),
            ),
            token_dispensers: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(7))),
            ),
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

pub fn set_fetch_supported_tokens_timer() {
    set_timer(Duration::from_nanos(0), fetch_supported_tokens);
}

fn fetch_supported_tokens() {
    spawn(async {
        let should_mock = matches!(ENV_VARS.mode, CanisterMode::Dev);
        let icpswap = ICPSwapClient::new(None, should_mock);

        let call_result = icpswap.get_all_tokens().await;

        if let Ok(response) = call_result {
            STATE.with_borrow_mut(|s| s.update_supported_tokens(response));
        }

        set_timer(
            Duration::from_nanos(ONE_MINUTE_NS * 10),
            fetch_supported_tokens,
        );
    });
}
