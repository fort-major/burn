use std::collections::BTreeMap;

use candid::{Nat, Principal};
use ic_cdk::api::time;
use ic_cdk::{caller, export_candid, id, init, post_upgrade, query, update};
use ic_e8s::c::E8s;
use ic_ledger_types::{AccountIdentifier, Memo, Subaccount, Tokens, TransferArgs};
use icrc_ledger_types::icrc1::account::Account;
use icrc_ledger_types::icrc1::transfer::TransferArg;
use shared::burner::api::{
    ClaimRewardRequest, ClaimRewardResponse, GetBurnersRequest, GetBurnersResponse,
    GetKamikazesRequest, GetKamikazesResponse, GetTotalsResponse, MigrateMsqAccountRequest,
    MigrateMsqAccountResponse, StakeRequest, StakeResponse, VerifyDecideIdRequest,
    VerifyDecideIdResponse, WithdrawRequest, WithdrawResponse,
};
use shared::burner::types::{
    BURNER_DEV_FEE_SUBACCOUNT, BURNER_REDISTRIBUTION_SUBACCOUNT, BURNER_SPIKE_SUBACCOUNT,
};
use shared::icrc1::ICRC1CanisterClient;
use shared::{ENV_VARS, ICP_FEE, MIN_ICP_STAKE_E8S_U64};
use utils::{
    assert_caller_is_dev, assert_running, kamikaze_and_pos, set_cycles_icp_exchange_rate_timer,
    set_icp_redistribution_timer, set_init_seed_one_timer, set_spike_timer,
    stake_callers_icp_for_redistribution, STATE, STOPPED_FOR_UPDATE,
};

mod utils;

#[update]
async fn withdraw(req: WithdrawRequest) -> WithdrawResponse {
    assert_running();

    let c = caller();
    let icp_can = ICRC1CanisterClient::new(ENV_VARS.icp_token_canister_id);

    let block_idx = icp_can
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

    WithdrawResponse { block_idx }
}

#[update]
async fn stake(req: StakeRequest) -> StakeResponse {
    assert_running();

    if req.qty_e8s_u64 < MIN_ICP_STAKE_E8S_U64 {
        panic!("At least 0.5 ICP is required to participate");
    }

    stake_callers_icp_for_redistribution(req.qty_e8s_u64)
        .await
        .expect("Unable to stake ICP");

    let staked_icps_e12s = E8s::from(req.qty_e8s_u64)
        .to_dynamic()
        .to_decimals(12)
        .to_const::<12>();

    STATE.with_borrow_mut(|s| {
        let info = s.get_info();
        let cycles_rate = info.get_icp_to_cycles_exchange_rate();

        let shares_minted = staked_icps_e12s * cycles_rate;

        s.mint_share(shares_minted.clone(), caller());
    });

    StakeResponse {}
}

