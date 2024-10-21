use candid::{CandidType, Nat, Principal};
use garde::Validate;
use ic_e8s::c::E8s;
use icrc_ledger_types::icrc1::account::Account;
use serde::Deserialize;

use crate::{burner::types::TimestampNs, Guard};

use super::{
    state::FurnaceState,
    types::{FurnaceWinnerHistoryEntry, TokenX, TokenXVote, MIN_ALLOWED_USD_POSITION_QTY_E8S},
};

#[derive(CandidType, Deserialize, Validate)]
pub struct PledgeRequest {
    #[garde(skip)]
    pub pid: Principal,
    #[garde(skip)]
    pub token_can_id: Principal,
    #[garde(skip)]
    pub qty: Nat,
    #[garde(skip)]
    pub downvote: bool,
}

impl Guard<FurnaceState> for PledgeRequest {
    fn validate_and_escape(
        &mut self,
        state: &FurnaceState,
        _caller: Principal,
        _now: TimestampNs,
    ) -> Result<(), String> {
        self.validate(&()).map_err(|e| e.to_string())?;

        let info = state.get_furnace_info_ref();

        if info.is_looking_for_winners || info.is_on_maintenance {
            return Err(String::from("Unable to pledge right now, try again later"));
        }

        let decimals_opt = info.get_decimals(&self.token_can_id);

        if decimals_opt.is_none() {
            return Err(String::from("Pledging this token is not allowed right now"));
        }

        let usd_value =
            state.get_usd_value(&self.token_can_id, self.qty.clone(), decimals_opt.unwrap());

        let min_usd_value = E8s::from(MIN_ALLOWED_USD_POSITION_QTY_E8S);
        if usd_value < min_usd_value {
            return Err(String::from("Too few burned tokens"));
        }

        Ok(())
    }
}

#[derive(CandidType, Deserialize)]
pub struct PledgeResponse {
    pub pledge_value_usd: E8s,
}

#[derive(CandidType, Deserialize)]
pub struct WithdrawRequest {
    pub token_can_id: Principal,
    pub to: Account,
    pub qty: Nat,
}

impl Guard<FurnaceState> for WithdrawRequest {
    fn validate_and_escape(
        &mut self,
        state: &FurnaceState,
        _caller: Principal,
        _now: TimestampNs,
    ) -> Result<(), String> {
        let token_info = state
            .get_supported_token(&self.token_can_id)
            .ok_or(String::from("Unsupported token"))?;

        if self.qty < token_info.fee {
            return Err(String::from("Insufficient amount"));
        }

        Ok(())
    }
}

#[derive(CandidType, Deserialize)]
pub struct WithdrawResponse {
    pub block_idx: Nat,
}

#[derive(CandidType, Deserialize, Validate)]
pub struct VoteTokenXRequest {
    #[garde(skip)]
    pub vote: TokenXVote,
}

impl Guard<FurnaceState> for VoteTokenXRequest {
    fn validate_and_escape(
        &mut self,
        state: &FurnaceState,
        caller: Principal,
        _now: TimestampNs,
    ) -> Result<(), String> {
        self.validate(&()).map_err(|e| e.to_string())?;

        let info = state.get_furnace_info();

        if info.is_looking_for_winners || info.is_on_maintenance {
            return Err(String::from("Unable to vote right now, try again later"));
        }

        if self.vote.can_ids_and_normalized_weights.len() > 5 {
            return Err(String::from("Too many splits"));
        }

        if !state.cur_round_burn_positions.contains_key(&caller) {
            return Err(String::from(
                "Only participants pledged BURN can vote for the next token",
            ));
        }

        if state.next_token_x_votes.contains_key(&caller) {
            return Err(String::from("Already voted this week"));
        }

        let mut weight_sum = E8s::zero();

        for (token_can_id, weight) in &self.vote.can_ids_and_normalized_weights {
            if state.get_supported_token(token_can_id).is_none() {
                return Err(String::from("Unsupported token"));
            }

            weight_sum += weight;
        }

        if weight_sum > E8s::one() {
            return Err(String::from("Invalid weight sum"));
        }

        Ok(())
    }
}

#[derive(CandidType, Deserialize)]
pub struct VoteTokenXResponse {}

#[derive(CandidType, Deserialize, Validate, Clone, Copy)]
pub struct ClaimRewardICPRequest {
    #[garde(skip)]
    pub winning_entry_timestamp_ns: TimestampNs,
    #[garde(skip)]
    pub winner_idx: u32,
    #[garde(skip)]
    pub to: Account,
}

