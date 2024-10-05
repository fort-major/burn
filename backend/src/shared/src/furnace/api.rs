use candid::{CandidType, Nat, Principal};
use garde::Validate;
use ic_e8s::c::E8s;
use serde::Deserialize;

use crate::{burner::types::TimestampNs, Guard};

use super::{
    state::FurnaceState,
    types::{PositionId, MIN_ALLOWED_USD_BURN_QTY_E8S},
};

#[derive(CandidType, Deserialize, Validate)]
pub struct CreatePositionRequest {
    #[garde(skip)]
    pub token_can_id: Principal,
    #[garde(skip)]
    pub qty: Nat,
    #[garde(skip)]
    pub pid: Principal,
    #[garde(length(graphemes, min = 5, max = 128))]
    pub title: Option<String>,
    #[garde(url)]
    pub link: Option<String>,
}

impl Guard<FurnaceState> for CreatePositionRequest {
    fn validate_and_escape(
        &mut self,
        state: &FurnaceState,
        _caller: Principal,
        _now: TimestampNs,
    ) -> Result<(), String> {
        self.validate(&()).map_err(|e| e.to_string())?;

        if let Some(title) = &self.title {
            let trimmed_title = title.trim().to_string();

            if trimmed_title.len() < 5 {
                return Err(String::from("Title too short"));
            }

            self.title = Some(trimmed_title);
        }

        let info = state.get_furnace_info_ref();
        let usd_value = info
            .get_whitelisted_token_usd_value(&self.token_can_id, self.qty.clone())
            .ok_or(String::from("The token is not whitelisted"))?;

        let min_usd_value = E8s::from(MIN_ALLOWED_USD_BURN_QTY_E8S);
        if usd_value < min_usd_value {
            return Err(String::from("Too few burned tokens"));
        }

        Ok(())
    }
}

#[derive(CandidType, Deserialize)]
pub struct CreatePositionResponse {
    pub position_id: PositionId,
}

#[derive(CandidType, Deserialize, Validate)]
pub struct AffectPositionRequest {
    #[garde(skip)]
    pub position_id: PositionId,
    #[garde(skip)]
    pub token_can_id: Principal,
    #[garde(skip)]
    pub qty: Nat,
    #[garde(skip)]
    pub downvote: bool,
}

impl Guard<FurnaceState> for AffectPositionRequest {
    fn validate_and_escape(
        &mut self,
        state: &FurnaceState,
        _caller: Principal,
        _now: TimestampNs,
    ) -> Result<(), String> {
        self.validate(&()).map_err(|e| e.to_string())?;

        let info = state.get_furnace_info_ref();
        let usd_value = info
            .get_whitelisted_token_usd_value(&self.token_can_id, self.qty.clone())
            .ok_or(String::from("The token is not whitelisted"))?;

        let min_usd_value = E8s::from(MIN_ALLOWED_USD_BURN_QTY_E8S);
        if usd_value < min_usd_value {
            return Err(String::from("Too few burned tokens"));
        }

        let position = state
            .positions
            .get(&self.position_id)
            .ok_or(String::from("Position not found"))?;

        if position.title.is_none() && position.link.is_none() && self.downvote {
            return Err(String::from(
                "Unable to downvote a position without attached data",
            ));
        }

        Ok(())
    }
}

#[derive(CandidType, Deserialize)]
pub struct AffectPositionResponse {
    pub new_position_value_usd: E8s,
}
