use std::collections::BTreeMap;

use candid::{Nat, Principal};
use ic_cdk::{
    api::{
        call::{msg_cycles_accept128, msg_cycles_available128},
        canister_balance128, time,
    },
    caller, export_candid, id, init, post_upgrade, query, update,
};
use ic_cdk_timers::clear_timer;
use ic_e8s::d::EDs;
use ic_ledger_types::{AccountIdentifier, Subaccount};
use icrc_ledger_types::icrc1::{account::Account, transfer::TransferArg};
use shared::{
    burner::types::TCycles,
    dispenser::{
        api::{
            CancelDistributionRequest, CancelDistributionResponse, ClaimTokensRequest,
            ClaimTokensResponse, CreateDistributionRequest, CreateDistributionResponse,
            FurnaceTriggerDistributionRequest, FurnaceTriggerDistributionResponse,
            GetDistributionsRequest, GetDistributionsResponse, InitArgs, WithdrawCanceledRequest,
            WithdrawCanceledResponse, WithdrawUserTokensRequest, WithdrawUserTokensResponse,
        },
        types::{
            CurrentDistributionInfo, DispenserInfoPub, Distribution, DistributionId,
            DISPENSER_DEV_FEE_SUBACCOUNT, DISPENSER_DISTRIBUTION_SUBACCOUNT,
            DISPENSER_ICP_FEE_SUBACCOUNT,
        },
    },
    icrc1::ICRC1CanisterClient,
    Guard, ENV_VARS, ICP_FEE,
};
use utils::{
    charge_caller_distribution_creation_fee_icp, charge_caller_tokens, charge_dev_fee,
    claim_caller_tokens, set_init_canister_one_timer, set_tick_timer,
    set_transfer_dev_fee_to_furnace_timer, set_transform_icp_fee_to_cycles_timer, IS_STOPPED,
    STATE, TIMERS,
};

pub mod utils;

#[update]
async fn create_distribution(mut req: CreateDistributionRequest) -> CreateDistributionResponse {
    panic!("The dispensing is temporarily stopped. Please, come back later");

    if is_stopped() {
        panic!("The canister is stopped for an upgrade");
    }

    let info = STATE.with_borrow(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request");

        s.get_dispenser_info()
    });

    if !info.initted {
        panic!("The dispenser is not initted yet");
    }

    // if requested from bonfire - don't charge fees
    let qty = if caller() != ENV_VARS.furnace_canister_id {
        charge_caller_distribution_creation_fee_icp().await;

        charge_dev_fee(
            info.token_can_id.unwrap(),
            info.token_fee.clone(),
            req.qty.clone(),
        )
        .await
    } else {
        req.qty.clone()
    };

    req.qty = qty - info.token_fee.clone();

    charge_caller_tokens(
        info.token_can_id.unwrap(),
        info.token_fee.clone(),
        req.qty.clone(),
    )
    .await;

    req.qty -= info.token_fee;

    // request validity does not depend on the state - safe to continue without checking validity again

    STATE.with_borrow_mut(|s| s.create_distribution(req, caller()))
}

#[update]
fn cancel_distribution(mut req: CancelDistributionRequest) -> CancelDistributionResponse {
    if is_stopped() {
        panic!("The canister is stopped for an upgrade");
    }

    STATE.with_borrow_mut(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request");

        s.cancel_distribution(req)
    })
}

#[update]
async fn withdraw_user_tokens(req: WithdrawUserTokensRequest) -> WithdrawUserTokensResponse {
    if is_stopped() {
        panic!("The canister is stopped for an upgrade");
    }

    let (fee, token_can_id) = if req.icp {
        (Nat::from(ICP_FEE), ENV_VARS.icp_token_canister_id)
    } else {
        let info = STATE.with_borrow(|s| s.get_dispenser_info());

        (info.token_fee, info.token_can_id.unwrap())
    };

    if req.qty < fee.clone() * Nat::from(2u64) {
        panic!("Amount too small");
    }

    let token = ICRC1CanisterClient::new(token_can_id);
    let block_idx = token
        .icrc1_transfer(TransferArg {
            from_subaccount: Some(subaccount_of(caller()).0),
            to: req.to,
            amount: req.qty - fee,
            fee: None,
            created_at_time: None,
            memo: None,
        })
        .await
        .expect("Unable to withdraw")
        .0
        .expect("Unable to withdraw");

    WithdrawUserTokensResponse { block_idx }
}

#[update]
async fn withdraw_canceled_funds(mut req: WithdrawCanceledRequest) -> WithdrawCanceledResponse {
    if is_stopped() {
        panic!("The canister is stopped for an upgrade");
    }

    let info = STATE.with_borrow_mut(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request");

        s.withdraw_canceled(req.clone());

        s.get_dispenser_info()
    });

    let claim_result =
        claim_caller_tokens(info.token_can_id.unwrap(), info.token_fee, req.qty.clone()).await;

    if claim_result.is_err() {
        STATE.with_borrow_mut(|s| s.revert_withdraw_canceled(req));
    }

    WithdrawCanceledResponse {
        result: claim_result,
    }
}

