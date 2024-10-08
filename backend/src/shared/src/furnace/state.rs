use std::cmp::min;

use candid::{Nat, Principal};
use ic_e8s::{c::E8s, d::EDs};
use ic_stable_structures::{Cell, StableBTreeMap};

use crate::{
    burner::types::{Memory, TimestampNs},
    icpswap::{GetAllTokensResponse, ICPSwapTokenInfo},
    ENV_VARS,
};

use super::{
    api::{PledgeRequest, PledgeResponse, VoteTokenXRequest, VoteTokenXResponse},
    types::{
        FurnaceInfo, FurnaceWinner, FurnaceWinnerHistoryEntry, RaffleRoundInfo, TokenX, TokenXVote,
    },
};

pub struct FurnaceState {
    pub furnace_info: Cell<FurnaceInfo, Memory>,
    pub supported_tokens: StableBTreeMap<Principal, ICPSwapTokenInfo, Memory>,
    pub winners: StableBTreeMap<TimestampNs, FurnaceWinnerHistoryEntry, Memory>,

    pub cur_round_burned_burn: StableBTreeMap<Principal, E8s, Memory>,
    pub cur_round_positions: StableBTreeMap<Principal, E8s, Memory>,
    pub raffle_round_info: Cell<Option<RaffleRoundInfo>, Memory>,

    pub next_token_x_alternatives: StableBTreeMap<Principal, E8s, Memory>,
    pub next_token_x_votes: StableBTreeMap<Principal, TokenXVote, Memory>,

    pub token_dispensers: StableBTreeMap<Principal, Principal, Memory>,
}

impl FurnaceState {
    pub fn init(&mut self, seed: Vec<u8>, now: TimestampNs) {
        let mut furnace_info = self.get_furnace_info();
        furnace_info.init(seed, now);

        self.set_furnace_info(furnace_info);
    }

    pub fn dispenser_exists(&self, token_can_id: &Principal) -> Option<Principal> {
        return self.token_dispensers.get(token_can_id);
    }

    pub fn add_dispenser(&mut self, token_can_id: Principal, dispenser_can_id: Principal) {
        self.token_dispensers.insert(token_can_id, dispenser_can_id);
    }

    pub fn vote_token_x(
        &mut self,
        req: VoteTokenXRequest,
        caller: Principal,
    ) -> VoteTokenXResponse {
        let voting_power = self.cur_round_positions.get(&caller).unwrap();

        for (token_can_id, weight) in &req.vote.can_ids_and_normalized_weights {
            let prev_votes = self
                .next_token_x_alternatives
                .get(token_can_id)
                .unwrap_or_default();
            let add_votes = &voting_power * weight;

            self.next_token_x_alternatives
                .insert(*token_can_id, prev_votes + add_votes);
        }

        self.next_token_x_votes.insert(caller, req.vote);

        VoteTokenXResponse {}
    }

