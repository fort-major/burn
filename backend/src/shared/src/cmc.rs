use candid::{CandidType, Nat, Principal};
use ic_cdk::{api::call::CallResult, call};
use serde::Deserialize;

#[derive(CandidType, Deserialize)]
pub struct NotifyTopUpRequest {
    pub block_index: u64,
    pub canister_id: Principal,
}

#[derive(CandidType, Deserialize, Debug)]
pub enum NotifyTopUpError {
    Refunded {
        block_index: Option<u64>,
        reason: String,
    },
    InvalidTransaction(String),
    Other {
        error_message: String,
        error_code: u64,
    },
    Processing,
    TransactionTooOld(u64),
}

#[derive(CandidType, Deserialize, Debug)]
pub struct GetIcpXdrConversionRateResponse {
    pub certificate: Vec<u8>,
    pub hash_tree: Vec<u8>,
    pub data: XdrData,
}

#[derive(CandidType, Deserialize, Debug)]
pub struct XdrData {
    pub xdr_permyriad_per_icp: u64,
    pub timestamp_seconds: u64,
}

pub struct CMCClient(pub Principal);

impl CMCClient {
    pub async fn notify_top_up(
        &self,
        req: NotifyTopUpRequest,
    ) -> CallResult<(Result<Nat, NotifyTopUpError>,)> {
        call(self.0, "notify_top_up", (req,)).await
    }

    pub async fn get_icp_xdr_conversion_rate(
        &self,
    ) -> CallResult<(GetIcpXdrConversionRateResponse,)> {
        call(self.0, "get_icp_xdr_conversion_rate", ()).await
    }
}