#[query]
fn get_info() -> DispenserInfoPub {
    STATE.with_borrow(|s| s.get_dispenser_info().to_pub())
}

#[query]
fn get_distribution(id: DistributionId) -> Option<Distribution> {
    STATE.with_borrow(|s| s.get_distribution(id))
}

#[query]
fn get_distributions(req: GetDistributionsRequest) -> GetDistributionsResponse {
    STATE.with_borrow(|s| s.get_distributions(req))
}

#[query]
fn get_unclaimed_tokens() -> EDs {
    STATE.with_borrow(|s| {
        s.unclaimed_tokens
            .get(&caller())
            .unwrap_or_default()
            .to_decimals(s.get_dispenser_info().token_decimals)
    })
}

#[update]
async fn claim_tokens(mut req: ClaimTokensRequest) -> ClaimTokensResponse {
    if is_stopped() {
        panic!("The canister is stopped for an upgrade");
    }

    let info = STATE.with_borrow_mut(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request");

        // claiming immediately to prevent re-entrancy
        s.claim_tokens(caller(), req.qty.clone());

        s.get_dispenser_info()
    });

    let claim_result = claim_caller_tokens(
        info.token_can_id.unwrap(),
        info.token_fee.clone(),
        Nat(req.qty.val.clone()),
    )
    .await;

    // revert on bad transfer
    if claim_result.is_err() {
        STATE.with_borrow_mut(|s| s.revert_claim_tokens(caller(), req.qty));
    }

    ClaimTokensResponse {
        result: claim_result,
    }
}

#[update]
fn furnace_trigger_distribution(
    mut req: FurnaceTriggerDistributionRequest,
) -> FurnaceTriggerDistributionResponse {
    STATE.with_borrow_mut(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request");

        s.furnace_trigger_distribution(req)
    })
}

#[update]
fn receive_cycles() {
    let avail_cycles = msg_cycles_available128();
    msg_cycles_accept128(avail_cycles);
}

#[query]
fn get_cycles_balance() -> TCycles {
    let balance = canister_balance128();

    // erase a piece of information to prevent some attacks and return
    TCycles::from(balance)
        .to_dynamic()
        .to_decimals(1)
        .to_decimals(12)
        .to_const()
}

#[query]
fn subaccount_of(pid: Principal) -> Subaccount {
    Subaccount::from(pid)
}

#[query]
fn get_current_distribution_info() -> CurrentDistributionInfo {
    STATE.with_borrow(|s| s.get_current_distribution_info())
}

#[query]
fn get_account_ids() -> BTreeMap<String, (AccountIdentifier, Account)> {
    let mut map = BTreeMap::new();

    map.insert(
        String::from("Dev Fee"),
        (
            AccountIdentifier::new(&id(), &Subaccount(DISPENSER_DEV_FEE_SUBACCOUNT)),
            Account {
                owner: id(),
                subaccount: Some(DISPENSER_DEV_FEE_SUBACCOUNT),
            },
        ),
    );
    map.insert(
        String::from("Distribution"),
        (
            AccountIdentifier::new(&id(), &Subaccount(DISPENSER_DISTRIBUTION_SUBACCOUNT)),
            Account {
                owner: id(),
                subaccount: Some(DISPENSER_DISTRIBUTION_SUBACCOUNT),
            },
        ),
    );
    map.insert(
        String::from("ICP Fee"),
        (
            AccountIdentifier::new(&id(), &Subaccount(DISPENSER_ICP_FEE_SUBACCOUNT)),
            Account {
                owner: id(),
                subaccount: Some(DISPENSER_ICP_FEE_SUBACCOUNT),
            },
        ),
    );

    map
}

#[query]
fn is_stopped() -> bool {
    utils::is_stopped()
}

#[update]
fn stop() {
    if caller() != ENV_VARS.furnace_canister_id {
        panic!("Access denied");
    }

    IS_STOPPED.with_borrow_mut(|s| *s = true);

    TIMERS.with_borrow(|t| {
        for id in t {
            clear_timer(*id);
        }
    });
}

#[update]
fn resume() {
    if caller() != ENV_VARS.furnace_canister_id {
        panic!("Access denied");
    }

    IS_STOPPED.with_borrow_mut(|s| *s = false);

    set_transform_icp_fee_to_cycles_timer();
    set_tick_timer(false);
    set_transfer_dev_fee_to_furnace_timer();
}

#[init]
fn init_hook(args: InitArgs) {
    STATE.with_borrow_mut(|s| {
        let mut info = s.get_dispenser_info();
        info.token_can_id = Some(args.token_can_id);
        s.set_dispenser_info(info);
    });

    set_init_canister_one_timer();

    set_transform_icp_fee_to_cycles_timer();
    set_tick_timer(false);
    set_transfer_dev_fee_to_furnace_timer();
}

#[post_upgrade]
fn post_upgrade_hook() {
    set_transform_icp_fee_to_cycles_timer();
    set_tick_timer(true);
    set_transfer_dev_fee_to_furnace_timer();
}

export_candid!();
