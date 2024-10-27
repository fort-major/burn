use candid::{Nat, Principal};
use ic_cdk::{api::call::CallResult, call};

use icrc_ledger_types::{
    icrc1::{
        account::Account,
        transfer::{BlockIndex, NumTokens, TransferArg, TransferError},
    },
    icrc2::transfer_from::{TransferFromArgs, TransferFromError},
};

pub struct ICRC1CanisterClient {
    pub canister_id: Principal,
}

impl ICRC1CanisterClient {
    pub fn new(canister_id: Principal) -> Self {
        Self { canister_id }
    }

    pub async fn icrc1_balance_of(&self, arg: Account) -> CallResult<(Nat,)> {
        call(self.canister_id, "icrc1_balance_of", (arg,)).await
    }

    pub async fn icrc1_minting_account(&self) -> CallResult<(Option<Account>,)> {
        call(self.canister_id, "icrc1_minting_account", ()).await
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

    pub async fn icrc1_furnace_burn(
        &self,
        minter_account: Account,
        from_subaccount: Option<[u8; 32]>,
        amount: NumTokens,
    ) -> CallResult<(Result<BlockIndex, TransferError>,)> {
        let arg = TransferArg {
            from_subaccount,
            amount,
            to: minter_account,
            fee: Some(Nat::from(0u64)),
            created_at_time: None,
            memo: None,
        };

        self.icrc1_transfer(arg).await
    }

    pub async fn icrc1_decimals(&self) -> CallResult<(u8,)> {
        call(self.canister_id, "icrc1_decimals", ()).await
    }

    pub async fn icrc1_fee(&self) -> CallResult<(Nat,)> {
        call(self.canister_id, "icrc1_fee", ()).await
    }
}
