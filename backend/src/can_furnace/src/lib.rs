use std::collections::BTreeMap;

use candid::{encode_args, Nat, Principal};
use ic_cdk::{
    api::{
        call::{msg_cycles_accept128, msg_cycles_available128},
        canister_balance128,
        management_canister::main::{
            install_code, start_canister, stop_canister, CanisterIdRecord, CanisterInstallMode,
            InstallCodeArgument,
        },
        time,
    },
    caller, export_candid, id, init, post_upgrade, print, query, update,
};

use ic_e8s::{c::E8s, d::EDs};
use ic_ledger_types::{AccountIdentifier, Subaccount};
use icrc_ledger_types::icrc1::{account::Account, transfer::TransferArg};
use shared::{
    burner::types::TCycles,
    dispenser::{client::DispenserClient, types::DistributionStartCondition},
    furnace::{
        api::{
            AddSupportedTokenRequest, AddSupportedTokenResponse, ClaimRewardICPRequest,
            ClaimRewardICPResponse, CreateDistributionTriggerRequest,
            CreateDistributionTriggerResponse, DeployDispenserRequest, DeployDispenserResponse,
            GetCurRoundPositionsRequest, GetCurRoundPositionsResponse,
            GetDistributionTriggersRequest, GetDistributionTriggersResponse, GetWinnersRequest,
            GetWinnersResponse, PledgeRequest, PledgeResponse, Position,
            RemoveSupportedTokenRequest, RemoveSupportedTokenResponse, VoteTokenXRequest,
            VoteTokenXResponse, WithdrawRequest, WithdrawResponse,
        },
        types::{
            FurnaceInfoPub, TokenX, TokenXVote, FURNACE_DEV_FEE_SUBACCOUNT,
            FURNACE_ICP_PRIZE_DISTRIBUTION_SUBACCOUNT, FURNACE_REDISTRIBUTION_SUBACCOUNT,
        },
    },
    icpswap::ICPSwapTokenInfo,
    icrc1::ICRC1CanisterClient,
    CanisterMode, Guard, ENV_VARS, ICP_FEE,
};
use utils::{
    deploy_dispenser_for, deposit_cycles, is_stopped, process_pledge_triggers,
    set_fetch_token_prices_timer, set_init_canister_one_timer, set_raffle_timer, start_the_raffle,
    IS_STOPPED, NEXT_RAFFLE_TIMESTAMP, STATE,
};

pub mod utils;

#[update]
async fn pledge(mut req: PledgeRequest) -> PledgeResponse {
    panic!("The Bonfire is temporarily stopped. Please, come back later");

    if is_stopped() {
        panic!("The canister is stopped for an upgrade");
    }

    STATE.with_borrow(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request");
    });

    let token_can_id = req.token_can_id;

    let token = ICRC1CanisterClient::new(token_can_id);
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

    let response = STATE.with_borrow_mut(|s| s.pledge(req));

    // TODO: maybe move it to a timer
    process_pledge_triggers(token_can_id);

    response
}

#[update]
async fn withdraw(mut req: WithdrawRequest) -> WithdrawResponse {
    if is_stopped() {
        panic!("The canister is stopped for an upgrade");
    }

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
    panic!("The Bonfire is temporarily stopped. Please, come back later");

    if is_stopped() {
        panic!("The canister is stopped for an upgrade");
    }

    STATE.with_borrow_mut(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request");

        s.vote_token_x(req, caller())
    })
}

