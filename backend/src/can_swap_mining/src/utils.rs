use std::{
    collections::{hash_map::Entry, HashMap},
    time::Duration,
};

use candid::{Nat, Principal};
use ic_cdk::{
    api::{management_canister::main::raw_rand, time},
    print, spawn,
};
use ic_cdk_timers::set_timer_interval;
use ic_e8s::c::E8s;
use shared::{
    burner::{client::BurnerClient, types::TimestampNs},
    trading::types::PriceInfo,
    ENV_VARS, ONE_DAY_NS, ONE_HOUR_NS,
};

pub const BURN_PER_HOUR_E8S: u64 = 30_0000_0000;
pub const ROUNDS_PER_HOUR: u64 = 2; // once every 30 minutes

pub fn set_mining_interval() {
    set_timer_interval(
        Duration::from_nanos(ONE_HOUR_NS / ROUNDS_PER_HOUR),
        spawn_mining_round,
    );
}

pub fn spawn_mining_round() {
    spawn(run_mining_round());
}

pub async fn run_mining_round() {
    let (volumes, total) = fetch_last_swapped_volume(1000, time()).await;
    if total == 0f64 {
        print("No transaction fitting the criteria found, skipping");
        return;
    }

    let random_num = generate_random_f64().await;

    let winner = get_block_winner(&volumes, total, random_num);

    mint_burn(winner, Nat::from(BURN_PER_HOUR_E8S / ROUNDS_PER_HOUR)).await;
}

pub async fn generate_random_f64() -> f64 {
    let seed = raw_rand().await.expect("Unable to fetch rand").0;
    let mut n_buf = [0u8; 32];
    n_buf.copy_from_slice(&seed);

    let (r1, _, _, _) = PriceInfo::create_random_nums(n_buf);

    r1
}

pub async fn fetch_last_swapped_volume(n: u64, now: TimestampNs) -> (Vec<(Principal, f64)>, f64) {
    let index = shared::icpswap_base_index::Service(
        Principal::from_text("g54jq-hiaaa-aaaag-qck5q-cai").unwrap(),
    );

    let last_storage = index
        .base_last_storage()
        .await
        .expect("Unable to fetch last base storage")
        .0;

    let storage =
        shared::icpswap_base_storage::Service(Principal::from_text(last_storage).unwrap());

    let txns = storage
        .get_by_pool(
            Nat::from(0u64),
            Nat::from(n),
            String::from("pfaxf-iiaaa-aaaag-qkiia-cai"),
        )
        .await
        .expect("Unable to fetch transactions")
        .0;

    let mut volumes = HashMap::<Principal, f64>::new();
    let mut total = 0f64;

    for txn in txns.content {
        if !matches!(
            txn.action,
            shared::icpswap_base_storage::TransactionType::Swap
        ) {
            continue;
        }

        let ts: u64 = txn.timestamp.0.try_into().unwrap();
        let ts_ns = ts * 1_000_000_000u64;

        if ts_ns < now && now - ts_ns > ONE_DAY_NS {
            continue;
        }

        let sender = Principal::from_text(txn.sender).unwrap();

        match volumes.entry(sender) {
            Entry::Occupied(mut e) => {
                *e.get_mut() += txn.amountUSD;
                total += txn.amountUSD;
            }
            Entry::Vacant(e) => {
                e.insert(txn.amountUSD);
                total += txn.amountUSD;
            }
        }
    }

    (volumes.into_iter().collect(), total)
}

pub fn get_block_winner(
    volumes: &Vec<(Principal, f64)>,
    total: f64,
    random_num_normalized: f64,
) -> Principal {
    let mut counter = 0f64;

    for (pid, volume) in volumes {
        counter += volume / total;

        if counter > random_num_normalized {
            return *pid;
        }
    }

    unreachable!("Counter reached the end");
}

pub async fn mint_burn(winner: Principal, qty: Nat) {
    let burner = BurnerClient(ENV_VARS.burner_canister_id);
    burner
        .mint(winner, E8s::new(qty.0))
        .await
        .expect("Unable to mint");
}