impl Guard<FurnaceState> for ClaimRewardICPRequest {
    fn validate_and_escape(
        &mut self,
        state: &FurnaceState,
        caller: Principal,
        now: TimestampNs,
    ) -> Result<(), String> {
        self.validate(&()).map_err(|e| e.to_string())?;

        if now <= self.winning_entry_timestamp_ns {
            return Err(String::from("Invalid timestamp"));
        }

        let history_entry = state
            .winners
            .get(&self.winning_entry_timestamp_ns)
            .ok_or(String::from("Invalid timestamp"))?;

        let winner = history_entry
            .winners
            .get(self.winner_idx as usize)
            .ok_or(String::from("Invalid winner idx"))?;

        if winner.pid != caller {
            return Err(String::from("Access denied"));
        }

        if winner.claimed {
            return Err(String::from("Already claimed"));
        }

        Ok(())
    }
}

#[derive(CandidType, Deserialize)]
pub struct ClaimRewardICPResponse {
    pub result: Result<Nat, String>,
}

#[derive(CandidType, Deserialize, Validate)]
pub struct AddSupportedTokenRequest {
    #[garde(length(min = 1))]
    pub tokens: Vec<TokenX>,
}

impl Guard<FurnaceState> for AddSupportedTokenRequest {
    fn validate_and_escape(
        &mut self,
        state: &FurnaceState,
        caller: Principal,
        _now: TimestampNs,
    ) -> Result<(), String> {
        self.validate(&()).map_err(|e| e.to_string())?;

        let info = state.get_furnace_info();
        if !info.is_dev(&caller) {
            return Err(String::from("Access denied"));
        }

        Ok(())
    }
}

#[derive(CandidType, Deserialize)]
pub struct AddSupportedTokenResponse {}

#[derive(CandidType, Deserialize, Validate)]
pub struct RemoveSupportedTokenRequest {
    #[garde(length(min = 1))]
    pub token_can_ids: Vec<Principal>,
}

impl Guard<FurnaceState> for RemoveSupportedTokenRequest {
    fn validate_and_escape(
        &mut self,
        state: &FurnaceState,
        caller: Principal,
        _now: TimestampNs,
    ) -> Result<(), String> {
        self.validate(&()).map_err(|e| e.to_string())?;

        let info = state.get_furnace_info();
        if !info.is_dev(&caller) {
            return Err(String::from("Access denied"));
        }

        Ok(())
    }
}

#[derive(CandidType, Deserialize)]
pub struct RemoveSupportedTokenResponse {}

#[derive(CandidType, Deserialize, Validate)]
pub struct SetMaintenanceStatusRequest {
    #[garde(skip)]
    pub new_status: bool,
}

impl Guard<FurnaceState> for SetMaintenanceStatusRequest {
    fn validate_and_escape(
        &mut self,
        state: &FurnaceState,
        caller: Principal,
        _now: TimestampNs,
    ) -> Result<(), String> {
        self.validate(&()).map_err(|e| e.to_string())?;

        let info = state.get_furnace_info();
        if !info.is_dev(&caller) {
            return Err(String::from("Access denied"));
        }

        Ok(())
    }
}

#[derive(CandidType, Deserialize)]
pub struct SetMaintenanceStatusResponse {}

#[derive(CandidType, Deserialize, Validate)]
pub struct GetWinnersRequest {
    #[garde(skip)]
    pub skip: u64,
    #[garde(range(min = 1, max = 100))]
    pub take: usize,
}

impl Guard<FurnaceState> for GetWinnersRequest {
    fn validate_and_escape(
        &mut self,
        _state: &FurnaceState,
        _caller: Principal,
        _now: TimestampNs,
    ) -> Result<(), String> {
        self.validate(&()).map_err(|e| e.to_string())
    }
}

#[derive(CandidType, Deserialize)]
pub struct GetWinnersResponse {
    pub winners: Vec<FurnaceWinnerHistoryEntry>,
}

#[derive(CandidType, Deserialize, Validate)]
pub struct GetCurRoundPositionsRequest {
    #[garde(skip)]
    pub skip: Option<Principal>,
    #[garde(range(min = 1, max = 100))]
    pub take: usize,
}

impl Guard<FurnaceState> for GetCurRoundPositionsRequest {
    fn validate_and_escape(
        &mut self,
        _state: &FurnaceState,
        _caller: Principal,
        _now: TimestampNs,
    ) -> Result<(), String> {
        self.validate(&()).map_err(|e| e.to_string())
    }
}

#[derive(CandidType, Deserialize)]
pub struct GetCurRoundPositionsResponse {
    pub positions: Vec<(Principal, E8s)>,
}

#[derive(CandidType, Deserialize, Validate)]
pub struct DeployDispenserRequest {
    #[garde(skip)]
    pub token_can_id: Principal,
}

impl Guard<FurnaceState> for DeployDispenserRequest {
    fn validate_and_escape(
        &mut self,
        state: &FurnaceState,
        _caller: Principal,
        _now: TimestampNs,
    ) -> Result<(), String> {
        self.validate(&()).map_err(|e| e.to_string())?;

        if let Some(_) = state.dispenser_of(&self.token_can_id) {
            return Err(String::from("The dispenser already exists"));
        }

        Ok(())
    }
}

#[derive(CandidType, Deserialize)]
pub struct DeployDispenserResponse {}