#[update]
async fn claim_reward_icp(mut req: ClaimRewardICPRequest) -> ClaimRewardICPResponse {
    if is_stopped() {
        panic!("The canister is stopped for an upgrade");
    }

    let qty = STATE.with_borrow_mut(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request");

        // preventing re-entrancy
        s.claim_reward(req)
    });

    let icp = ICRC1CanisterClient::new(ENV_VARS.icp_token_canister_id);

    let call_result = icp
        .icrc1_transfer(TransferArg {
            from_subaccount: Some(FURNACE_ICP_PRIZE_DISTRIBUTION_SUBACCOUNT),
            to: req.to,
            amount: Nat(qty.val) - Nat::from(ICP_FEE),
            fee: Some(Nat::from(ICP_FEE)),
            created_at_time: None,
            memo: None,
        })
        .await;

    let result = match call_result {
        Ok((Ok(block_idx),)) => Ok(block_idx),
        Ok((Err(e),)) => Err(e.to_string()),
        Err((c, m)) => Err(format!("{:?} {}", c, m)),
    };

    if result.is_err() {
        STATE.with_borrow_mut(|s| s.revert_claim_reward(req));
    }

    ClaimRewardICPResponse { result }
}

#[update]
async fn deploy_dispenser(mut req: DeployDispenserRequest) -> DeployDispenserResponse {
    panic!("The Airdrops are temporarily stopped. Please, come back later");

    if is_stopped() {
        panic!("The canister is stopped for an upgrade");
    }

    let info = STATE.with_borrow(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request");

        s.get_furnace_info()
    });

    if !info.is_dev(&caller()) {
        deposit_cycles(caller(), 9990_0000u64)
            .await
            .expect("Unable to collect the fee")
            .0
            .expect("Unable to collect the fee");
    }

    deploy_dispenser_for(req.token_can_id);

    DeployDispenserResponse {}
}

#[query]
fn list_dispensers() -> Vec<(Principal, Option<Principal>)> {
    STATE.with_borrow(|s| {
        let mut result = Vec::new();

        for entry in s.token_dispensers.iter() {
            result.push(entry);
        }

        result
    })
}

