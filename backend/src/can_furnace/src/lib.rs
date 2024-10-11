use candid::Principal;
use ic_cdk::{api::time, caller, id, init, post_upgrade, query, update};
use ic_e8s::c::E8s;
use ic_ledger_types::Subaccount;
use icrc_ledger_types::icrc1::{account::Account, transfer::TransferArg};
use shared::{
    furnace::{
        api::{
            AddSupportedTokenRequest, AddSupportedTokenResponse, DeployDispenserRequest,
            DeployDispenserResponse, GetCurRoundPositionsRequest, GetCurRoundPositionsResponse,
            GetWinnersRequest, GetWinnersResponse, PledgeRequest, PledgeResponse,
            RemoveSupportedTokenRequest, RemoveSupportedTokenResponse, SetMaintenanceStatusRequest,
            SetMaintenanceStatusResponse, UpdateDispenserWasmRequest, UpdateDispenserWasmResponse,
            VoteTokenXRequest, VoteTokenXResponse, WithdrawRequest, WithdrawResponse,
        },
        types::{FurnaceInfoPub, TokenX, TokenXVote, FURNACE_REDISTRIBUTION_SUBACCOUNT},
    },
    icrc1::ICRC1CanisterClient,
    Guard,
};
use utils::{
    deploy_dispenser_for, deposit_cycles, set_fetch_token_prices_timer,
    set_init_canister_one_timer, set_raffle_timer, STATE,
};

pub mod utils;

#[update]
async fn pledge(mut req: PledgeRequest) -> PledgeResponse {
    STATE.with_borrow(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request");
    });

    let token = ICRC1CanisterClient::new(req.token_can_id);
    let caller_subaccount = Subaccount::from(caller()).0;

    token
        .icrc1_transfer(TransferArg {
            from_subaccount: Some(caller_subaccount),
            to: Account {
                owner: id(),
                subaccount: Some(FURNACE_REDISTRIBUTION_SUBACCOUNT),
            },
            amount: req.qty.clone(),
            fee: None,
            created_at_time: None,
            memo: None,
        })
        .await
        .expect("Unable to pledge")
        .0
        .expect("Unable to pledge");

    STATE.with_borrow_mut(|s| s.pledge(req))
}

#[update]
async fn withdraw(mut req: WithdrawRequest) -> WithdrawResponse {
    STATE.with_borrow(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request")
    });

    let token = ICRC1CanisterClient::new(req.token_can_id);
    let caller_subaccount = Subaccount::from(caller()).0;

    let block_idx = token
        .icrc1_transfer(TransferArg {
            from_subaccount: Some(caller_subaccount),
            to: req.to,
            amount: req.qty,
            fee: None,
            created_at_time: None,
            memo: None,
        })
        .await
        .expect("Unable to withdraw")
        .0
        .expect("Unable to withdraw");

    WithdrawResponse { block_idx }
}

#[update]
fn vote_token_x(mut req: VoteTokenXRequest) -> VoteTokenXResponse {
    STATE.with_borrow_mut(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request");

        s.vote_token_x(req, caller())
    })
}

#[update]
async fn deploy_dispenser(mut req: DeployDispenserRequest) -> DeployDispenserResponse {
    STATE.with_borrow(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request")
    });

    deposit_cycles(caller(), 9999_0000u64)
        .await
        .expect("Unable to collect the fee")
        .0
        .expect("Unable to collect the fee");

    let dispenser_can_id = deploy_dispenser_for(req.token_can_id).await;

    let prev_dispenser_opt = STATE.with_borrow(|s| s.dispenser_of(&req.token_can_id));
    // check for race conditions
    if let Some(prev_dispenser) = prev_dispenser_opt {
        DeployDispenserResponse {
            dispenser_can_id: prev_dispenser,
        }
    } else {
        STATE.with_borrow_mut(|s| s.add_dispenser(req.token_can_id, dispenser_can_id));

        DeployDispenserResponse { dispenser_can_id }
    }
}

#[query]
fn list_dispensers() -> Vec<(Principal, Principal)> {
    STATE.with_borrow(|s| {
        let mut result = Vec::new();

        for entry in s.token_dispensers.iter() {
            result.push(entry);
        }

        result
    })
}

#[query]
fn list_supported_tokens() -> Vec<TokenX> {
    STATE.with_borrow(|s| s.list_supported_tokens())
}

#[query]
fn get_my_vote_token_x() -> Option<TokenXVote> {
    STATE.with_borrow(|s| s.get_vote_token_x_of(&caller()))
}

#[query]
fn list_token_x_alternatives() -> Vec<(Principal, E8s)> {
    STATE.with_borrow(|s| s.list_token_x_alternatives())
}

#[query]
fn get_furnace_info() -> FurnaceInfoPub {
    STATE.with_borrow(|s| s.get_furnace_info().to_pub())
}

#[query]
fn get_winners(mut req: GetWinnersRequest) -> GetWinnersResponse {
    STATE.with_borrow(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request");

        let winners = s
            .winners
            .iter()
            .skip(req.skip as usize)
            .take(req.take)
            .map(|(_, it)| it)
            .collect();

        GetWinnersResponse { winners }
    })
}

#[query]
fn get_cur_round_positions(mut req: GetCurRoundPositionsRequest) -> GetCurRoundPositionsResponse {
    STATE.with_borrow(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request");

        let positions = s
            .cur_round_positions
            .iter()
            .skip(req.skip as usize)
            .take(req.take)
            .collect();

        GetCurRoundPositionsResponse { positions }
    })
}

#[update]
fn add_supported_token(mut req: AddSupportedTokenRequest) -> AddSupportedTokenResponse {
    STATE.with_borrow_mut(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request");

        for token in req.tokens {
            s.add_supported_token(token);
        }
    });

    AddSupportedTokenResponse {}
}

#[update]
fn remove_supported_token(mut req: RemoveSupportedTokenRequest) -> RemoveSupportedTokenResponse {
    STATE.with_borrow_mut(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request");

        for can_id in req.token_can_ids {
            s.remove_supported_token(&can_id);
        }
    });

    RemoveSupportedTokenResponse {}
}

#[update]
fn set_maintenance_status(mut req: SetMaintenanceStatusRequest) -> SetMaintenanceStatusResponse {
    STATE.with_borrow_mut(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request");

        let mut info = s.get_furnace_info();
        info.is_on_maintenance = req.new_status;
        s.set_furnace_info(info);
    });

    SetMaintenanceStatusResponse {}
}

#[update]
fn update_dispenser_wasm(mut req: UpdateDispenserWasmRequest) -> UpdateDispenserWasmResponse {
    STATE.with_borrow_mut(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request");

        s.set_dispenser_wasm(req.wasm);
    });

    UpdateDispenserWasmResponse {}
}

#[init]
fn init_hook() {
    set_init_canister_one_timer(caller());
    set_fetch_token_prices_timer();
    set_raffle_timer();
}

#[post_upgrade]
fn post_upgrade_hook() {
    set_fetch_token_prices_timer();
    set_raffle_timer();
}
