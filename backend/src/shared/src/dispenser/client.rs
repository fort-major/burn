use candid::{Nat, Principal};
use ic_cdk::{api::call::CallResult, call};
use icrc_ledger_types::icrc1::account::Account;

use super::{
    api::{
        CreateDistributionRequest, CreateDistributionResponse, FurnaceTriggerDistributionRequest,
        FurnaceTriggerDistributionResponse,
    },
    types::{Distribution, DistributionId},
};

pub struct DispenserClient(pub Principal);

impl DispenserClient {
    pub async fn withdraw_dev_fee(&self, to: Account, qty: Nat) -> CallResult<()> {
        call(self.0, "withdraw_dev_fee", (to, qty)).await
    }

    pub async fn furnace_trigger_distribution(
        &self,
        req: FurnaceTriggerDistributionRequest,
    ) -> CallResult<(FurnaceTriggerDistributionResponse,)> {
        call(self.0, "furnace_trigger_distribution", (req,)).await
    }

    pub async fn get_distribution(
        &self,
        id: DistributionId,
    ) -> CallResult<(Option<Distribution>,)> {
        call(self.0, "get_distribution", (id,)).await
    }

    pub async fn create_distribution(
        &self,
        req: CreateDistributionRequest,
    ) -> CallResult<(CreateDistributionResponse,)> {
        call(self.0, "create_distribution", (req,)).await
    }

    pub async fn stop(&self) -> CallResult<()> {
        call(self.0, "stop", ()).await
    }

    pub async fn resume(&self) -> CallResult<()> {
        call(self.0, "resume", ()).await
    }
}
