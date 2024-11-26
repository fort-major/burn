use std::{cell::RefCell, collections::BTreeMap};

use candid::{Nat, Principal};
use ic_cdk::{
    api::{
        call::{msg_cycles_accept128, msg_cycles_available128},
        canister_balance128,
        management_canister::main::raw_rand,
    },
    caller, export_candid, id, init, post_upgrade, query, update,
};
use ic_e8s::c::E8s;
use ic_ledger_types::{AccountIdentifier, Subaccount};
use icrc_ledger_types::icrc1::{account::Account, transfer::TransferArg};
use shared::{
    burner::types::TCycles,
    icrc1::ICRC1CanisterClient,
    trading::{client::TradingClient, types::TRADING_LP_SUBACCOUNT},
    trading_invites::types::{Invite, MemberInfo},
    ENV_VARS,
};
use utils::STATE;

mod utils;

#[query]
fn get_my_info() -> Option<MemberInfo> {
    STATE.with_borrow(|s| s.members.get(&caller()))
}

#[query]
fn get_invite_owner(invite: Invite) -> Option<Principal> {
    STATE.with_borrow(|s| s.invites.get(&invite))
}

#[update]
async fn update_my_invite() -> Invite {
    let pid = caller();
    let is_member = STATE.with_borrow(|s| s.members.get(&pid)).is_some();
    let is_dev = pid == DEV.with_borrow(|s| *s);

    if !is_member && !is_dev {
        panic!("Access denied");
    }

    let (rand,) = raw_rand().await.expect("Unable to fetch a random number");
    let mut invite = [0u8; 32];
    invite.copy_from_slice(&rand);

    STATE.with_borrow_mut(|s| {
        let mut member_info = s.members.get(&pid).unwrap_or_default();
        if let Some(old_invite) = member_info.cur_invite {
            s.invites.remove(&old_invite);
        }

        s.invites.insert(invite, pid);

        member_info.cur_invite = Some(invite);
        s.members.insert(pid, member_info);
    });

    invite
}

#[update]
async fn register_with_invite(invite: Invite) {
    let pid = caller();
    let is_member = STATE.with_borrow(|s| s.members.get(&pid)).is_some();

    if is_member {
        panic!("Already registered");
    }

    let inviter = STATE
        .with_borrow(|s| s.invites.get(&invite))
        .expect("Inviter not found");

    let trading_can = TradingClient(ENV_VARS.trading_canister_id);
    let register_result = trading_can.register(pid, Some(inviter)).await;

    if let Err((c, m)) = register_result {
        panic!("Unable to register - {:?}: {}", c, m);
    }

    STATE.with_borrow_mut(|s| {
        s.members.insert(pid, MemberInfo { cur_invite: None });
    });
}

#[update]
async fn register_with_bribe() {
    let user_pid = caller();
    let user_subaccount = subaccount_of(user_pid);

    let is_member = STATE.with_borrow(|s| s.members.get(&user_pid)).is_some();

    if is_member {
        panic!("Already registered");
    }

    let burn_token_can = ICRC1CanisterClient::new(ENV_VARS.burn_token_canister_id);
    let arg = TransferArg {
        from_subaccount: Some(user_subaccount.0),
        amount: Nat::from(9999_0000u64),
        to: Account {
            owner: ENV_VARS.trading_canister_id,
            subaccount: Some(TRADING_LP_SUBACCOUNT),
        },
        fee: Some(Nat::from(1_0000u64)),
        created_at_time: None,
        memo: None,
    };

    burn_token_can
        .icrc1_transfer(arg)
        .await
        .expect("Unable to call $BURN token canister")
        .0
        .expect("Unable to transfer");

    STATE.with_borrow_mut(|s| {
        s.members.insert(user_pid, MemberInfo { cur_invite: None });
    });
}

#[update]
async fn withdraw_from_user_subaccount(token_can_id: Principal, qty: E8s) {
    let user_pid = caller();
    let user_subaccount = subaccount_of(user_pid);
    let token_can = ICRC1CanisterClient::new(token_can_id);

    let arg = TransferArg {
        from_subaccount: Some(user_subaccount.0),
        amount: Nat(qty.val),
        to: Account {
            owner: user_pid,
            subaccount: None,
        },
        fee: None,
        created_at_time: None,
        memo: None,
    };

    token_can
        .icrc1_transfer(arg)
        .await
        .expect("Unable to make a call to the $BURN token canister")
        .0
        .expect("Unable to transfer");
}

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

thread_local! {
    static DEV: RefCell<Principal> = RefCell::new(Principal::management_canister());
}

#[init]
fn init_hook() {
    DEV.with_borrow_mut(|s| *s = caller());
}

#[post_upgrade]
fn post_upgrade_hook() {
    DEV.with_borrow_mut(|s| *s = caller());
}

export_candid!();
