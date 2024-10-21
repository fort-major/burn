use candid::{Nat, Principal};
use ic_e8s::{c::E8s, d::EDs};
use ic_stable_structures::{Cell, StableBTreeMap};

use crate::{
    burner::types::{Memory, TimestampNs},
    icpswap::{GetAllTokensResponse, ICPSwapTokenInfo},
    ENV_VARS,
};

use super::{
    api::{
        ClaimRewardICPRequest, PledgeRequest, PledgeResponse, VoteTokenXRequest, VoteTokenXResponse,
    },
    types::{
        FurnaceInfo, FurnaceWinner, FurnaceWinnerHistoryEntry, RaffleRoundInfo, TokenX, TokenXVote,
    },
};

pub struct FurnaceState {
    pub furnace_info: Cell<FurnaceInfo, Memory>,
    pub supported_tokens: StableBTreeMap<Principal, TokenX, Memory>,
    pub token_exchange_rates: StableBTreeMap<Principal, ICPSwapTokenInfo, Memory>,
    pub winners: StableBTreeMap<TimestampNs, FurnaceWinnerHistoryEntry, Memory>,

    pub cur_round_burn_positions: StableBTreeMap<Principal, EDs, Memory>,
    pub cur_round_positions: StableBTreeMap<Principal, EDs, Memory>,
    pub raffle_round_info: Cell<Option<RaffleRoundInfo>, Memory>,

    pub next_token_x_alternatives: StableBTreeMap<Principal, EDs, Memory>,
    pub next_token_x_votes: StableBTreeMap<Principal, TokenXVote, Memory>,

    pub token_dispensers: StableBTreeMap<Principal, Option<Principal>, Memory>,
    pub dispenser_wasm: Cell<Vec<u8>, Memory>,

    pub total_burned_tokens: StableBTreeMap<Principal, EDs, Memory>,
}

impl FurnaceState {
    pub fn init(&mut self, dev_pid: Principal, seed: Vec<u8>, now: TimestampNs) {
        let mut furnace_info = self.get_furnace_info();
        furnace_info.init(dev_pid, seed, now);

        self.set_furnace_info(furnace_info);
    }

    pub fn claim_reward(&mut self, req: ClaimRewardICPRequest) -> E8s {
        let mut entry = self.winners.get(&req.winning_entry_timestamp_ns).unwrap();
        let winner = entry.winners.get_mut(req.winner_idx as usize).unwrap();

        winner.claimed = true;
        let prize = winner.prize_icp.clone();

        self.winners.insert(req.winning_entry_timestamp_ns, entry);

        prize
    }

    pub fn revert_claim_reward(&mut self, req: ClaimRewardICPRequest) {
        let mut entry = self.winners.get(&req.winning_entry_timestamp_ns).unwrap();
        let winner = entry.winners.get_mut(req.winner_idx as usize).unwrap();

        winner.claimed = false;

        self.winners.insert(req.winning_entry_timestamp_ns, entry);
    }

    pub fn note_burned_token(&mut self, token_can_id: Principal, qty: &EDs) {
        let prev = self
            .total_burned_tokens
            .get(&token_can_id)
            .unwrap_or_default();
        self.total_burned_tokens.insert(token_can_id, prev + qty);
    }

    pub fn set_dispenser_wasm(&mut self, wasm: Vec<u8>) {
        self.dispenser_wasm
            .set(wasm)
            .expect("Unable to store dispenser wasm");
    }

    pub fn get_dispenser_wasm(&self) -> &[u8] {
        self.dispenser_wasm.get()
    }

    pub fn get_supported_token(&self, token_can_id: &Principal) -> Option<TokenX> {
        self.supported_tokens.get(token_can_id)
    }

    pub fn add_supported_token(&mut self, token: TokenX) {
        self.supported_tokens.insert(token.can_id, token);
    }

    pub fn remove_supported_token(&mut self, token_can_id: &Principal) {
        self.supported_tokens.remove(token_can_id);
    }

    pub fn list_supported_tokens(&self) -> Vec<TokenX> {
        self.supported_tokens.iter().map(|(_, it)| it).collect()
    }

    pub fn get_vote_token_x_of(&self, caller: &Principal) -> Option<TokenXVote> {
        self.next_token_x_votes.get(caller)
    }

    pub fn list_token_x_alternatives(&self) -> Vec<(Principal, E8s)> {
        self.next_token_x_alternatives
            .iter()
            .map(|(p, e)| (p, e.to_const::<8>()))
            .collect()
    }

    pub fn dispenser_of(&self, token_can_id: &Principal) -> Option<Option<Principal>> {
        return self.token_dispensers.get(token_can_id);
    }

