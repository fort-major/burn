use std::{cell::RefCell, time::Duration};

use candid::{Nat, Principal};
use ic_cdk::{
    api::{
        call::{CallResult, RejectionCode},
        management_canister::main::raw_rand,
        time,
    },
    caller, id, spawn,
};
use ic_cdk_timers::set_timer;
use ic_e8s::d::EDs;
use ic_ledger_types::{
    transfer, AccountBalanceArgs, AccountIdentifier, Memo, Subaccount, Tokens, TransferArgs,
};
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager},
    Cell, DefaultMemoryImpl, StableBTreeMap,
};
use icrc_ledger_types::icrc1::{account::Account, transfer::TransferArg};
use shared::{
    burner::{
        api::{GetBurnersRequest, GetKamikazesRequest},
        client::BurnerClient,
        types::TCycles,
    },
    cmc::{CMCClient, NotifyTopUpError, NotifyTopUpRequest},
    dispenser::{
        state::DispenserState,
        types::{
            CurrentDistributionInfo, DispenserInfo, DISPENSER_DEFAULT_TICK_DELAY_NS,
            DISPENSER_DEV_FEE_SUBACCOUNT, DISPENSER_DISTRIBUTION_SUBACCOUNT, DISPENSER_ICP_FEE_E8S,
            DISPENSER_ICP_FEE_SUBACCOUNT,
        },
    },
    furnace::{
        api::GetCurRoundPositionsRequest, client::FurnaceClient, types::FURNACE_DEV_FEE_SUBACCOUNT,
    },
    icrc1::ICRC1CanisterClient,
    utils::duration_until_next_sunday_12_00,
    ENV_VARS, ICP_FEE, MEMO_TOP_UP_CANISTER, ONE_DAY_NS, ONE_HOUR_NS, ONE_MINUTE_NS,
};

thread_local! {
    pub static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    pub static STATE: RefCell<DispenserState> = RefCell::new(
        DispenserState {
            common_pool_members: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(0))),
            ),
            kamikaze_pool_members: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(1))),
            ),
            bonfire_pool_members: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(2))),
            ),

            unclaimed_tokens: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(3))),
            ),

            scheduled_distributions: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(4))),
            ),
            active_distributions: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(5))),
            ),
            past_distributions: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(6))),
            ),

            current_distribution_info: Cell::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(7))),
                CurrentDistributionInfo::default()
            ).expect("Unable to create cur distribution info cell"),

            dispenser_info: Cell::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(8))),
                DispenserInfo::default()
            ).expect("Unable to create dispenser info cell"),
        }
    )
}

pub fn set_init_canister_one_timer() {
    set_timer(Duration::from_nanos(0), init_canister);
}

fn init_canister() {
    spawn(async move {
        let (rand,) = raw_rand().await.expect("Unable to fetch rand");
        let token_can_id = STATE.with_borrow_mut(|s| s.get_dispenser_info().token_can_id.unwrap());

        let token = ICRC1CanisterClient::new(token_can_id);

        let decimals_response = token.icrc1_decimals().await;
        if decimals_response.is_err() {
            set_timer(Duration::from_nanos(ONE_MINUTE_NS * 10), init_canister);
            return;
        }

        let fee_response = token.icrc1_fee().await;
        if fee_response.is_err() {
            set_timer(Duration::from_nanos(ONE_MINUTE_NS * 10), init_canister);
            return;
        }

        let (decimals,) = decimals_response.unwrap();
        let (fee,) = fee_response.unwrap();

        STATE.with_borrow_mut(|s| s.init(rand, decimals, fee, time()));
    });
}

pub fn set_tick_timer() {
    set_timer(Duration::from_nanos(ONE_HOUR_NS), tick_start);
}

