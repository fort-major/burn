use std::{cell::RefCell, time::Duration};

use candid::{encode_args, Nat, Principal};

use ic_cdk::{
    api::{
        call::{CallResult, RejectionCode},
        management_canister::main::{
            create_canister, install_code, raw_rand, CanisterInstallMode, CreateCanisterArgument,
            InstallCodeArgument,
        },
        time,
    },
    id, notify, print, spawn,
};
use ic_cdk_timers::set_timer;
use ic_e8s::{c::E8s, d::EDs};
use ic_ledger_types::{transfer, AccountIdentifier, Memo, Subaccount, Tokens, TransferArgs};
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager},
    Cell, DefaultMemoryImpl, StableBTreeMap,
};
use icrc_ledger_types::icrc1::{account::Account, transfer::TransferArg};
use shared::{
    cmc::{CMCClient, NotifyTopUpError, NotifyTopUpRequest},
    dispenser::{
        api::{CreateDistributionRequest, FurnaceTriggerDistributionRequest, InitArgs},
        client::DispenserClient,
        types::{DistributionScheme, DistributionStartCondition},
    },
    furnace::{
        state::FurnaceState,
        types::{
            DistributionTriggerKind, FurnaceInfo, TokenX, FURNACE_DEV_FEE_SUBACCOUNT,
            FURNACE_ICP_PRIZE_DISTRIBUTION_SUBACCOUNT, FURNACE_REDISTRIBUTION_SUBACCOUNT,
        },
    },
    icpswap::ICPSwapClient,
    icrc1::ICRC1CanisterClient,
    utils::duration_until_next_sunday_15_00,
    CanisterMode, ENV_VARS, ICP_FEE, MEMO_TOP_UP_CANISTER, ONE_MINUTE_NS,
};

thread_local! {
    pub static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    pub static STATE: RefCell<FurnaceState> = RefCell::new(
        FurnaceState {
            cur_round_burn_positions: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(0))),
            ),
            cur_round_positions: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(1))),
            ),
            raffle_round_info: Cell::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(2))), None).expect("Unable to create raffle round info cell"),

            winners: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(3))),
            ),
            furnace_info: Cell::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(4))), FurnaceInfo::default()).expect("Unable to create furnace info cell"),
            token_exchange_rates: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(5))),
            ),
            supported_tokens: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(6))),
            ),

            next_token_x_alternatives: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(7))),
            ),
            next_token_x_votes: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(8))),
            ),
            token_dispensers: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(9))),
            ),
            dispenser_wasm: Cell::init(MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(10))), Vec::new()).expect("Unable to create dispenser wasm cell"),

            total_burned_tokens: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(11))),
            ),

            distribution_triggers: StableBTreeMap::init(
                MEMORY_MANAGER.with_borrow(|m| m.get(MemoryId::new(12))),
            ),
        }
    );

    pub static IS_STOPPED: RefCell<bool> = RefCell::default();

    pub static NEXT_RAFFLE_TIMESTAMP: RefCell<u64> = RefCell::default();
}

pub fn is_stopped() -> bool {
    IS_STOPPED.with_borrow(|s| *s)
}

pub fn set_init_canister_one_timer(caller: Principal) {
    set_timer(Duration::from_nanos(0), move || init_canister(caller));
}

fn init_canister(caller: Principal) {
    spawn(async move {
        let (rand,) = raw_rand().await.expect("Unable to fetch rand");

        STATE.with_borrow_mut(|s| s.init(caller, rand, time()));
    });
}

pub fn set_fetch_token_prices_timer() {
    if is_stopped() {
        return;
    }

    set_timer(Duration::from_nanos(0), fetch_token_prices);
}

fn fetch_token_prices() {
    spawn(async {
        let should_mock = matches!(ENV_VARS.mode, CanisterMode::Dev);
        let icpswap = ICPSwapClient::new(None, should_mock);

        let call_result = icpswap.get_all_tokens().await;

        if let Ok(response) = call_result {
            STATE.with_borrow_mut(|s| s.update_token_exchange_rates(response));
        }

        set_timer(Duration::from_nanos(ONE_MINUTE_NS * 10), fetch_token_prices);
    });
}

pub fn set_raffle_timer() {
    if is_stopped() {
        return;
    }

    let now = time();
    let duration = duration_until_next_sunday_15_00(now);
    NEXT_RAFFLE_TIMESTAMP.with_borrow_mut(|s| *s = now + duration.as_nanos() as u64);

    set_timer(duration, start_the_raffle);
}

pub fn start_the_raffle() {
    STATE.with_borrow_mut(|s| s.set_looking_for_winners(true));

    set_timer(Duration::from_nanos(ONE_MINUTE_NS), handle_prize_fund_icp);

    print("Starting the raffle");
}