    /// return true, if marked successfully, return false if already exists
    pub fn mark_dispenser_deploying(&mut self, token_can_id: Principal) -> bool {
        if self.dispenser_of(&token_can_id).is_none() {
            self.token_dispensers.insert(token_can_id, None);
            true
        } else {
            false
        }
    }

    pub fn add_dispenser(&mut self, token_can_id: Principal, dispenser_can_id: Principal) {
        self.token_dispensers
            .insert(token_can_id, Some(dispenser_can_id));
    }

    pub fn vote_token_x(
        &mut self,
        req: VoteTokenXRequest,
        caller: Principal,
    ) -> VoteTokenXResponse {
        let voting_power = self
            .cur_round_burn_positions
            .get(&caller)
            .unwrap()
            .to_const::<8>();

        for (token_can_id, weight) in &req.vote.can_ids_and_normalized_weights {
            let prev_votes = self
                .next_token_x_alternatives
                .get(token_can_id)
                .unwrap_or_default()
                .to_const::<8>();

            let add_votes = &voting_power * weight;

            self.next_token_x_alternatives
                .insert(*token_can_id, (prev_votes + add_votes).to_dynamic());
        }

        self.next_token_x_votes.insert(caller, req.vote);

        VoteTokenXResponse {}
    }

    // not batching this method, because the number of possible tokens is very limited
    pub fn select_next_token_x(&mut self) -> Principal {
        let mut info = self.get_furnace_info();

        // if no token was elected - fallback to BURN
        if self.next_token_x_alternatives.is_empty() {
            info.update_token_x(TokenX {
                can_id: ENV_VARS.burn_token_canister_id,
                fee: Nat::from(10_000u64),
                decimals: 8,
            });
            self.set_furnace_info(info);

            return ENV_VARS.burn_token_canister_id;
        }

        let random_num = info.generate_random_numbers(1).remove(0);

        let mut total_votes = E8s::zero();
        let mut iter = self.next_token_x_alternatives.iter();

        loop {
            let entry = iter.next();

            if let Some((_, votes)) = entry {
                total_votes += votes.to_const();
            } else {
                break;
            }
        }

        let mut to = E8s::zero();
        iter = self.next_token_x_alternatives.iter();

        let result = loop {
            let entry = iter.next().map(|(p, e)| (p, e.to_const()));

            if let Some((token_x_can_id, votes)) = entry {
                to += votes / &total_votes;

                if to >= random_num {
                    break token_x_can_id;
                }
            } else {
                panic!("Should find the winner");
            }
        };

        let token_x = self
            .get_supported_token(&result)
            .expect("Only supported tokens can be elected");

        info.update_token_x(token_x);

        self.set_furnace_info(info);

        result
    }

    pub fn complete_token_x_voting(&mut self, token_x: TokenX) {
        let mut info = self.get_furnace_info();
        info.cur_token_x = token_x;

        self.next_token_x_alternatives.clear_new();
        self.next_token_x_votes.clear_new();

        self.set_furnace_info(info);
    }

    pub fn update_token_exchange_rates(&mut self, icp_swap_response: GetAllTokensResponse) {
        self.token_exchange_rates.clear_new();

        for token in icp_swap_response {
            self.token_exchange_rates.insert(token.can_id, token);
        }
    }

    pub fn pledge(&mut self, req: PledgeRequest) -> PledgeResponse {
        let mut info = self.get_furnace_info();

        let usd_value = if req.token_can_id == info.cur_token_x.can_id {
            self.get_usd_value(&req.token_can_id, req.qty, info.cur_token_x.decimals)
        } else {
            let usd_value = self.get_usd_value(&ENV_VARS.burn_token_canister_id, req.qty, 8)
                * E8s::from(9500_0000u64);

            info.note_pledged_burn_usd(&usd_value);

            let prev_burn_usd_value = self
                .cur_round_burn_positions
                .get(&req.pid)
                .unwrap_or_default()
                .to_decimals(8)
                .to_const();

            self.cur_round_burn_positions
                .insert(req.pid, (prev_burn_usd_value + &usd_value).to_dynamic());

            usd_value
        };

        info.note_pledged_usd(&usd_value);

        let prev_usd_value = self
            .cur_round_positions
            .get(&req.pid)
            .unwrap_or_default()
            .to_decimals(8)
            .to_const();

        let new_usd_value = if req.downvote {
            if prev_usd_value < usd_value {
                E8s::zero()
            } else {
                prev_usd_value - &usd_value
            }
        } else {
            prev_usd_value + &usd_value
        };

        self.cur_round_positions
            .insert(req.pid, new_usd_value.to_dynamic());

        self.set_furnace_info(info);

        PledgeResponse {
            pledge_value_usd: usd_value,
        }
    }

