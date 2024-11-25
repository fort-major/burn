use std::collections::BTreeMap;

use candid::Principal;
use futures::join;
use ic_cdk::{
    api::{
        call::{msg_cycles_accept128, msg_cycles_available128},
        canister_balance128, time,
    },
    caller, export_candid, id, init, post_upgrade, query, update,
};
use ic_e8s::c::E8s;
use ic_ledger_types::{AccountIdentifier, Subaccount};
use icrc_ledger_types::icrc1::{account::Account, transfer::TransferArg};
use shared::{
    burner::{client::BurnerClient, types::TCycles},
    icrc1::ICRC1CanisterClient,
    trading::types::{BalancesInfo, PriceInfo, TraderStats, TRADING_LP_SUBACCOUNT},
    ENV_VARS,
};
use utils::STATE;

mod utils;

#[derive(CandidType, Deserialize)]
pub struct OrderRequest {
    pub sell: bool,
    pub short: bool,
    pub qty: E8s,
}

#[update]
fn order(req: OrderRequest) {
    let user_pid = caller();
    let now = time();

    STATE.with_borrow_mut(|s| s.order(user_pid, req.sell, req.short, req.qty, now))
}

#[update]
async fn deposit(qty: E8s) {
    let user_pid = caller();
    let (user_qty, lp_qty, inviter_pack) =
        STATE.with_borrow(|s| s.calc_deposit_layout(user_pid, &qty));

    let user_subaccount = subaccount_of(user_pid);

    let burn_token_can = ICRC1CanisterClient::new(ENV_VARS.burn_token_canister_id);

    let user_arg = TransferArg {
        from_subaccount: user_subaccount,
        amount: user_qty,
        to: Account {
            owner: ENV_VARS.burner_canister_id,
            subaccount: None,
        },
        fee: Some(Nat::from(0u64)),
        created_at_time: None,
        memo: None,
    };
    let user_transfer_future = burn_token_can.icrc1_transfer(user_arg);

    let lp_arg = TransferArg {
        from_subaccount: user_subaccount,
        amount: lp_qty,
        to: Account {
            owner: id(),
            subaccount: Some(TRADING_LP_SUBACCOUNT),
        },
        fee: Some(Nat::from(10_000u64)),
        created_at_time: None,
        memo: None,
    };
    let lp_transfer_future = burn_token_can.icrc1_transfer(lp_arg);

    // ignoring the second result, LP fees are best effort
    let (user_transfer_call_result, _) = join!(user_transfer_future, lp_transfer_future);

    user_transfer_call_result
        .expect("Unable to call the $BURN token canister")
        .0
        .expect("Unable to transfer tokens");

    STATE.with_borrow_mut(|s| s.deposit(user_pid, user_qty, inviter_pack));
}

#[update]
async fn withdraw() {
    let user_pid = caller();
    let user_qty = STATE.with_borrow_mut(|s| s.withdraw(user_pid));

    if user_qty < E8s::from(10_0000u64) {
        panic!("Balance too low (need more than 0.0001 to withdraw)");
    }

    let burner_can = BurnerClient(ENV_VARS.burner_canister_id);
    burner_can
        .mint(user_pid, user_qty)
        .await
        .expect("Unable to mint $BURN");
}

#[update]
async fn withdraw_from_user_subaccount(qty: E8s) {
    let user_pid = caller();
    let user_subaccount = subaccount_of(user_pid);
    let burn_can = ICRC1CanisterClient::new(ENV_VARS.burn_token_canister_id);

    let arg = TransferArg {
        from_subaccount: user_subaccount,
        amount: Nat(qty.val),
        to: Account {
            owner: user_pid,
            subaccount: None,
        },
        fee: Some(Nat::from(10_0000u64)),
        created_at_time: None,
        memo: None,
    };

    burn_can
        .icrc1_transfer(arg)
        .await
        .expect("Unable to make a call to the $BURN token canister")
        .0
        .expect("Unable to transfer");
}

#[update]
fn register(pid: Principal, inviter: Option<Principal>) {
    let c = caller();
    if c != ENV_VARS.trading_invites_canister_id {
        panic!("Access denied");
    }

    STATE.with_borrow_mut(|s| s.register(pid, inviter));
}

#[query]
fn get_user_balances() -> Option<BalancesInfo, TraderStats> {
    STATE.with_borrow(|s| {
        s.get_balances_of(&caller())
            .map(|it| (it, s.get_stats_of(&caller())))
    })
}

#[query]
fn get_info() -> PriceInfo {
    STATE.with_borrow(|s| s.get_price_info())
}

#[query]
fn get_all_trader_stats(skip: u64, take: u64) -> Vec<TraderStats> {
    STATE.with_borrow(|s| s.get_all_stats(skip, take))
}

// TODO: add price history and trade history endpoints (from latest)

#[query]
fn subaccount_of(pid: Principal) -> Subaccount {
    Subaccount::from(pid)
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
fn get_account_ids() -> BTreeMap<String, (AccountIdentifier, Account)> {
    let mut map = BTreeMap::new();

    map.insert(
        String::from("LPs"),
        (
            AccountIdentifier::new(&id(), &Subaccount(TRADING_LP_SUBACCOUNT)),
            Account {
                owner: id(),
                subaccount: Some(TRADING_LP_SUBACCOUNT),
            },
        ),
    );

    map
}

#[init]
fn init_hook() {}

#[post_upgrade]
fn post_upgrade_hook() {}

export_candid!();
