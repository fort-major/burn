use candid::Principal;
use ic_cdk::{
    api::{
        call::{msg_cycles_accept128, msg_cycles_available128},
        canister_balance128, time,
    },
    export_candid, init, post_upgrade, query, update,
};
use shared::burner::types::TCycles;
use utils::{
    fetch_last_swapped_volume, generate_random_f64, get_block_winner, set_mining_interval,
};

pub mod utils;

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

#[update]
async fn emulate() -> (Vec<(Principal, f64)>, f64, f64, Principal) {
    let (volumes, total) = fetch_last_swapped_volume(1000, time()).await;
    if total == 0f64 {
        unreachable!("No transaction fitting the criteria found, skipping");
    }

    let random_num = generate_random_f64().await;

    let winner = get_block_winner(&volumes, total, random_num);

    (volumes, total, random_num, winner)
}

#[init]
fn init_hook() {
    set_mining_interval();
}

#[post_upgrade]
fn post_upgrade_hook() {
    //set_mining_interval();
}

export_candid!();
