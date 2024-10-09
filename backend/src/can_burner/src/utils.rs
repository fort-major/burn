use std::{cell::RefCell, time::Duration};

use candid::{Nat, Principal};
use ic_cdk::{
    api::{
        call::{CallResult, RejectionCode},
        cycles_burn,
        management_canister::main::raw_rand,
    },
    caller, id, spawn,
};
use ic_cdk_timers::set_timer;
use ic_e8s::c::E8s;
use ic_ledger_types::{
    transfer, AccountBalanceArgs, AccountIdentifier, Memo, Subaccount, Tokens, TransferArgs,
    TransferResult,
};
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager},
    Cell, DefaultMemoryImpl, StableBTreeMap,
};
use shared::{
    burner::{
        state::BurnerState,
        types::{
            BurnerStateInfo, TCycles, BURNER_DEV_FEE_SUBACCOUNT, BURNER_REDISTRIBUTION_SUBACCOUNT,
            BURNER_SPIKE_SUBACCOUNT, POS_ACCOUNTS_PER_BATCH, REDISTRIBUTION_DEV_SHARE_E8S,
            REDISTRIBUTION_FURNACE_SHARE_E8S, REDISTRIBUTION_SPIKE_SHARE_E8S,
        },
    },
    cmc::{CMCClient, NotifyTopUpError, NotifyTopUpRequest},
    ENV_VARS, ICP_FEE, MEMO_TOP_UP_CANISTER, ONE_HOUR_NS, ONE_MINUTE_NS,
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
            lottery_rounds_won: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(4)))
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

    let lottery_enabled = STATE.with_borrow(|s| s.get_info().is_lottery_enabled());

    if lottery_enabled {
        let lottery_round_complete = STATE.with_borrow_mut(|s| s.lottery_round());

        set_timer(Duration::from_nanos(0), move || pos(lottery_round_complete));
    } else {
        pos(false);
    }
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

pub fn set_cycles_icp_exchange_rate_timer() {
    set_timer(Duration::from_nanos(0), fetch_cycles_icp_exchange_rate);
}

fn fetch_cycles_icp_exchange_rate() {
    spawn(async {
        let cmc = CMCClient(ENV_VARS.cycles_minting_canister_id);
        let call_result = cmc.get_icp_xdr_conversion_rate().await;

        if let Ok(response) = call_result {
            STATE.with_borrow_mut(|s| {
                let mut info = s.get_info();
                info.update_icp_to_cycles_exchange_rate(response.0.data);

                s.set_info(info);
            });
        }

        set_timer(
            Duration::from_nanos(ONE_MINUTE_NS * 10),
            fetch_cycles_icp_exchange_rate,
        );
    });
}

pub fn set_icp_redistribution_timer() {
    set_timer(Duration::from_nanos(0), redistribute_icps);
}

fn redistribute_icps() {
    spawn(async {
        let this_canister_id = id();
        let redistribution_subaccount = Subaccount(BURNER_REDISTRIBUTION_SUBACCOUNT);
        let redistribution_account_id =
            AccountIdentifier::new(&this_canister_id, &redistribution_subaccount);

        let account_balance_args = AccountBalanceArgs {
            account: redistribution_account_id,
        };

        let balance_call_result =
            ic_ledger_types::account_balance(ENV_VARS.icp_token_canister_id, account_balance_args)
                .await;

        if let Ok(balance) = balance_call_result {
            let balance_e8s = balance.e8s();
            let one_e8s = 1_0000_0000;

            if balance_e8s > one_e8s {
                let qty_to_furnace = balance_e8s * REDISTRIBUTION_FURNACE_SHARE_E8S / one_e8s;
                let qty_to_spike = balance_e8s * REDISTRIBUTION_SPIKE_SHARE_E8S / one_e8s;
                let qty_to_dev = balance_e8s * REDISTRIBUTION_DEV_SHARE_E8S / one_e8s;

                let furnace_account_id =
                    AccountIdentifier::new(&ENV_VARS.furnace_canister_id, &Subaccount([0u8; 32]));

                let _ = ic_ledger_types::transfer(
                    ENV_VARS.icp_token_canister_id,
                    TransferArgs {
                        from_subaccount: Some(redistribution_subaccount),
                        to: furnace_account_id,
                        amount: Tokens::from_e8s(qty_to_furnace - ICP_FEE),
                        memo: Memo(1),
                        fee: Tokens::from_e8s(ICP_FEE),
                        created_at_time: None,
                    },
                )
                .await;

                let spike_account_id =
                    AccountIdentifier::new(&this_canister_id, &Subaccount(BURNER_SPIKE_SUBACCOUNT));

                let _ = ic_ledger_types::transfer(
                    ENV_VARS.icp_token_canister_id,
                    TransferArgs {
                        from_subaccount: Some(redistribution_subaccount),
                        to: spike_account_id,
                        amount: Tokens::from_e8s(qty_to_spike - ICP_FEE),
                        memo: Memo(1),
                        fee: Tokens::from_e8s(ICP_FEE),
                        created_at_time: None,
                    },
                )
                .await;

                let dev_account_id = AccountIdentifier::new(
                    &this_canister_id,
                    &Subaccount(BURNER_DEV_FEE_SUBACCOUNT),
                );

                let _ = ic_ledger_types::transfer(
                    ENV_VARS.icp_token_canister_id,
                    TransferArgs {
                        from_subaccount: Some(redistribution_subaccount),
                        to: dev_account_id,
                        amount: Tokens::from_e8s(qty_to_dev - ICP_FEE),
                        memo: Memo(1),
                        fee: Tokens::from_e8s(ICP_FEE),
                        created_at_time: None,
                    },
                )
                .await;
            }
        }

        set_timer(Duration::from_nanos(ONE_HOUR_NS * 3), redistribute_icps);
    });
}

