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
    types::{
        FurnaceInfo, FurnacePosition, FurnaceWinner, FurnaceWinnerHistoryEntry, PositionId,
        RaffleRoundInfo,
    },
};

pub struct FurnaceState {
    pub cur_round_entries: StableBTreeMap<PositionId, E8s, Memory>,
    pub winners: StableBTreeMap<TimestampNs, FurnaceWinnerHistoryEntry, Memory>,
    pub positions: StableBTreeMap<PositionId, FurnacePosition, Memory>,
    pub furnace_info: Cell<FurnaceInfo, Memory>,
    pub raffle_round_info: Cell<Option<RaffleRoundInfo>, Memory>,
}

impl FurnaceState {
    pub fn init(&mut self, seed: Vec<u8>, now: TimestampNs) {
        let mut furnace_info = self.get_furnace_info();
        furnace_info.init(seed, now);

        self.set_furnace_info(furnace_info);
    }

    /// Precondition: tokens already burned, request validated
    pub fn create_position(
        &mut self,
        req: CreatePositionRequest,
        caller: Principal,
    ) -> CreatePositionResponse {
        let mut info = self.get_furnace_info();
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

        self.set_furnace_info(info);

        CreatePositionResponse { position_id: id }
    }

    // TODO: update position

    /// Precondition: tokens already burned, request validated
    pub fn affect_position(&mut self, req: AffectPositionRequest) -> AffectPositionResponse {
        let mut info = self.get_furnace_info();

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

        self.set_furnace_info(info);

        AffectPositionResponse {
            new_position_value_usd: new_usd_value,
        }
    }

    pub fn prepare_raffle(&mut self, cur_prize_fund_icp: E8s) {
        let mut furnace_info = self.get_furnace_info();

        furnace_info.is_looking_for_winners = true;

        let prize_distribution = furnace_info.calculate_prize_distribution(cur_prize_fund_icp);
        let random_numbers = furnace_info.generate_random_numbers(prize_distribution.len());

        let raffle_round_info = RaffleRoundInfo {
            prize_distribution,
            random_numbers,
            winners: Vec::new(),
            cursor: None,
            from: E8s::zero(),
        };

        self.set_furnace_info(furnace_info);
        self.set_raffle_round_info(raffle_round_info);
    }

    pub fn complete_raffle(
        &mut self,
        cur_prize_fund_icp: E8s,
        now: TimestampNs,
    ) -> FurnaceWinnerHistoryEntry {
        let raffle_round_info = self.get_raffle_round_info();
        let mut furnace_info = self.get_furnace_info();

        let mut result = Vec::new();
        for (position_id, prize_icp) in raffle_round_info.winners {
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
            round: furnace_info.current_round,
            jackpot: cur_prize_fund_icp.clone(),
            winners: result,
        };

        self.winners.insert(now, winner_history_entry.clone());

        self.cur_round_entries.clear_new();
        self.positions.clear_new();
        self.clear_raffle_round_info();

        furnace_info.complete_round(now);
        furnace_info.is_looking_for_winners = false;
        furnace_info.icp_won_total += cur_prize_fund_icp;

        self.set_furnace_info(furnace_info);

        winner_history_entry
    }

    /// returns Ok(true) if should be rescheduled immediately, Ok(false) if all winners found, Err(()) if the pool is empty
    pub fn find_winners_batch(&mut self, batch_size: usize) -> Result<bool, ()> {
        if self.cur_round_entries.is_empty() {
            return Err(());
        }

        let mut raffle_round_info = self.get_raffle_round_info();
        let furnace_info = self.get_furnace_info();

        let mut iter = if let Some(cursor) = raffle_round_info.cursor {
            let mut i = self.cur_round_entries.range(cursor..);
            i.next();

            i
        } else {
            self.cur_round_entries.iter()
        };

        let mut to = raffle_round_info.from.clone();
        let mut i = 0;

        loop {
            let entry_opt = iter.next();
            if entry_opt.is_none() {
                iter = self.cur_round_entries.iter();
                raffle_round_info.cursor = None;
                continue;
            }

            let (position_id, votes) = entry_opt.unwrap();
            to += &votes / &furnace_info.usd_burnt_cur_round;

            raffle_round_info.match_winner(&to, position_id, votes);
            raffle_round_info.from = to.clone();
            raffle_round_info.cursor = Some(position_id);

            i += 1;

            if i >= batch_size || raffle_round_info.round_is_over() {
                break;
            }
        }

        let is_over = raffle_round_info.round_is_over();

        self.set_raffle_round_info(raffle_round_info);

        Ok(!is_over)
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
