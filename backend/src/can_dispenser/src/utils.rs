use std::{cell::RefCell, time::Duration};

use candid::{Nat, Principal};
use ic_cdk::{
    api::{management_canister::main::raw_rand, time},
    caller, id, spawn,
};
use ic_cdk_timers::set_timer;
use ic_ledger_types::{transfer, AccountIdentifier, Memo, Subaccount, Tokens, TransferArgs};
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
    dispenser::{
        state::DispenserState,
        types::{
            CurrentDistributionInfo, DispenserInfo, DISPENSER_DEFAULT_TICK_DELAY_NS,
            DISPENSER_DISTRIBUTION_SUBACCOUNT, DISPENSER_ICP_FEE_E8S, DISPENSER_ICP_FEE_SUBACCOUNT,
        },
    },
    icrc1::ICRC1CanisterClient,
    ENV_VARS, ICP_FEE, ONE_HOUR_NS, ONE_MINUTE_NS,
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

            unclaimed_tokens: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(2))),
            ),

            scheduled_distributions: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(3))),
            ),
            active_distributions: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(4))),
            ),
            past_distributions: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(5))),
            ),

            current_distribution_info: Cell::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(6))),
                CurrentDistributionInfo::default()
            ).expect("Unable to create cur distribution info cell"),

            dispenser_info: Cell::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(7))),
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

    set_timer(Duration::from_nanos(0), find_next_active_distribution);
}

async fn update_common_pool_members() {
    let client = BurnerClient(ENV_VARS.burner_canister_id);

    let mut start = None;

    loop {
        let call_result = client
            .get_burners(GetBurnersRequest { start, take: 200 })
            .await;

        if let Ok((response,)) = call_result {
            let should_stop = STATE.with_borrow_mut(|s| {
                let should_stop = response.entries.len() < 200;

                let mut total_shares = TCycles::zero();

                for entry in response.entries {
                    total_shares += &entry.share;

                    s.common_pool_members.insert(entry.pid, entry.share);

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

    let mut start = None;

    loop {
        let call_result = client
            .get_kamikazes(GetKamikazesRequest { start, take: 200 })
            .await;

        if let Ok((response,)) = call_result {
            let should_stop = STATE.with_borrow_mut(|s| {
                let should_stop = response.entries.len() < 200;

                let mut total_shares = TCycles::zero();

                for entry in response.entries {
                    total_shares += &entry.share;

                    s.kamikaze_pool_members.insert(entry.pid, entry.share);

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
