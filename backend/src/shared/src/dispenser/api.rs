use candid::{CandidType, Nat, Principal};
use garde::Validate;
use serde::Deserialize;

use crate::{utils::escape_script_tag, Guard};

use super::{
    state::DispenserState,
    types::{DistributionId, DistributionScheme},
};

#[derive(CandidType, Deserialize, Validate)]
pub struct CreateDistributionRequest {
    #[garde(skip)]
    pub qty: Nat,
    #[garde(skip)]
    pub start_at_tick: Option<u64>,
    #[garde(range(min = 1, max = 720))]
    pub duration_ticks: u64,
    #[garde(length(bytes, min = 4, max = 128))]
    pub name: String,
    #[garde(skip)]
    pub scheme: DistributionScheme,
}

impl Guard<DispenserState> for CreateDistributionRequest {
    fn validate_and_escape(
        &mut self,
        state: &DispenserState,
        _caller: Principal,
        _now: crate::burner::types::TimestampNs,
    ) -> Result<(), String> {
        self.validate(&()).map_err(|e| e.to_string())?;

        if self.qty == Nat::from(0u64) {
            return Err(String::from("Empty distribution is not allowed"));
        }

        if matches!(self.scheme, DistributionScheme::Logarithmic) {
            return Err(String::from("Unsupported scheme"));
        }

        self.name = escape_script_tag(&self.name);

        let info = state.get_dispenser_info();
        if let Some(start_at_tick) = self.start_at_tick {
            if start_at_tick <= info.cur_tick {
                return Err(String::from("Invalid start tick - too early"));
            }

            if start_at_tick - info.cur_tick > 720 {
                return Err(String::from(
                    "Invalid start tick - can only plan one month ahead",
                ));
            }
        } else {
            self.start_at_tick = Some(info.cur_tick + 1);
        }

        Ok(())
    }
}

#[derive(CandidType, Deserialize)]
pub struct CreateDistributionResponse {
    pub distribution_id: DistributionId,
}
