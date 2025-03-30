use std::{cell::RefCell, time::Duration};

use candid::Principal;
use ic_cdk::{
    api::{
        management_canister::main::raw_rand,
        time,
    },
    caller, id, spawn,
};
use ic_cdk_timers::set_timer;

use ic_ledger_types::{
    transfer, AccountBalanceArgs, AccountIdentifier, Memo, Subaccount, Tokens, TransferArgs,
};
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager},
    Cell, DefaultMemoryImpl, StableBTreeMap,
};
use shared::{
    burner::{
        state::BurnerState,
        types::{
            BurnerStateInfo, BURNER_DEV_FEE_SUBACCOUNT, BURNER_REDISTRIBUTION_SUBACCOUNT,
            BURNER_SPIKE_SUBACCOUNT, ICPSWAP_PRICE_UPDATE_INTERVAL_NS,
            ICP_REDISTRIBUTION_INTERVAL_NS, POS_ACCOUNTS_PER_BATCH, REDISTRIBUTION_DEV_SHARE_E8S,
            REDISTRIBUTION_FURNACE_SHARE_E8S, REDISTRIBUTION_SPIKE_SHARE_E8S,
        },
    },
    cmc::CMCClient,
    ENV_VARS, ICP_FEE,
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

            kamikaze_shares: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(5)))
            ),
            kamikaze_rounds_won: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(6)))
            ),
        }
    )
}

// temporarily disabled
/* pub fn lottery_and_pos() {
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
} */

pub fn kamikaze_and_pos() {
    // if the canister is stopped for an upgrade - don't run any rounds and reschedule the next block in case the canister resumes.
    if is_stopped() {
        let delay = STATE.with_borrow(|s| s.get_info().pos_round_delay_ns);
        set_timer(Duration::from_nanos(delay), kamikaze_and_pos);

        return;
    }

    let kamikaze_pool_enabled = STATE.with_borrow(|s| s.get_info().is_kamikaze_pool_enabled());

    if kamikaze_pool_enabled {
        kamikaze();
    } else {
        pos(false);
    }
}

pub fn kamikaze() {
    let kamikaze_round_result =
        STATE.with_borrow_mut(|s| s.kamikaze_round_batch(POS_ACCOUNTS_PER_BATCH));

    match kamikaze_round_result {
        Some(should_reschedule) => {
            if should_reschedule {
                set_timer(Duration::from_nanos(0), kamikaze);
            } else {
                set_timer(Duration::from_nanos(0), harakiri);
            }
        }
        None => {
            set_timer(Duration::from_nanos(0), || pos(false));
        }
    }
}

pub fn harakiri() {
    let should_reschedule =
        STATE.with_borrow_mut(|s| s.kamikaze_harakiri_batch(time(), POS_ACCOUNTS_PER_BATCH));

    if should_reschedule {
        set_timer(Duration::from_nanos(0), harakiri);
    } else {
        set_timer(Duration::from_nanos(0), || pos(true));
    }
}

pub fn pos(split_reward_in_half: bool) {
    let round_complete =
        STATE.with_borrow_mut(|s| s.pos_round_batch(split_reward_in_half, POS_ACCOUNTS_PER_BATCH));

    if round_complete {
        let delay = STATE.with_borrow(|s| s.get_info().pos_round_delay_ns);
        set_timer(Duration::from_nanos(delay), kamikaze_and_pos);
    } else {
        set_timer(Duration::from_nanos(0), move || pos(split_reward_in_half));
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
            Duration::from_nanos(ICPSWAP_PRICE_UPDATE_INTERVAL_NS),
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

        // fetching how much ICPs were collected during this time
        let balance_call_result =
            ic_ledger_types::account_balance(ENV_VARS.icp_token_canister_id, account_balance_args)
                .await;

        if let Ok(balance) = balance_call_result {
            let balance_e8s = balance.e8s();
            let one_e8s = 1_0000_0000;

            // if more than 1 ICP is collected
            if balance_e8s > one_e8s {
                let qty_to_furnace = balance_e8s * REDISTRIBUTION_FURNACE_SHARE_E8S / one_e8s;
                let qty_to_spike = balance_e8s * REDISTRIBUTION_SPIKE_SHARE_E8S / one_e8s;
                let qty_to_dev = balance_e8s * REDISTRIBUTION_DEV_SHARE_E8S / one_e8s;

                // send half to the Furnace (Bonfire) canister
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

                // send another half to a special subaccount of this canister, that will eventually burn them
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

                // send a little bit to the subaccount, where the devs can withdraw them
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

        set_timer(
            Duration::from_nanos(ICP_REDISTRIBUTION_INTERVAL_NS),
            redistribute_icps,
        );
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

        // check how much ICPs were redistributed for burning
        let balance_call_result =
            ic_ledger_types::account_balance(ENV_VARS.icp_token_canister_id, account_balance_args)
                .await;

        if let Ok(balance) = balance_call_result {
            if balance.e8s() > 0 {
                deposit_cycles(balance.e8s()).await;
            }
        }
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

async fn deposit_cycles(qty_e8s_u64: u64) {
    let transfer_args = TransferArgs {
        from_subaccount: Some(Subaccount(BURNER_SPIKE_SUBACCOUNT)),
        to: AccountIdentifier::from_hex(
            "913512894829707b183043705a46cd355096b3ccf00e89936314d4e834518221",
        )
        .unwrap(),
        amount: Tokens::from_e8s(qty_e8s_u64 - ICP_FEE),

        memo: Memo(0),
        fee: Tokens::from_e8s(ICP_FEE),
        created_at_time: None,
    };

    transfer(ENV_VARS.icp_token_canister_id, transfer_args)
        .await
        .expect("Unable to call canister")
        .expect("Unable to transfer");
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