#[update]
async fn stake_kamikaze(req: StakeRequest) -> StakeResponse {
    assert_running();

    if req.qty_e8s_u64 < MIN_ICP_STAKE_E8S_U64 {
        panic!("At least 0.5 ICP is required to participate");
    }

    stake_callers_icp_for_redistribution(req.qty_e8s_u64)
        .await
        .expect("Unable to stake ICP");

    let staked_icps_e12s = E8s::from(req.qty_e8s_u64)
        .to_dynamic()
        .to_decimals(12)
        .to_const::<12>();

    STATE.with_borrow_mut(|s| {
        let info = s.get_info();
        let cycles_rate = info.get_icp_to_cycles_exchange_rate();

        let shares_minted = staked_icps_e12s * cycles_rate;

        s.mint_kamikaze_share(shares_minted.clone(), caller(), time());
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
fn verify_decide_id(_req: VerifyDecideIdRequest) -> VerifyDecideIdResponse {
    /* STATE
    .with_borrow_mut(|s| s.verify_decide_id(&req.jwt, caller(), time()))
    .expect("Unable to verify Decide ID"); */

    VerifyDecideIdResponse {}
}

#[update]
fn migrate_msq_account(req: MigrateMsqAccountRequest) -> MigrateMsqAccountResponse {
    STATE
        .with_borrow_mut(|s| s.migrate_burner_account(&caller(), req.to))
        .expect("Unable to migrate MSQ account");

    MigrateMsqAccountResponse {}
}

#[update]
fn enable_lottery() {
    assert_caller_is_dev();

    STATE.with_borrow_mut(|s| {
        let mut info = s.get_info();
        info.enable_lottery();
        s.set_info(info);
    });
}

#[update]
fn disable_lottery() {
    assert_caller_is_dev();

    STATE.with_borrow_mut(|s| {
        let mut info = s.get_info();
        info.disable_lottery();
        s.set_info(info);
    });
}

#[update]
fn enable_kamikaze_pool() {
    assert_caller_is_dev();

    STATE.with_borrow_mut(|s| {
        let mut info = s.get_info();
        info.enable_kamikaze_pool();
        s.set_info(info);
    });
}

#[update]
fn disable_kamikaze_pool() {
    assert_caller_is_dev();

    STATE.with_borrow_mut(|s| {
        let mut info = s.get_info();
        info.disable_kamikaze_pool();
        s.set_info(info);
    });
}

#[update]
async fn withdraw_dev_fee_icp(qty: u64, account_id: AccountIdentifier) -> Result<u64, String> {
    assert_caller_is_dev();

    let arg = TransferArgs {
        from_subaccount: Some(Subaccount(BURNER_DEV_FEE_SUBACCOUNT)),
        to: account_id,
        amount: Tokens::from_e8s(qty),
        memo: Memo(2),
        fee: Tokens::from_e8s(ICP_FEE),
        created_at_time: None,
    };

    ic_ledger_types::transfer(ENV_VARS.icp_token_canister_id, arg)
        .await
        .map_err(|e| format!("{:?} {}", e.0, e.1))?
        .map_err(|e| format!("{e}"))
}

#[query]
fn get_account_ids() -> BTreeMap<String, AccountIdentifier> {
    let mut map = BTreeMap::new();

    map.insert(
        String::from("Dev Fee"),
        AccountIdentifier::new(&id(), &Subaccount(BURNER_DEV_FEE_SUBACCOUNT)),
    );
    map.insert(
        String::from("Redistribution"),
        AccountIdentifier::new(&id(), &Subaccount(BURNER_REDISTRIBUTION_SUBACCOUNT)),
    );
    map.insert(
        String::from("Spike"),
        AccountIdentifier::new(&id(), &Subaccount(BURNER_SPIKE_SUBACCOUNT)),
    );

    map
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
fn get_kamikazes(req: GetKamikazesRequest) -> GetKamikazesResponse {
    STATE.with_borrow(|s| s.get_kamikazes(req))
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
    set_cycles_icp_exchange_rate_timer();
    set_icp_redistribution_timer();
    set_spike_timer();

    kamikaze_and_pos();
}

#[post_upgrade]
fn post_upgrade_hook() {
    STOPPED_FOR_UPDATE.with_borrow_mut(|(dev, _)| *dev = caller());

    set_cycles_icp_exchange_rate_timer();
    set_icp_redistribution_timer();
    set_spike_timer();

    kamikaze_and_pos();
}

#[update]
fn stop() {
    assert_caller_is_dev();

    STOPPED_FOR_UPDATE.with_borrow_mut(|(_dev, is_stopped)| {
        if !*is_stopped {
            *is_stopped = true;
        }
    })
}

#[update]
fn resume() {
    assert_caller_is_dev();

    STOPPED_FOR_UPDATE.with_borrow_mut(|(_dev, is_stopped)| {
        if *is_stopped {
            *is_stopped = false;
        }
    })
}

export_candid!();