pub fn set_spike_timer() {
    set_timer(Duration::from_nanos(0), try_producing_a_chart_spike);
}

fn try_producing_a_chart_spike() {
    spawn(async {
        let this_canister_id = id();
        let spike_subaccount = Subaccount(BURNER_SPIKE_SUBACCOUNT);
        let spike_account_id = AccountIdentifier::new(&this_canister_id, &spike_subaccount);

        let account_balance_args = AccountBalanceArgs {
            account: spike_account_id,
        };

        let balance_call_result =
            ic_ledger_types::account_balance(ENV_VARS.icp_token_canister_id, account_balance_args)
                .await;

        if let Ok(balance) = balance_call_result {
            let spike_target = STATE.with_borrow(|s| s.get_info().get_icp_burn_spike_target());

            if balance.e8s() > spike_target {
                let deposit_cycles_call_result = deposit_cycles(balance.e8s()).await;

                if let Ok((deposit_cycles_result,)) = deposit_cycles_call_result {
                    if let Ok(cycles) = deposit_cycles_result {
                        let deposited_cycles: u128 = cycles.0.clone().try_into().unwrap();

                        set_timer(Duration::from_secs(30), move || {
                            // take square root of deposited cycles as a fee to keep the thing running
                            let burner_fee: u128 = TCycles::from(deposited_cycles)
                                .sqrt()
                                .val
                                .try_into()
                                .unwrap();

                            // TODO: distribute cycles among other MSQ.Burn canisters

                            cycles_burn(deposited_cycles - burner_fee);
                        });
                    }
                }
            }
        }

        set_timer(
            Duration::from_nanos(ONE_HOUR_NS * 6),
            try_producing_a_chart_spike,
        );
    });
}

pub async fn stake_callers_icp_for_redistribution(qty_e8s_u64: u64) -> Result<(), String> {
    let caller_subaccount = subaccount_of(caller());
    let canister_id = id();
    let redistribution_subaccount = Subaccount(BURNER_REDISTRIBUTION_SUBACCOUNT);

    let transfer_args = TransferArgs {
        from_subaccount: Some(caller_subaccount),
        to: AccountIdentifier::new(&canister_id, &redistribution_subaccount),
        amount: Tokens::from_e8s(qty_e8s_u64),
        memo: Memo(0),
        fee: Tokens::from_e8s(ICP_FEE),
        created_at_time: None,
    };

    transfer(ENV_VARS.icp_token_canister_id, transfer_args)
        .await
        .map_err(|(code, msg)| format!("{:?} {}", code, msg))?
        .map_err(|e| format!("{}", e))
        .map(|_| ())
}

async fn deposit_cycles(qty_e8s_u64: u64) -> CallResult<(Result<Nat, NotifyTopUpError>,)> {
    let transfer_args = TransferArgs {
        from_subaccount: Some(Subaccount(BURNER_SPIKE_SUBACCOUNT)),
        to: AccountIdentifier::new(
            &ENV_VARS.cycles_minting_canister_id,
            &Subaccount::from(id()),
        ),
        amount: Tokens::from_e8s(qty_e8s_u64 - ICP_FEE),

        memo: Memo(MEMO_TOP_UP_CANISTER),
        fee: Tokens::from_e8s(ICP_FEE),
        created_at_time: None,
    };

    let transfer_call_result = transfer(ENV_VARS.icp_token_canister_id, transfer_args).await;

    // to work properly this method should not throw
    if let Ok(transfer_result) = transfer_call_result {
        if let Ok(block_index) = transfer_result {
            let cmc = CMCClient(ENV_VARS.cycles_minting_canister_id);

            let notify_args = NotifyTopUpRequest {
                block_index,
                canister_id: id(),
            };

            return cmc.notify_top_up(notify_args).await;
        }
    }

    CallResult::Err((RejectionCode::Unknown, String::from("")))
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