    pub fn set_looking_for_winners(&mut self, value: bool) {
        let mut furnace_info = self.get_furnace_info();
        furnace_info.is_looking_for_winners = value;
        self.set_furnace_info(furnace_info);
    }

    pub fn prepare_raffle(&mut self, cur_prize_fund_icp: E8s) {
        let mut furnace_info = self.get_furnace_info();

        let prize_distribution = furnace_info.calculate_prize_distribution(&cur_prize_fund_icp);
        let random_numbers = furnace_info.generate_random_numbers(prize_distribution.len());

        let raffle_round_info = RaffleRoundInfo {
            prize_fund_icp: cur_prize_fund_icp,
            prize_distribution,
            random_numbers,
            winners: Vec::new(),
            winner_selection_cursor: None,
            elimination_cursor: None,
            from: E8s::zero(),
        };

        self.set_furnace_info(furnace_info);
        self.set_raffle_round_info(raffle_round_info);
    }

    pub fn complete_raffle(&mut self, now: TimestampNs) {
        let raffle_round_info = self.get_raffle_round_info();
        let mut furnace_info = self.get_furnace_info();

        let mut result = Vec::new();
        for (pid, prize_icp) in raffle_round_info.winners {
            let entry = FurnaceWinner {
                prize_icp,
                pid,
                claimed: false,
            };

            result.push(entry);
        }

        let winner_history_entry = FurnaceWinnerHistoryEntry {
            timestamp: now,
            token_can_id: furnace_info.cur_token_x.can_id,
            pledged_usd: furnace_info.cur_round_pledged_usd.clone(),
            round: furnace_info.current_round,
            prize_fund_icp: raffle_round_info.prize_fund_icp.clone(),
            winners: result,
        };

        self.winners.insert(now, winner_history_entry);

        self.clear_raffle_round_info();
        self.cur_round_positions.clear_new();

        furnace_info.complete_round(now);
        furnace_info.icp_won_total += raffle_round_info.prize_fund_icp;

        self.set_furnace_info(furnace_info);
    }

    /// returns true if should be rescheduled immediately, false if all winners found
    pub fn find_winners_batch(&mut self, batch_size: usize) -> bool {
        if self.cur_round_positions.is_empty() {
            return false;
        }

        let mut raffle_round_info = self.get_raffle_round_info();
        let furnace_info = self.get_furnace_info();

        let mut iter = if let Some(cursor) = raffle_round_info.winner_selection_cursor {
            let mut i = self.cur_round_positions.range(cursor..);
            i.next();

            i
        } else {
            self.cur_round_positions.iter()
        };

        let mut to = raffle_round_info.from.clone();
        let mut i = 0;

        loop {
            let entry_opt = iter.next();
            if entry_opt.is_none() {
                iter = self.cur_round_positions.iter();
                raffle_round_info.winner_selection_cursor = None;
                continue;
            }

            let (position_id, votes) = entry_opt.map(|(p, e)| (p, e.to_const())).unwrap();
            to += &votes / &furnace_info.cur_round_pledged_usd;

            raffle_round_info.match_winner(&to, position_id);
            raffle_round_info.from = to.clone();
            raffle_round_info.winner_selection_cursor = Some(position_id);

            i += 1;

            if i >= batch_size || raffle_round_info.round_is_over() {
                break;
            }
        }

        let is_over = raffle_round_info.round_is_over();

        self.set_raffle_round_info(raffle_round_info);

        !is_over
    }

    pub fn get_usd_value(&self, can_id: &Principal, qty: Nat, decimals: u8) -> E8s {
        let qty_e8s = EDs::new(qty.0, decimals).to_decimals(8).to_const();
        let exchange_rate = self
            .token_exchange_rates
            .get(can_id)
            .expect("The token is not supported")
            .exchange_rate_usd;

        qty_e8s * exchange_rate
    }

    pub fn get_furnace_info(&self) -> FurnaceInfo {
        self.furnace_info.get().clone()
    }

    pub fn get_furnace_info_ref(&self) -> &FurnaceInfo {
        self.furnace_info.get()
    }

    pub fn set_furnace_info(&mut self, info: FurnaceInfo) {
        self.furnace_info.set(info).expect("Unable to store info");
    }

    pub fn get_raffle_round_info(&self) -> RaffleRoundInfo {
        self.raffle_round_info.get().clone().unwrap()
    }

    fn set_raffle_round_info(&mut self, info: RaffleRoundInfo) {
        self.raffle_round_info
            .set(Some(info))
            .expect("Unable to store info");
    }

    fn clear_raffle_round_info(&mut self) {
        self.raffle_round_info
            .set(None)
            .expect("Unable to store info");
    }
}