    // not batching this method, because the number of possible tokens is limited by ICPSwap
    pub fn select_next_token_x(&mut self) -> Principal {
        if self.next_token_x_alternatives.is_empty() {
            return ENV_VARS.burn_token_canister_id;
        }

        let mut info = self.get_furnace_info();
        let random_num = info.generate_random_numbers(1).remove(0);

        let mut total_votes = E8s::zero();
        let mut iter = self.next_token_x_alternatives.iter();

        loop {
            let entry = iter.next();

            if let Some((_, votes)) = entry {
                total_votes += votes;
            } else {
                break;
            }
        }

        let mut to = E8s::zero();
        iter = self.next_token_x_alternatives.iter();

        let result = loop {
            let entry = iter.next();

            if let Some((token_x_can_id, votes)) = entry {
                to += votes / &total_votes;

                if to >= random_num {
                    break token_x_can_id;
                }
            } else {
                panic!("Should find the winner");
            }
        };

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

    pub fn update_supported_tokens(&mut self, icp_swap_response: GetAllTokensResponse) {
        self.supported_tokens.clear_new();

        for token in icp_swap_response {
            self.supported_tokens.insert(token.can_id, token);
        }
    }

    pub fn pledge(&mut self, req: PledgeRequest) -> PledgeResponse {
        let mut info = self.get_furnace_info();

        let decimals = info.get_decimals(&req.token_can_id).unwrap();

        let usd_value = info.burn_token_discount(
            &req.token_can_id,
            self.get_usd_value(&req.token_can_id, req.qty, decimals),
        );
        info.note_pledged_usd(usd_value.clone());

        let prev_usd_value = self.cur_round_positions.get(&req.pid).unwrap_or_default();

        let new_usd_value = if req.downvote {
            if prev_usd_value < usd_value {
                E8s::zero()
            } else {
                prev_usd_value - usd_value
            }
        } else {
            prev_usd_value + usd_value
        };

        self.cur_round_positions
            .insert(req.pid, new_usd_value.clone());

        self.set_furnace_info(info);

        PledgeResponse {
            pledge_value_usd: new_usd_value,
        }
    }

    pub fn prepare_raffle(&mut self, cur_prize_fund_icp: E8s) {
        let mut furnace_info = self.get_furnace_info();

        furnace_info.is_looking_for_winners = true;

        let prize_distribution = furnace_info.calculate_prize_distribution(&cur_prize_fund_icp);
        let random_numbers = furnace_info.generate_random_numbers(prize_distribution.len());

        let raffle_round_info = RaffleRoundInfo {
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

    // TODO: make the voting power only count pledged BURN, otherwise it is not safe

    /// returns true if should reschedule
    pub fn eliminate_cur_positions_batch(&mut self, batch_size: usize) -> bool {
        // don't eliminate the last one
        if self.cur_round_positions.len() <= 1 {
            return false;
        }

        let mut furnace_info = self.get_furnace_info();
        let mut raffle_round_info = self.get_raffle_round_info();

        let heads = furnace_info
            .generate_random_bools(min(batch_size, self.cur_round_positions.len() as usize));

        let mut iter = if let Some(cursor) = raffle_round_info.elimination_cursor {
            let mut i = self.cur_round_positions.range(cursor..);
            i.next();

            i
        } else {
            self.cur_round_positions.iter()
        };
        let mut i = 0;

        let mut positions_to_eliminate = Vec::new();
        let mut should_reschedule = true;

        loop {
            let entry = iter.next();

            if let Some((pid, _)) = entry {
                if heads[i] {
                    positions_to_eliminate.push(pid);
                } else {
                    raffle_round_info.elimination_cursor = Some(pid);
                }
            } else {
                should_reschedule = false;
                break;
            }

            i += 1;

            if i == heads.len() {
                break;
            }
        }

        for pid in positions_to_eliminate {
            self.cur_round_positions.remove(&pid);
        }

        self.set_furnace_info(furnace_info);
        self.set_raffle_round_info(raffle_round_info);

        should_reschedule
    }

    pub fn complete_raffle(
        &mut self,
        cur_prize_fund_icp: E8s,
        now: TimestampNs,
    ) -> FurnaceWinnerHistoryEntry {
        let raffle_round_info = self.get_raffle_round_info();
        let mut furnace_info = self.get_furnace_info();

        let mut result = Vec::new();
        for (pid, prize_icp) in raffle_round_info.winners {
            let entry = FurnaceWinner { prize_icp, pid };

            result.push(entry);
        }

        let winner_history_entry = FurnaceWinnerHistoryEntry {
            timestamp: now,
            token_can_id: furnace_info.cur_token_x.can_id,
            pledged_usd: furnace_info.cur_round_pledged_usd.clone(),
            round: furnace_info.current_round,
            prize_fund_icp: cur_prize_fund_icp.clone(),
            winners: result,
        };

        self.winners.insert(now, winner_history_entry.clone());

        self.clear_raffle_round_info();

        furnace_info.complete_round(now);
        furnace_info.is_looking_for_winners = false;
        furnace_info.icp_won_total += cur_prize_fund_icp;

        self.set_furnace_info(furnace_info);

        winner_history_entry
    }

    /// returns Ok(true) if should be rescheduled immediately, Ok(false) if all winners found, Err(()) if the pool is empty
    pub fn find_winners_batch(&mut self, batch_size: usize) -> Result<bool, ()> {
        if self.cur_round_positions.is_empty() {
            return Err(());
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

            let (position_id, votes) = entry_opt.unwrap();
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

        Ok(!is_over)
    }

    pub fn get_usd_value(&self, can_id: &Principal, qty: Nat, decimals: u8) -> E8s {
        let qty_e8s = EDs::new(qty.0, decimals).to_decimals(8).to_const();
        let exchange_rate = self
            .supported_tokens
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

    fn set_furnace_info(&mut self, info: FurnaceInfo) {
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
