use candid::{Nat, Principal};
use ic_cdk::api::{cycles_burn, time};
use ic_cdk::{caller, export_candid, init, post_upgrade, query, update};
use ic_cdk_timers::set_timer;
use ic_ledger_types::Subaccount;
use icrc_ledger_types::icrc1::account::Account;
use icrc_ledger_types::icrc1::transfer::TransferArg;
use shared::burner::api::{
    ClaimRewardRequest, ClaimRewardResponse, GetBurnersRequest, GetBurnersResponse,
    GetTotalsResponse, MigrateMsqAccountRequest, MigrateMsqAccountResponse,
    RefundLostTokensRequest, RefundLostTokensResponse, StakeRequest, StakeResponse,
    VerifyDecideIdRequest, VerifyDecideIdResponse, WithdrawRequest, WithdrawResponse,
};
use shared::burner::types::TCycles;
use shared::icrc1::ICRC1CanisterClient;
use shared::{CYCLES_BURNER_FEE, ENV_VARS, ICP_CAN_ID, MIN_ICP_STAKE_E8S_U64};
use utils::{
    assert_running, deposit_cycles, lottery_and_pos, set_init_seed_one_timer, STATE,
    STOPPED_FOR_UPDATE,
};

use std::time::Duration;

mod utils;

#[update]
async fn withdraw(req: WithdrawRequest) -> WithdrawResponse {
    assert_running();

    let c = caller();
    let icp_can_id = Principal::from_text(ICP_CAN_ID).unwrap();
    let icp_can = ICRC1CanisterClient::new(icp_can_id);

    icp_can
        .icrc1_transfer(TransferArg {
            from_subaccount: Some(subaccount_of(c).0),
            to: Account {
                owner: req.to,
                subaccount: None,
            },
            amount: Nat(req.qty_e8s.val),
            fee: None,
            created_at_time: None,
            memo: None,
        })
        .await
        .expect("Unable to call ICP canister")
        .0
        .expect("Unable to transfer ICP");

    WithdrawResponse {}
}

#[update]
async fn stake(req: StakeRequest) -> StakeResponse {
    assert_running();

    if req.qty_e8s_u64 < MIN_ICP_STAKE_E8S_U64 {
        panic!("At least 0.5 ICP is required to fuel the furnace");
    }

    let cycles = deposit_cycles(req.qty_e8s_u64)
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

    StakeResponse {}
}

#[update]
async fn claim_reward(req: ClaimRewardRequest) -> ClaimRewardResponse {
    assert_running();

    let c = caller();

    let result = if let Some(unclaimed) = STATE.with_borrow_mut(|s| s.claim_reward(c)) {
        let burn_token_can = ICRC1CanisterClient::new(ENV_VARS.burn_token_canister_id);

        let res = burn_token_can
            .icrc1_transfer(TransferArg {
                to: Account {
                    owner: req.to,
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
    };

    ClaimRewardResponse { result }
}

#[update]
fn verify_decide_id(req: VerifyDecideIdRequest) -> VerifyDecideIdResponse {
    STATE
        .with_borrow_mut(|s| s.verify_decide_id(&req.jwt, caller(), time()))
        .expect("Unable to verify Decide ID");

    VerifyDecideIdResponse {}
}

#[update]
fn migrate_msq_account(req: MigrateMsqAccountRequest) -> MigrateMsqAccountResponse {
    STATE
        .with_borrow_mut(|s| s.migrate_burner_account(&caller(), req.to))
        .expect("Unable to migrate MSQ account");

    MigrateMsqAccountResponse {}
}

#[query]
fn can_migrate_msq_account() -> bool {
    STATE.with_borrow(|s| s.get_info().can_migrate(&caller()))
}

#[query]
fn decide_id_verified_accounts_count() -> u32 {
    STATE.with_borrow(|s| s.get_total_verified_accounts())
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
    lottery_and_pos();
}

#[post_upgrade]
fn post_upgrade_hook() {
    STOPPED_FOR_UPDATE.with_borrow_mut(|(dev, _)| *dev = caller());

    // TODO: delete before the next upgrade
    STATE.with_borrow_mut(|s| s.init_tmp_can_migrate());

    lottery_and_pos();
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

#[update]
async fn refund_lost_tokens(_req: RefundLostTokensRequest) -> RefundLostTokensResponse {
    /*     assert_caller_is_dev();

    match req.kind {
        RefundTokenKind::ICP(accounts) => {
            let icp_can_id = Principal::from_text(ICP_CAN_ID).unwrap();
            let mut futs = Vec::new();

            for (account, refund_sum) in accounts {
                let transfer_args = TransferArgs {
                    amount: Tokens::from_e8s(refund_sum),
                    to: account,
                    memo: Memo(763824),
                    fee: Tokens::from_e8s(ICP_FEE),
                    from_subaccount: None,
                    created_at_time: None,
                };

                futs.push(async {
                    let res = transfer(icp_can_id, transfer_args).await;

                    match res {
                        Ok(r) => match r {
                            Ok(b) => Ok(Nat::from(b)),
                            Err(e) => Err(format!("ICP Transfer error: {}", e)),
                        },
                        Err(e) => Err(format!("ICP Call error: {:?}", e)),
                    }
                });
            }

            RefundLostTokensResponse {
                results: join_all(futs).await,
            }
        }
    } */

    RefundLostTokensResponse {
        results: Vec::new(),
    }
}

export_candid!();