fn tick_start() {
    let should_reschedule = STATE.with_borrow_mut(|s| {
        let mut info = s.get_dispenser_info();

        if info.is_stopped || info.is_distributing || !info.initted {
            return true;
        }

        info.start_round();
        s.set_dispenser_info(info);

        false
    });

    if should_reschedule {
        set_timer(
            Duration::from_nanos(DISPENSER_DEFAULT_TICK_DELAY_NS),
            tick_start,
        );
        return;
    }

    spawn(async {
        update_common_pool_members().await;
        update_kamikaze_pool_members().await;

        set_timer(
            Duration::from_nanos(0),
            try_activate_scheduled_distributions,
        );
    });
}

fn try_activate_scheduled_distributions() {
    let should_reschedule =
        STATE.with_borrow_mut(|s| s.activate_scheduled_distributions_batch(300));

    if should_reschedule {
        set_timer(
            Duration::from_nanos(0),
            try_activate_scheduled_distributions,
        );
        return;
    }

    find_next_active_distribution();
}

fn find_next_active_distribution() {
    let found = STATE.with_borrow_mut(|s| s.find_next_active_distribution());

    if found {
        set_timer(Duration::from_nanos(0), dispense_to_common_pool_members);
    } else {
        set_timer(Duration::from_nanos(0), try_complete_active_distributions);
    }
}

fn try_complete_active_distributions() {
    let should_reschedule = STATE.with_borrow_mut(|s| s.complete_active_distributions_batch(300));

    if should_reschedule {
        set_timer(Duration::from_nanos(0), try_complete_active_distributions);
        return;
    }

    STATE.with_borrow_mut(|s| s.complete_tick(time()));

    // restart
    set_tick_timer();
}

fn dispense_to_common_pool_members() {
    let should_reschedule = STATE.with_borrow_mut(|s| s.dispense_common_batch(300));

    if should_reschedule {
        set_timer(Duration::from_nanos(0), dispense_to_common_pool_members);
        return;
    }

    set_timer(Duration::from_nanos(0), dispense_to_kamikaze_pool_members);
}

fn dispense_to_kamikaze_pool_members() {
    let should_reschedule = STATE.with_borrow_mut(|s| s.dispense_kamikaze_batch(300));

    if should_reschedule {
        set_timer(Duration::from_nanos(0), dispense_to_kamikaze_pool_members);
        return;
    }

    set_timer(Duration::from_nanos(0), dispense_to_bonfire_pool_members);
}

fn dispense_to_bonfire_pool_members() {
    let should_reschedule = STATE.with_borrow_mut(|s| s.dispense_bonfire_batch(300));

    if should_reschedule {
        set_timer(Duration::from_nanos(0), dispense_to_bonfire_pool_members);
        return;
    }

    set_timer(Duration::from_nanos(0), find_next_active_distribution);
}

async fn update_common_pool_members() {
    let client = BurnerClient(ENV_VARS.burner_canister_id);

    let take = 100;
    let mut start = None;

    loop {
        let call_result = client.get_burners(GetBurnersRequest { start, take }).await;

        if let Ok((response,)) = call_result {
            let should_stop = STATE.with_borrow_mut(|s| {
                let should_stop = response.entries.len() < take as usize;

                let mut total_shares = TCycles::zero();

                for entry in response.entries {
                    total_shares += &entry.share;

                    s.common_pool_members
                        .insert(entry.pid, entry.share.to_dynamic());

                    start = Some(entry.pid);
                }

                let mut info = s.get_dispenser_info();
                info.total_common_pool_members_weight += total_shares;
                s.set_dispenser_info(info);

                should_stop
            });

            if should_stop {
                break;
            }
        }
    }
}

async fn update_kamikaze_pool_members() {
    let client = BurnerClient(ENV_VARS.burner_canister_id);

    let take = 100;
    let mut start = None;

    loop {
        let call_result = client
            .get_kamikazes(GetKamikazesRequest { start, take })
            .await;

        if let Ok((response,)) = call_result {
            let should_stop = STATE.with_borrow_mut(|s| {
                let should_stop = response.entries.len() < take as usize;

                let mut total_shares = TCycles::zero();

                for entry in response.entries {
                    total_shares += &entry.share;

                    s.kamikaze_pool_members
                        .insert(entry.pid, entry.share.to_dynamic());

                    start = Some(entry.pid);
                }

                let mut info = s.get_dispenser_info();
                info.total_kamikaze_pool_members_weight += total_shares;
                s.set_dispenser_info(info);

                should_stop
            });

            if should_stop {
                break;
            }
        }
    }
}