fn handle_prize_fund_icp() {
    spawn(async {
        let icp = ICRC1CanisterClient::new(ENV_VARS.icp_token_canister_id);
        let call_result = icp
            .icrc1_balance_of(Account {
                owner: id(),
                subaccount: None,
            })
            .await;

        if let Ok((balance,)) = call_result {
            let balance_e8s = E8s::new(balance.0);
            let prize_fund_cur_round = balance_e8s * E8s::from(8500_0000u64); // reserve 15% for the next round to keep the fund accumulating

            print("Moving the prize fund");

            let prize_fund_moved = move_prize_fund(icp, prize_fund_cur_round.clone()).await;

            if prize_fund_moved {
                STATE.with_borrow_mut(|s| {
                    s.prepare_raffle(prize_fund_cur_round - E8s::from(10_000u64))
                });

                print("Raffle prepared");

                set_timer(Duration::from_nanos(0), redistirbute_pledged_tokens);
                set_timer(Duration::from_nanos(0), find_winners);

                return;
            }
        }

        set_timer(
            Duration::from_nanos(ONE_MINUTE_NS * 10),
            handle_prize_fund_icp,
        );
    });
}

fn redistirbute_pledged_tokens() {
    spawn(async {
        let token_x = STATE.with_borrow(|s| s.get_furnace_info().cur_token_x);
        let burn = TokenX {
            can_id: ENV_VARS.burn_token_canister_id,
            fee: Nat::from(10_000u64),
            decimals: 8,
        };

        if token_x.can_id == burn.can_id {
            redistribute_pledged_token(burn).await;
        } else {
            redistribute_pledged_token(burn).await;
            redistribute_pledged_token(token_x).await;
        }
    });
}

// TODO: check all the responses and react to errors
async fn redistribute_pledged_token(token_x_info: TokenX) {
    let token = ICRC1CanisterClient::new(token_x_info.can_id);

    let balance_call_result = token
        .icrc1_balance_of(Account {
            owner: id(),
            subaccount: Some(FURNACE_REDISTRIBUTION_SUBACCOUNT),
        })
        .await;

    if let Ok((balance,)) = balance_call_result {
        let balance_eds = EDs::new(balance.0, token_x_info.decimals);

        let burn_share = &balance_eds * EDs::from((4750_0000u64, token_x_info.decimals));
        let pool_share = &balance_eds * EDs::from((5000_0000u64, token_x_info.decimals));
        let dev_fee_share = &balance_eds * EDs::from((0250_0000u64, token_x_info.decimals));

        let token_dispenser = STATE
            .with_borrow(|s| s.dispenser_of(&token_x_info.can_id))
            .expect("Token dispenser was not scheduled for deployment")
            .expect("Token dispenser was deployed badly");

        let dispenser_qty = Nat(pool_share.val) - token_x_info.fee.clone();

        let _ = token
            .icrc1_transfer(TransferArg {
                from_subaccount: Some(FURNACE_REDISTRIBUTION_SUBACCOUNT),
                to: Account {
                    owner: token_dispenser,
                    subaccount: Some(Subaccount::from(id()).0),
                },
                amount: dispenser_qty.clone(),
                fee: None,
                created_at_time: None,
                memo: None,
            })
            .await;

        let dispenser = DispenserClient(token_dispenser);
        let _ = dispenser
            .create_distribution(CreateDistributionRequest {
                qty: dispenser_qty - token_x_info.fee.clone(),
                start_condition: DistributionStartCondition::AtTickDelay(0),
                duration_ticks: 168, // ~1 week
                name: format!("Bonfire Distribution #{}", time() / 1_000_000_000),
                scheme: DistributionScheme::Linear,
                hidden: false,
                distribute_to_bonfire: false,
            })
            .await;

        let _ = token
            .icrc1_furnace_burn(
                Account {
                    owner: ENV_VARS.burner_canister_id,
                    subaccount: None,
                },
                Some(FURNACE_REDISTRIBUTION_SUBACCOUNT),
                Nat(burn_share.val.clone()),
            )
            .await;

        STATE.with_borrow_mut(|s| s.note_burned_token(token_x_info.can_id, &burn_share));

        let _ = token
            .icrc1_transfer(TransferArg {
                from_subaccount: Some(FURNACE_REDISTRIBUTION_SUBACCOUNT),
                to: Account {
                    owner: id(),
                    subaccount: Some(FURNACE_DEV_FEE_SUBACCOUNT),
                },
                amount: Nat(dev_fee_share.val) - token_x_info.fee,
                fee: None,
                created_at_time: None,
                memo: None,
            })
            .await;

        print(format!(
            "Redistributed pledged token {}",
            token_x_info.can_id
        ));
    }
}