#[query]
fn subaccount_of(pid: Principal) -> Subaccount {
    Subaccount::from(pid)
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
fn get_total_burned_tokens() -> Vec<(Principal, EDs)> {
    STATE.with_borrow(|s| s.total_burned_tokens.iter().collect())
}

#[query]
fn get_total_pledged_tokens() -> Vec<(Principal, EDs)> {
    STATE.with_borrow(|s| s.total_pledged_tokens.iter().collect())
}

#[query]
fn get_my_cur_round_positions() -> (E8s, E8s) {
    STATE.with_borrow(|s| {
        let usd = s
            .cur_round_positions
            .get(&caller())
            .unwrap_or_default()
            .to_decimals(8)
            .to_const();

        let usd_burn = s
            .cur_round_burn_positions
            .get(&caller())
            .unwrap_or_default()
            .to_decimals(8)
            .to_const();

        (usd, usd_burn)
    })
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

        let mut iter = if let Some(skip) = req.skip {
            let mut iter = s.cur_round_positions.range(skip..);
            iter.next();

            iter
        } else {
            s.cur_round_positions.iter()
        };

        let mut positions = Vec::new();

        for _ in 0..req.take {
            let entry = iter.next().map(|(p, e)| (p, e.to_const()));
            if entry.is_none() {
                break;
            }

            let (pid, usd) = entry.unwrap();

            let vp = s
                .cur_round_burn_positions
                .get(&pid)
                .unwrap_or_default()
                .to_decimals(8)
                .to_const::<8>();

            let position = Position { pid, usd, vp };

            positions.push(position);
        }

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
fn update_dispenser_wasm(wasm: Vec<u8>) {
    STATE.with_borrow_mut(|s| {
        let info = s.get_furnace_info();
        if !info.is_dev(&caller()) {
            panic!("Access denied");
        }

        s.set_dispenser_wasm(wasm);
    });
}

#[update]
async fn create_distribution_trigger(
    mut req: CreateDistributionTriggerRequest,
) -> CreateDistributionTriggerResponse {
    panic!("The Airdrops are temporarily stopped. Please, come back later");

    if is_stopped() {
        panic!("The canister is stopped for an upgrade");
    }

    let dispenser_id = STATE.with_borrow(|s| {
        req.validate_and_escape(s, caller(), time())
            .expect("Invalid request");

        s.dispenser_of(&req.trigger.dispenser_token_can_id)
            .unwrap()
            .unwrap()
    });

    let dispenser = DispenserClient(dispenser_id);
    let distribution = dispenser
        .get_distribution(req.trigger.distribution_id)
        .await
        .expect("Unable to fetch distribution")
        .0
        .expect("Distribution not found");

    let info = STATE.with_borrow(|s| s.get_furnace_info());

    if distribution.owner != caller() && !info.is_dev(&caller()) {
        panic!("Access denied");
    }

    if !matches!(
        distribution.start_condition,
        DistributionStartCondition::AtFurnaceTrigger
    ) {
        panic!("The distribution has an invalid start condition");
    }

    STATE.with_borrow_mut(|s| {
        let mut info = s.get_furnace_info();
        let id = info.generate_distribution_trigger_id();
        s.set_furnace_info(info);

        s.distribution_triggers.insert(id, req.trigger);
    });

    CreateDistributionTriggerResponse {}
}

#[query]
fn get_distribution_triggers(
    req: GetDistributionTriggersRequest,
) -> GetDistributionTriggersResponse {
    STATE.with_borrow(|s| {
        let mut iter = if let Some(cursor) = req.start {
            let mut i = s.distribution_triggers.range(cursor..);
            i.next();

            i
        } else {
            s.distribution_triggers.iter()
        };

        let mut triggers = Vec::new();
        let mut i = 0;

        loop {
            let entry = iter.next();
            if entry.is_none() {
                break;
            }

            let (_, trigger) = entry.unwrap();
            triggers.push(trigger);

            i += 1;
            if i == req.take {
                break;
            }
        }

        GetDistributionTriggersResponse { triggers }
    })
}

#[update]
fn start_raffle() {
    if is_stopped() {
        panic!("The canister is stopped for an upgrade");
    }

    let info = STATE.with_borrow(|s| s.get_furnace_info());
    if !info.is_dev(&caller()) {
        panic!("Access denied");
    }

    start_the_raffle();
}

#[update]
async fn upgrade_dispensers() {
    if is_stopped() {
        panic!("The canister is stopped for an upgrade");
    }

    let info = STATE.with_borrow(|s| s.get_furnace_info());
    if !info.is_dev(&caller()) {
        panic!("Access denied");
    }

    let dispensers: Vec<_> = STATE.with_borrow(|s| {
        s.token_dispensers
            .iter()
            .filter_map(|(_, pid_opt)| pid_opt)
            .collect()
    });

    let wasm = STATE.with_borrow(|s| s.dispenser_wasm.get().clone());

    for dispenser_id in dispensers {
        let _ = stop_canister(CanisterIdRecord {
            canister_id: dispenser_id,
        })
        .await;

        let res2 = install_code(InstallCodeArgument {
            mode: CanisterInstallMode::Upgrade(None),
            wasm_module: wasm.clone(),
            canister_id: dispenser_id,
            arg: encode_args(()).unwrap(),
        })
        .await;

        let _ = start_canister(CanisterIdRecord {
            canister_id: dispenser_id,
        })
        .await;

        print(format!(
            "Upgraded dispenser {}. Install - {:?}",
            dispenser_id, res2
        ));
    }
}

#[update]
fn receive_cycles() {
    let avail_cycles = msg_cycles_available128();
    msg_cycles_accept128(avail_cycles);
}

#[query]
fn list_exchange_rates() -> Vec<(Principal, ICPSwapTokenInfo)> {
    STATE.with_borrow(|s| {
        let mut res = Vec::new();

        for (token_can_id, _) in s.supported_tokens.iter() {
            let rate = s.token_exchange_rates.get(&token_can_id).unwrap();

            res.push((token_can_id, rate));
        }

        res
    })
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
        String::from("Dev Fee"),
        (
            AccountIdentifier::new(&id(), &Subaccount(FURNACE_DEV_FEE_SUBACCOUNT)),
            Account {
                owner: id(),
                subaccount: Some(FURNACE_DEV_FEE_SUBACCOUNT),
            },
        ),
    );
    map.insert(
        String::from("Redistribution"),
        (
            AccountIdentifier::new(&id(), &Subaccount(FURNACE_REDISTRIBUTION_SUBACCOUNT)),
            Account {
                owner: id(),
                subaccount: Some(FURNACE_REDISTRIBUTION_SUBACCOUNT),
            },
        ),
    );
    map.insert(
        String::from("ICP Prize Distribution"),
        (
            AccountIdentifier::new(
                &id(),
                &Subaccount(FURNACE_ICP_PRIZE_DISTRIBUTION_SUBACCOUNT),
            ),
            Account {
                owner: id(),
                subaccount: Some(FURNACE_ICP_PRIZE_DISTRIBUTION_SUBACCOUNT),
            },
        ),
    );

    map
}

#[query]
fn next_raffle_timestamp() -> u64 {
    NEXT_RAFFLE_TIMESTAMP.with_borrow(|s| *s)
}

#[update]
fn stop() {
    let is_dev = STATE.with_borrow(|s| s.get_furnace_info().is_dev(&caller()));
    if !is_dev {
        panic!("Access denied");
    }

    IS_STOPPED.with_borrow_mut(|s| *s = true);
}

#[update]
fn resume() {
    let is_dev = STATE.with_borrow(|s| s.get_furnace_info().is_dev(&caller()));
    if !is_dev {
        panic!("Access denied");
    }

    IS_STOPPED.with_borrow_mut(|s| *s = false);
}

#[update]
async fn burn_token(token_can_id: Principal, from_subaccount: Option<[u8; 32]>, qty: Nat) {
    let is_dev = STATE.with_borrow(|s| s.get_furnace_info().is_dev(&caller()));
    if !is_dev {
        panic!("Access denied");
    }

    let token = ICRC1CanisterClient::new(token_can_id);
    token
        .icrc1_furnace_burn(from_subaccount, qty)
        .await
        .expect("Unable to make the burning call")
        .0
        .expect("Unable to burn");
}

#[update]
async fn withdraw_dev_fee(token_can_id: Principal, fee: Nat) {
    let is_dev = STATE.with_borrow(|s| s.get_furnace_info().is_dev(&caller()));
    if !is_dev {
        panic!("Access denied");
    }

    let token = ICRC1CanisterClient::new(token_can_id);
    let balance = token
        .icrc1_balance_of(Account {
            owner: id(),
            subaccount: Some(FURNACE_DEV_FEE_SUBACCOUNT),
        })
        .await
        .expect("Unable to fetch balance")
        .0;

    token
        .icrc1_transfer(TransferArg {
            from_subaccount: Some(FURNACE_DEV_FEE_SUBACCOUNT),
            to: Account {
                owner: caller(),
                subaccount: None,
            },
            amount: balance - fee,
            fee: None,
            created_at_time: None,
            memo: None,
        })
        .await
        .expect("Unable to call token canister")
        .0
        .expect("Unable to transfer");
}

#[init]
fn init_hook() {
    set_init_canister_one_timer(caller());

    STATE.with_borrow_mut(|s| {
        s.add_supported_token(TokenX {
            can_id: ENV_VARS.burn_token_canister_id,
            fee: Nat::from(10_000u64),
            decimals: 8,
        });

        if matches!(ENV_VARS.mode, CanisterMode::IC) {
            s.add_supported_token(TokenX {
                // set DCD as a default supported token
                can_id: Principal::from_text("xsi2v-cyaaa-aaaaq-aabfq-cai").unwrap(),
                fee: Nat::from(10_000u64),
                decimals: 8,
            });
        } else {
            s.add_supported_token(TokenX {
                can_id: ENV_VARS.icp_token_canister_id,
                fee: Nat::from(10_000u64),
                decimals: 8,
            });
        }
    });

    set_fetch_token_prices_timer();
    set_raffle_timer();
}

#[post_upgrade]
fn post_upgrade_hook() {
    set_fetch_token_prices_timer();
    set_raffle_timer();
}

export_candid!();
