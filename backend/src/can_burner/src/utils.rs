use std::{cell::RefCell, time::Duration};

use candid::{Nat, Principal};
use ic_cdk::{
    api::{call::CallResult, management_canister::main::raw_rand},
    caller, id, spawn,
};
use ic_cdk_timers::set_timer;
use ic_ledger_types::{transfer, AccountIdentifier, Memo, Subaccount, Tokens, TransferArgs};
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager},
    Cell, DefaultMemoryImpl, StableBTreeMap,
};
use shared::{
    burner::{
        state::BurnerState,
        types::{
            BurnerStateInfo, CMCClient, NotifyTopUpError, NotifyTopUpRequest,
            POS_ACCOUNTS_PER_BATCH,
        },
    },
    CMC_CAN_ID, ICP_CAN_ID, ICP_FEE, MEMO_TOP_UP_CANISTER,
};

use crate::subaccount_of;

thread_local! {
    pub static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    pub static STATE: RefCell<BurnerState> = RefCell::new(
        BurnerState {
            shares: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(0))),
            ),
            info: Cell::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(1))), BurnerStateInfo::default()).expect("Unable to create total supply cell"),
            verified_via_decide_id: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(2)))
            ),
            eligible_for_lottery: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(3)))
            ),
        }
    )
}

pub fn lottery_and_pos() {
    // if the canister is stopped for an upgrade - don't run any rounds and reschedule the next block in case the canister resumes.
    if is_stopped() {
        let delay = STATE.with_borrow(|s| s.get_info().pos_round_delay_ns);
        set_timer(Duration::from_nanos(delay), lottery_and_pos);

        return;
    }

    let lottery_round_complete = STATE.with_borrow_mut(|s| s.lottery_round());

    set_timer(Duration::from_nanos(0), move || pos(lottery_round_complete));
}

pub fn pos(lottery_round_complete: bool) {
    let round_complete = STATE
        .with_borrow_mut(|s| s.pos_round_batch(lottery_round_complete, POS_ACCOUNTS_PER_BATCH));

    if round_complete {
        let delay = STATE.with_borrow(|s| s.get_info().pos_round_delay_ns);
        set_timer(Duration::from_nanos(delay), lottery_and_pos);
    } else {
        set_timer(Duration::from_nanos(0), move || pos(lottery_round_complete));
    };
}

pub fn set_init_seed_one_timer() {
    set_timer(Duration::from_nanos(0), init_seed);
}

fn init_seed() {
    spawn(async {
        let (rand,) = raw_rand().await.expect("Unable to fetch rand");

        STATE.with_borrow_mut(|s| s.init(rand));
    });
}

pub async fn deposit_cycles(qty_e8s_u64: u64) -> CallResult<(Result<Nat, NotifyTopUpError>,)> {
    let caller_subaccount = subaccount_of(caller());
    let icp_can_id = Principal::from_text(ICP_CAN_ID).unwrap();
    let cmc_can_id = Principal::from_text(CMC_CAN_ID).unwrap();
    let canister_id = id();
    let subaccount = Subaccount::from(canister_id);

    let transfer_args = TransferArgs {
        amount: Tokens::from_e8s(qty_e8s_u64),
        to: AccountIdentifier::new(&cmc_can_id, &subaccount),
        memo: Memo(MEMO_TOP_UP_CANISTER),
        fee: Tokens::from_e8s(ICP_FEE),
        from_subaccount: Some(caller_subaccount),
        created_at_time: None,
    };

    let block_index = transfer(icp_can_id, transfer_args)
        .await
        .expect("Unable to call ICP canister")
        .expect("Unable to transfer ICP");

    let cmc = CMCClient(cmc_can_id);

    let notify_args = NotifyTopUpRequest {
        block_index,
        canister_id,
    };

    cmc.notify_top_up(notify_args).await
}

thread_local! {
    pub static STOPPED_FOR_UPDATE: RefCell<(Principal, bool)> = RefCell::new((Principal::anonymous(), false));
}

pub fn is_stopped() -> bool {
    STOPPED_FOR_UPDATE.with_borrow(|(_, is_stopped)| *is_stopped)
}

pub fn assert_caller_is_dev() {
    let dev = STOPPED_FOR_UPDATE.with_borrow(|(dev, _)| *dev);
    if caller() != dev {
        panic!("Access denied");
    }
}

pub fn assert_running() {
    if is_stopped() {
        panic!("The canister is stopped and is awaiting for an update");
    }
}
