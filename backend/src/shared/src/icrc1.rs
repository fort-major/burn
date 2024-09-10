use candid::Principal;
use ic_cdk::{api::call::CallResult, call};
use ic_e8s::c::E8s;
use icrc_ledger_types::{
    icrc1::account::Account,
    icrc1::transfer::{BlockIndex, TransferArg, TransferError},
    icrc2::transfer_from::{TransferFromArgs, TransferFromError},
};

pub struct ICRC1CanisterClient {
    pub canister_id: Principal,
}

impl ICRC1CanisterClient {
    pub fn new(canister_id: Principal) -> Self {
        Self { canister_id }
    }

    pub async fn icrc1_balance_of(&self, arg: Account) -> CallResult<(E8s,)> {
        call(self.canister_id, "icrc1_balance_of", (arg,)).await
    }

    pub async fn icrc1_transfer(
        &self,
        arg: TransferArg,
    ) -> CallResult<(Result<BlockIndex, TransferError>,)> {
        call(self.canister_id, "icrc1_transfer", (arg,)).await
    }

    pub async fn icrc2_transfer_from(
        &self,
        arg: TransferFromArgs,
    ) -> CallResult<(Result<BlockIndex, TransferFromError>,)> {
        call(self.canister_id, "icrc2_transfer_from", (arg,)).await
    }
}