// one position can win more than one prize in case there are less positions, than prizes
pub fn find_winners() {
    print(format!("Looking for winners"));

    let should_reschedule = STATE.with_borrow_mut(|s| s.find_winners_batch(300));

    if should_reschedule {
        set_timer(Duration::from_nanos(0), find_winners);
        return;
    }

    set_timer(Duration::from_nanos(0), select_next_token_x);
}

pub fn select_next_token_x() {
    print(format!("Selecting next token x"));

    let token_can_id = STATE.with_borrow_mut(|s| s.select_next_token_x());

    set_deploy_dispenser_timer(token_can_id);
    set_timer(Duration::from_nanos(0), process_next_token_x_triggers);
}

pub fn process_next_token_x_triggers() {
    print(format!("Processing triggers"));

    let (triggers_to_execute_opt, should_reschedule) = STATE.with_borrow_mut(|s| {
        let token_x_can_id = s.get_furnace_info().cur_token_x.can_id;
        let trigger_kind = DistributionTriggerKind::TokenXVotingWinner(token_x_can_id);

        s.process_triggers_batch(50, trigger_kind)
    });

    if let Some(triggers_to_execute) = triggers_to_execute_opt {
        for trigger in triggers_to_execute {
            let dispenser_id = STATE.with_borrow(|s| {
                s.dispenser_of(&trigger.dispenser_token_can_id)
                    .unwrap()
                    .unwrap()
            });

            // ignore results
            let _ = notify(
                dispenser_id,
                "furnace_trigger_distribution",
                (FurnaceTriggerDistributionRequest {
                    distribution_id: trigger.distribution_id,
                },),
            );
        }
    }

    if should_reschedule {
        set_timer(Duration::from_nanos(0), process_next_token_x_triggers);
    } else {
        set_timer(Duration::from_nanos(0), complete_raffle);
    }
}

pub fn complete_raffle() {
    print(format!("Completing the raffle"));

    STATE.with_borrow_mut(|s| {
        s.complete_raffle(time());

        s.set_looking_for_winners(false);
    });
}

pub fn set_deploy_dispenser_timer(token_can_id: Principal) {
    set_timer(Duration::from_nanos(ONE_MINUTE_NS), move || {
        deploy_dispenser_for(token_can_id);
    });
}

pub fn deploy_dispenser_for(token_can_id: Principal) -> bool {
    let is_free = STATE.with_borrow_mut(|s| s.mark_dispenser_deploying(token_can_id));

    if !is_free {
        return false;
    }

    spawn(async move {
        if let Some(can_id) = deploy_canister().await {
            STATE.with_borrow_mut(|s| s.add_dispenser(token_can_id, can_id));

            set_timer(Duration::from_nanos(0), move || {
                install_dispenser_code(can_id, token_can_id);
            });
        } else {
            set_deploy_dispenser_timer(token_can_id);
        }
    });

    true
}

fn set_install_dispenser_code_timer(can_id: Principal, token_can_id: Principal) {
    set_timer(Duration::from_nanos(ONE_MINUTE_NS), move || {
        install_dispenser_code(can_id, token_can_id)
    });
}

async fn deploy_canister() -> Option<Principal> {
    let call_result = create_canister(
        CreateCanisterArgument { settings: None },
        2_000_000_000_000u128,
    )
    .await;

    match call_result {
        Ok((rec,)) => Some(rec.canister_id),
        Err(_) => None,
    }
}

/// returns true if should re-schedule
fn install_dispenser_code(can_id: Principal, token_can_id: Principal) {
    spawn(async move {
        let call_result = install_code(InstallCodeArgument {
            mode: CanisterInstallMode::Install,
            canister_id: can_id,
            wasm_module: STATE.with_borrow(|s| s.get_dispenser_wasm().to_vec()),
            arg: encode_args((InitArgs { token_can_id },)).expect("Unable to encode args"),
        })
        .await;

        if let Err((c, m)) = call_result {
            print(format!(
                "Unable to install dispenser code, retrying - {:?}: {}",
                c, m
            ));

            set_install_dispenser_code_timer(can_id, token_can_id);
        }
    });
}

async fn move_prize_fund(icp: ICRC1CanisterClient, prize_fund_cur_round: E8s) -> bool {
    let res = icp
        .icrc1_transfer(TransferArg {
            from_subaccount: None,
            to: Account {
                owner: id(),
                subaccount: Some(FURNACE_ICP_PRIZE_DISTRIBUTION_SUBACCOUNT),
            },
            amount: Nat(prize_fund_cur_round.val),
            fee: None,
            created_at_time: None,
            memo: None,
        })
        .await;

    match res {
        Ok((Ok(_),)) => true,
        _ => false,
    }
}

pub async fn deposit_cycles(
    caller: Principal,
    qty_e8s_u64: u64,
) -> CallResult<(Result<Nat, NotifyTopUpError>,)> {
    let transfer_args = TransferArgs {
        from_subaccount: Some(Subaccount::from(caller)),
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
