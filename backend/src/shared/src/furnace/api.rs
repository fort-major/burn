use candid::{CandidType, Nat, Principal};
use garde::Validate;
use ic_e8s::c::E8s;
use serde::Deserialize;

use crate::{burner::types::TimestampNs, Guard, ENV_VARS};

use super::{
    state::FurnaceState,
    types::{TokenXVote, MIN_ALLOWED_USD_POSITION_QTY_E8S},
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

        if self.vote.can_ids_and_normalized_weights.len() > 5 {
            return Err(String::from("Too many splits"));
        }

        if !state.cur_round_positions.contains_key(&caller) {
            return Err(String::from(
                "Only pledged participants can vote for the next token",
            ));
        }

        if state.next_token_x_votes.contains_key(&caller) {
            return Err(String::from("Already voted this week"));
        }

        for (token_can_id, _) in &self.vote.can_ids_and_normalized_weights {
            if token_can_id == &ENV_VARS.icp_token_canister_id {
                return Err(String::from("Can't vote for ICP"));
            }

            if !state.supported_tokens.contains_key(token_can_id) {
                return Err(String::from("Unsupported token"));
            }
        }

        Ok(())
    }
}

#[derive(CandidType, Deserialize)]
pub struct VoteTokenXResponse {}