pub fn set_update_bonfire_pool_members_timer() {
    set_timer(Duration::from_nanos(0), update_bonfire_pool_members);
}

fn update_bonfire_pool_members() {
    let skip = STATE.with_borrow_mut(|s| {
        let info = s.get_dispenser_info();

        info.is_distributing || info.is_stopped
    });

    if skip {
        set_timer(
            Duration::from_nanos(ONE_MINUTE_NS * 10),
            update_bonfire_pool_members,
        );
        return;
    }

    STATE.with_borrow_mut(|s| {
        s.bonfire_pool_members.clear_new();

        let mut info = s.get_dispenser_info();
        info.total_bonfire_pool_members_weight = TCycles::zero();
        s.set_dispenser_info(info);
    });

    spawn(async {
        let client = FurnaceClient(ENV_VARS.burner_canister_id);

        let take = 100;
        let mut skip = None;

        loop {
            let call_result = client
                .get_cur_round_positions(GetCurRoundPositionsRequest { skip, take })
                .await;

            if let Ok((response,)) = call_result {
                let should_stop = STATE.with_borrow_mut(|s| {
                    let should_stop = response.positions.len() < take as usize;

                    let mut total_shares = EDs::zero(12);

                    for positions in response.positions {
                        let share = positions.usd.to_dynamic().to_decimals(12);
                        total_shares += &share;

                        s.bonfire_pool_members.insert(positions.pid, share);

                        skip = Some(positions.pid);
                    }

                    let mut info = s.get_dispenser_info();
                    info.total_bonfire_pool_members_weight += total_shares.to_const();
                    s.set_dispenser_info(info);

                    should_stop
                });

                if should_stop {
                    break;
                }
            }
        }
    });

    set_timer(
        duration_until_next_sunday_12_00(time()),
        update_bonfire_pool_members,
    );
}

pub fn set_transfer_dev_fee_to_furnace_timer() {
    set_timer(
        Duration::from_nanos(ONE_DAY_NS),
        transfer_dev_fee_to_furnace,
    );
}

fn transfer_dev_fee_to_furnace() {
    spawn(async {
        let from = Account {
            owner: id(),
            subaccount: Some(DISPENSER_DEV_FEE_SUBACCOUNT),
        };

        let token_can_id = STATE.with_borrow(|s| s.get_dispenser_info().token_can_id.unwrap());
        let token = ICRC1CanisterClient::new(token_can_id);

        let balance_resp = token.icrc1_balance_of(from).await;

        if let Ok((balance,)) = balance_resp {
            let fee = STATE.with_borrow(|s| s.get_dispenser_info().token_fee);

            let to = Account {
                owner: ENV_VARS.furnace_canister_id,
                subaccount: Some(FURNACE_DEV_FEE_SUBACCOUNT),
            };

            let _ = token
                .icrc1_transfer(TransferArg {
                    from_subaccount: from.subaccount,
                    to,
                    amount: balance - fee.clone(),
                    fee: Some(fee),
                    created_at_time: None,
                    memo: None,
                })
                .await;
        }
    });

    set_transfer_dev_fee_to_furnace_timer();
}

pub async fn charge_caller_distribution_creation_fee_icp() {
    let caller_subaccount = Subaccount::from(caller());
    let icp_fee_account_id =
        AccountIdentifier::new(&id(), &Subaccount(DISPENSER_ICP_FEE_SUBACCOUNT));

    transfer(
        ENV_VARS.icp_token_canister_id,
        TransferArgs {
            from_subaccount: Some(caller_subaccount),
            to: icp_fee_account_id,
            amount: Tokens::from_e8s(DISPENSER_ICP_FEE_E8S - ICP_FEE),
            fee: Tokens::from_e8s(ICP_FEE),
            memo: Memo(1),
            created_at_time: None,
        },
    )
    .await
    .expect("Failed to collect ICP fee")
    .expect("Failed to collect ICP fee");
}

