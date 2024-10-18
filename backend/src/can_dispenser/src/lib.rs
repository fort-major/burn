use candid::{Nat, Principal};
use ic_cdk::{
    api::{
        call::{msg_cycles_accept128, msg_cycles_available128},
        canister_balance128, time,
    },
    caller, init, post_upgrade, query, update,
};
use ic_e8s::d::EDs;
use ic_ledger_types::Subaccount;
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
        types::{DispenserInfoPub, Distribution, DistributionId},
    },
    furnace::api::WithdrawResponse,
    icrc1::ICRC1CanisterClient,
    Guard, ENV_VARS, ICP_FEE,
};
use utils::{
    charge_caller_distribution_creation_fee_icp, charge_caller_tokens, claim_caller_tokens,
    set_init_canister_one_timer, set_tick_timer, set_transform_icp_fee_to_cycles_timer, STATE,
};

pub mod utils;

#[update]
async fn create_distribution(mut req: CreateDistributionRequest) -> CreateDistributionResponse {
    let info = STATE.with_borrow(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request");

        s.get_dispenser_info()
    });

    if !info.initted {
        panic!("The dispenser is not initted yet");
    }

    if caller() != ENV_VARS.furnace_canister_id {
        charge_caller_distribution_creation_fee_icp().await;
    }

    charge_caller_tokens(info.token_can_id.unwrap(), info.token_fee, req.qty.clone()).await;

    // request validity does not depend on the state - safe to continue without checking validity again

    STATE.with_borrow_mut(|s| s.create_distribution(req, caller()))
}

#[update]
fn cancel_distribution(mut req: CancelDistributionRequest) -> CancelDistributionResponse {
    STATE.with_borrow_mut(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request");

        s.cancel_distribution(req)
    })
}

#[update]
async fn withdraw_user_tokens(req: WithdrawUserTokensRequest) -> WithdrawUserTokensResponse {
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
    STATE.with_borrow(|s| s.unclaimed_tokens.get(&caller()).unwrap_or_default())
}

#[update]
async fn claim_tokens(mut req: ClaimTokensRequest) -> ClaimTokensResponse {
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

#[init]
fn init_hook(args: InitArgs) {
    STATE.with_borrow_mut(|s| {
        let mut info = s.get_dispenser_info();
        info.token_can_id = Some(args.token_can_id);
        s.set_dispenser_info(info);
    });

    set_init_canister_one_timer();
    set_transform_icp_fee_to_cycles_timer();
    set_tick_timer();
}

#[post_upgrade]
fn post_upgrade_hook() {
    set_transform_icp_fee_to_cycles_timer();
    set_tick_timer();
}
