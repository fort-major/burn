use candid::{CandidType, Nat, Principal};
use garde::Validate;
use ic_e8s::d::EDs;
use icrc_ledger_types::icrc1::account::Account;
use serde::Deserialize;

use crate::{utils::escape_script_tag, Guard};

use super::{
    state::DispenserState,
    types::{
        Distribution, DistributionId, DistributionScheme, DistributionStartCondition,
        DistributionStatus,
    },
};

#[derive(CandidType, Deserialize, Validate)]
pub struct CreateDistributionRequest {
    #[garde(skip)]
    pub qty: Nat,
    #[garde(dive)]
    pub start_condition: DistributionStartCondition,
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
        _state: &DispenserState,
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

        Ok(())
    }
}

#[derive(CandidType, Deserialize)]
pub struct CreateDistributionResponse {
    pub distribution_id: DistributionId,
}

#[derive(CandidType, Deserialize, Validate)]
pub struct CancelDistributionRequest {
    #[garde(skip)]
    pub distribution_id: DistributionId,
}

impl Guard<DispenserState> for CancelDistributionRequest {
    fn validate_and_escape(
        &mut self,
        state: &DispenserState,
        caller: Principal,
        _now: crate::burner::types::TimestampNs,
    ) -> Result<(), String> {
        self.validate(&()).map_err(|e| e.to_string())?;

        if let Some(distribution) = state.scheduled_distributions.get(&self.distribution_id) {
            if distribution.owner != caller {
                return Err(String::from("Access denied"));
            }
        } else {
            return Err(String::from(
                "Distribution not found or is in invalid state",
            ));
        }

        Ok(())
    }
}

#[derive(CandidType, Deserialize)]
pub struct CancelDistributionResponse {}

#[derive(CandidType, Deserialize, Validate, Clone)]
pub struct WithdrawCanceledRequest {
    #[garde(skip)]
    pub distribution_id: DistributionId,
    #[garde(skip)]
    pub qty: Nat,
    #[garde(skip)]
    pub to: Account,
}

impl Guard<DispenserState> for WithdrawCanceledRequest {
    fn validate_and_escape(
        &mut self,
        state: &DispenserState,
        caller: Principal,
        _now: crate::burner::types::TimestampNs,
    ) -> Result<(), String> {
        self.validate(&()).map_err(|e| e.to_string())?;

        let info = state.get_dispenser_info();

        if self.qty < info.token_fee {
            return Err(String::from("Qty too small"));
        }

        let distribution = state
            .past_distributions
            .get(&self.distribution_id)
            .ok_or(String::from("Distribution not found or in invalid state"))?;

        if distribution.owner != caller {
            return Err(String::from("Access denied"));
        }

        if !matches!(distribution.status, DistributionStatus::Canceled) {
            return Err(String::from("Distribution is in invalid status"));
        }

        let qty_eds = EDs::new(self.qty.0.clone(), info.token_decimals);

        if qty_eds < distribution.leftover_qty {
            return Err(String::from("Insufficient distribution balance"));
        }

        Ok(())
    }
}

#[derive(CandidType, Deserialize)]
pub struct WithdrawCanceledResponse {
    pub result: Result<Nat, String>,
}

#[derive(CandidType, Deserialize, Validate)]
pub struct ClaimTokensRequest {
    #[garde(skip)]
    pub qty: EDs,
    #[garde(skip)]
    pub to: Account,
}

impl Guard<DispenserState> for ClaimTokensRequest {
    fn validate_and_escape(
        &mut self,
        state: &DispenserState,
        caller: Principal,
        _now: crate::burner::types::TimestampNs,
    ) -> Result<(), String> {
        self.validate(&()).map_err(|e| e.to_string())?;

        let unclaimed_tokens = state.unclaimed_tokens.get(&caller).unwrap_or_default();

        if unclaimed_tokens < self.qty {
            return Err(String::from("Insufficiend funds"));
        }

        Ok(())
    }
}

#[derive(CandidType, Deserialize)]
pub struct ClaimTokensResponse {
    pub result: Result<Nat, String>,
}

#[derive(CandidType, Deserialize)]
pub struct GetDistributionsRequest {
    pub take: u64,
    pub skip: Option<DistributionId>,
    pub status: DistributionStatus,
}

#[derive(CandidType, Deserialize)]
pub struct GetDistributionsResponse {
    pub distributions: Vec<Distribution>,
}

#[derive(CandidType, Deserialize)]
pub struct InitArgs {
    pub token_can_id: Principal,
}
