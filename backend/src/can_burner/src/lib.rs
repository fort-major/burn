use candid::{Nat, Principal};
use ic_cdk::api::call::CallResult;
use ic_cdk::api::cycles_burn;
use ic_cdk::api::management_canister::main::raw_rand;
use ic_cdk::{caller, export_candid, id, init, post_upgrade, query, spawn, update};
use ic_cdk_timers::set_timer;
use ic_e8s::c::E8s;
use ic_ledger_types::{transfer, AccountIdentifier, Memo, Subaccount, Tokens, TransferArgs};
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager};
use ic_stable_structures::{Cell, DefaultMemoryImpl, StableBTreeMap};
use icrc_ledger_types::icrc1::account::Account;
use icrc_ledger_types::icrc1::transfer::TransferArg;
use shared::burner::api::{GetBurnersRequest, GetBurnersResponse, GetTotalsResponse};
use shared::burner::state::BurnerState;
use shared::burner::types::{
    BurnerStateInfo, CMCClient, NotifyTopUpError, NotifyTopUpRequest, TCycles,
    POS_ACCOUNTS_PER_BATCH,
};
use shared::icrc1::ICRC1CanisterClient;
use shared::{
    CMC_CAN_ID, CYCLES_BURNER_FEE, ENV_VARS, ICP_CAN_ID, ICP_FEE, MEMO_TOP_UP_CANISTER,
    MIN_ICP_STAKE_E8S_U64,
};

use std::cell::RefCell;

use std::time::Duration;

thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    static STATE: RefCell<BurnerState> = RefCell::new(
        BurnerState {
            shares: StableBTreeMap::init(
                MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(0))),
            ),
            info: Cell::init(MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(1))), BurnerStateInfo::default()).expect("Unable to create total supply cell"),
        }
    )
}

#[update]
async fn withdraw(qty_e8s: E8s, to: Principal) {
    assert_running();

    let c = caller();
    let icp_can_id = Principal::from_text(ICP_CAN_ID).unwrap();
    let icp_can = ICRC1CanisterClient::new(icp_can_id);

    icp_can
        .icrc1_transfer(TransferArg {
            from_subaccount: Some(subaccount_of(c).0),
            to: Account {
                owner: to,
                subaccount: None,
            },
            amount: Nat(qty_e8s.val),
            fee: None,
            created_at_time: None,
            memo: None,
        })
        .await
        .expect("Unable to call ICP canister")
        .0
        .expect("Unable to transfer ICP");
}

#[update]
async fn stake(qty_e8s_u64: u64) {
    assert_running();

    if qty_e8s_u64 < MIN_ICP_STAKE_E8S_U64 {
        panic!("At least 0.5 ICP is required to fuel the furnace");
    }

    let cycles = deposit_cycles(qty_e8s_u64)
        .await
        .expect("Unable to call cycle canister")
        .0
        .expect("Unable to deposit cycles");

    let deposited_cycles: u128 = cycles.0.clone().try_into().unwrap();

    set_timer(Duration::from_secs(120), move || {
        // yes, you found it
        cycles_burn(deposited_cycles - CYCLES_BURNER_FEE);
    });

    let shares_minted = TCycles::new(Nat::from(deposited_cycles).0);

    STATE.with_borrow_mut(|s| {
        s.mint_share(shares_minted.clone(), caller());

        let mut info = s.get_info();
        info.note_burned_cycles(shares_minted);

        s.set_info(info);
    });
}

#[update]
async fn claim_reward(to: Principal) -> Result<Nat, String> {
    assert_running();

    let c = caller();

    if let Some(unclaimed) = STATE.with_borrow_mut(|s| s.claim_reward(c)) {
        let burn_token_can = ICRC1CanisterClient::new(ENV_VARS.burn_token_canister_id);

        let res = burn_token_can
            .icrc1_transfer(TransferArg {
                to: Account {
                    owner: to,
                    subaccount: None,
                },
                amount: Nat(unclaimed.clone().val),
                from_subaccount: None,
                fee: None,
                created_at_time: None,
                memo: None,
            })
            .await
            .map_err(|e| format!("{:?}", e))
            .map(|(r,)| r.map_err(|e| format!("{:?}", e)));

        match res {
            Ok(r) => match r {
                Ok(idx) => Ok(idx),
                Err(e) => {
                    STATE.with_borrow_mut(|s| s.revert_claim_reward(c, unclaimed));
                    Err(e)
                }
            },
            Err(e) => {
                STATE.with_borrow_mut(|s| s.revert_claim_reward(c, unclaimed));
                Err(e)
            }
        }
    } else {
        Err(format!("Not unclaimed reward found!"))
    }
}

#[update]
fn stop() {
    STOPPED_FOR_UPDATE.with_borrow_mut(|(dev, is_stopped)| {
        if caller() != *dev {
            panic!("Access denied");
        }

        if !*is_stopped {
            *is_stopped = true;
        }
    })
}

#[update]
fn resume() {
    STOPPED_FOR_UPDATE.with_borrow_mut(|(dev, is_stopped)| {
        if caller() != *dev {
            panic!("Access denied");
        }

        if *is_stopped {
            *is_stopped = false;
        }
    })
}

#[query]
fn get_burners(req: GetBurnersRequest) -> GetBurnersResponse {
    STATE.with_borrow(|s| s.get_burners(req))
}

#[query]
fn get_totals() -> GetTotalsResponse {
    STATE.with_borrow(|s| s.get_totals(&caller()))
}

#[query]
fn subaccount_of(id: Principal) -> Subaccount {
    Subaccount::from(id)
}

#[init]
fn init_hook() {
    STOPPED_FOR_UPDATE.with_borrow_mut(|(dev, _)| *dev = caller());

    set_init_seed_one_timer();
    pos();
}

#[post_upgrade]
fn post_upgrade_hook() {
    STOPPED_FOR_UPDATE.with_borrow_mut(|(dev, _)| *dev = caller());

    pos();
}

async fn deposit_cycles(qty_e8s_u64: u64) -> CallResult<(Result<Nat, NotifyTopUpError>,)> {
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

fn pos() {
    let round_complete =
        STATE.with_borrow_mut(|s| s.pos_round_batch(POS_ACCOUNTS_PER_BATCH, is_stopped()));

    let delay = if round_complete {
        STATE.with_borrow(|s| s.get_info().pos_round_delay_ns)
    } else {
        0
    };

    set_timer(Duration::from_nanos(delay), pos);
}

fn set_init_seed_one_timer() {
    set_timer(Duration::from_micros(0), init_seed);
}

fn init_seed() {
    spawn(async {
        let (rand,) = raw_rand().await.expect("Unable to fetch rand");

        STATE.with_borrow_mut(|s| s.init(rand));
    });
}

thread_local! {
    static STOPPED_FOR_UPDATE: RefCell<(Principal, bool)> = RefCell::new((Principal::anonymous(), false));
}

fn is_stopped() -> bool {
    STOPPED_FOR_UPDATE.with_borrow(|(_, is_stopped)| *is_stopped)
}

fn assert_running() {
    if is_stopped() {
        panic!("The canister is stopped and is awaiting for an update");
    }
}

export_candid!();
