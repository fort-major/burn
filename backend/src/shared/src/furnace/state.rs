use std::collections::BTreeMap;

use candid::Principal;
use ic_e8s::c::E8s;
use ic_stable_structures::{Cell, StableBTreeMap};

use crate::burner::types::{Memory, TimestampNs};

use super::{
    api::{
        AffectPositionRequest, AffectPositionResponse, CreatePositionRequest,
        CreatePositionResponse,
    },
    types::{FurnaceInfo, FurnacePosition, FurnaceWinner, FurnaceWinnerHistoryEntry, PositionId},
};

pub struct FurnaceState {
    pub cur_round_entries: StableBTreeMap<PositionId, E8s, Memory>,
    pub winners: StableBTreeMap<TimestampNs, FurnaceWinnerHistoryEntry, Memory>,
    pub positions: StableBTreeMap<PositionId, FurnacePosition, Memory>,
    pub info: Cell<FurnaceInfo, Memory>,
}

impl FurnaceState {
    /// Precondition: tokens already burned, request validated
    pub fn create_position(
        &mut self,
        req: CreatePositionRequest,
        caller: Principal,
    ) -> CreatePositionResponse {
        let mut info = self.get_info();
        let id = info.generate_position_id();

        let position = FurnacePosition {
            id,
            owner_pid: caller,
            participant_pid: req.pid,
            title: req.title,
            link: req.link,
        };

        self.positions.insert(id, position);

        let usd_value = info.note_burned_tokens(&req.token_can_id, req.qty);

        self.cur_round_entries.insert(id, usd_value);

        self.set_info(info);

        CreatePositionResponse { position_id: id }
    }

    // TODO: update position

    /// Precondition: tokens already burned, request validated
    pub fn affect_position(&mut self, req: AffectPositionRequest) -> AffectPositionResponse {
        let mut info = self.get_info();

        let usd_value = info.note_burned_tokens(&req.token_can_id, req.qty);

        let prev_usd_value = self
            .cur_round_entries
            .get(&req.position_id)
            .unwrap_or_default();

        let new_usd_value = if req.downvote {
            if prev_usd_value < usd_value {
                E8s::zero()
            } else {
                prev_usd_value - usd_value
            }
        } else {
            prev_usd_value + usd_value
        };

        self.cur_round_entries
            .insert(req.position_id, new_usd_value.clone());

        self.set_info(info);

        AffectPositionResponse {
            new_position_value_usd: new_usd_value,
        }
    }

    // TODO: don't forget to stop/restart
    pub fn raffle_round(
        &mut self,
        cur_prize_fund_icp: E8s,
        now: TimestampNs,
    ) -> Option<FurnaceWinnerHistoryEntry> {
        let mut info = self.get_info();

        let prize_distribution = info.calculate_prize_distribution(cur_prize_fund_icp.clone());
        let random_numbers = info.generate_random_numbers(prize_distribution.len());

        let winners_opt = self.find_winners(info.usd_burnt_cur_round.clone(), random_numbers);
        if winners_opt.is_none() {
            return None;
        }

        let mut winners = winners_opt.unwrap();
        winners.sort_by(|(_, votes_a), (_, votes_b)| votes_a.cmp(votes_b));

        let mut result = Vec::new();
        for (position_id, prize_icp) in winners {
            let position = self
                .positions
                .get(&position_id)
                .expect("Position not found");

            let entry = FurnaceWinner {
                prize_icp,
                position,
            };

            result.push(entry);
        }

        let winner_history_entry = FurnaceWinnerHistoryEntry {
            timestamp: now,
            round: info.current_round,
            jackpot: cur_prize_fund_icp,
            winners: result,
        };

        self.winners.insert(now, winner_history_entry.clone());
        self.cur_round_entries.clear_new();
        self.positions.clear_new();

        Some(winner_history_entry)
    }

    fn find_winners(
        &mut self,
        total_burned_usd: E8s,
        mut random_numbers: Vec<E8s>,
    ) -> Option<Vec<(PositionId, E8s)>> {
        if self.cur_round_entries.is_empty() {
            return None;
        }

        let mut iter = self.cur_round_entries.iter();
        let mut from = E8s::zero();
        let mut to = E8s::zero();
        let mut result = Vec::new();

        loop {
            let entry_opt = iter.next();
            if entry_opt.is_none() {
                break;
            }

            let (position_id, votes) = entry_opt.unwrap();
            to += &votes / &total_burned_usd;

            let mut found = false;
            for i in 0..random_numbers.len() {
                {
                    let rng = random_numbers.get(i).unwrap();

                    if rng >= &from && rng <= &to {
                        result.push((position_id, votes.clone()));
                        found = true;
                    }
                }

                if found {
                    random_numbers.remove(i);
                    break;
                }
            }

            from = to.clone();
        }

        debug_assert!(random_numbers.is_empty());

        Some(result)
    }

    pub fn get_info(&self) -> FurnaceInfo {
        self.info.get().clone()
    }

    pub fn get_info_ref(&self) -> &FurnaceInfo {
        self.info.get()
    }

    fn set_info(&mut self, info: FurnaceInfo) {
        self.info.set(info).expect("Unable to store info");
    }
}