pub async fn charge_caller_tokens(token_can_id: Principal, token_fee: Nat, qty: Nat) {
    let caller_subaccount = Subaccount::from(caller()).0;
    let distribution_account = Account {
        owner: id(),
        subaccount: Some(DISPENSER_DISTRIBUTION_SUBACCOUNT),
    };

    let token = ICRC1CanisterClient::new(token_can_id);
    token
        .icrc1_transfer(TransferArg {
            from_subaccount: Some(caller_subaccount),
            to: distribution_account,
            amount: qty - token_fee.clone(),
            fee: Some(token_fee),
            created_at_time: None,
            memo: None,
        })
        .await
        .expect("Failed to collect dispensed tokens")
        .0
        .expect("Failed to collect dispensed tokens");
}

pub async fn charge_dev_fee(token_can_id: Principal, token_fee: Nat, qty: Nat) -> Nat {
    let caller_subaccount = Subaccount::from(caller()).0;
    let dev_fee_account = Account {
        owner: id(),
        subaccount: Some(DISPENSER_DEV_FEE_SUBACCOUNT),
    };

    let dev_fee = qty.clone() / Nat::from(100u64);

    let token = ICRC1CanisterClient::new(token_can_id);
    token
        .icrc1_transfer(TransferArg {
            from_subaccount: Some(caller_subaccount),
            to: dev_fee_account,
            amount: dev_fee.clone() - token_fee.clone(),
            fee: Some(token_fee),
            created_at_time: None,
            memo: None,
        })
        .await
        .expect("Failed to collect dev fee")
        .0
        .expect("Failed to collect dev fee");

    qty - dev_fee
}

pub async fn claim_caller_tokens(
    token_can_id: Principal,
    token_fee: Nat,
    qty: Nat,
) -> Result<Nat, String> {
    let caller_account = Account {
        owner: caller(),
        subaccount: None,
    };

    let token = ICRC1CanisterClient::new(token_can_id);
    let call_response = token
        .icrc1_transfer(TransferArg {
            from_subaccount: Some(DISPENSER_DISTRIBUTION_SUBACCOUNT),
            to: caller_account,
            amount: qty - token_fee.clone(),
            fee: Some(token_fee),
            created_at_time: None,
            memo: None,
        })
        .await;

    match call_response {
        Ok((Ok(block_idx),)) => Ok(block_idx),
        Ok((Err(e),)) => Err(e.to_string()),
        Err((c, m)) => Err(format!("{:?}: {}", c, m)),
    }
}

pub fn set_transform_icp_fee_to_cycles_timer() {
    set_timer(
        Duration::from_nanos(ONE_DAY_NS),
        transform_icp_fee_to_cycles,
    );
}

fn transform_icp_fee_to_cycles() {
    spawn(async {
        let this_canister_id = id();
        let icp_fee_subaccount = Subaccount(DISPENSER_ICP_FEE_SUBACCOUNT);
        let icp_fee_account_id = AccountIdentifier::new(&this_canister_id, &icp_fee_subaccount);

        let account_balance_args = AccountBalanceArgs {
            account: icp_fee_account_id,
        };

        // check how much ICPs were redistributed for burning
        let balance_call_result =
            ic_ledger_types::account_balance(ENV_VARS.icp_token_canister_id, account_balance_args)
                .await;

        if let Ok(balance) = balance_call_result {
            if balance.e8s() > ICP_FEE {
                deposit_cycles(balance.e8s()).await;
            }
        }
    });

    set_transform_icp_fee_to_cycles_timer();
}

async fn deposit_cycles(qty_e8s_u64: u64) -> CallResult<(Result<Nat, NotifyTopUpError>,)> {
    let transfer_args = TransferArgs {
        from_subaccount: Some(Subaccount(DISPENSER_ICP_FEE_SUBACCOUNT)),
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
