// This is an experimental feature to generate Rust binding from Candid.
// You may want to manually adjust some of the types.
#![allow(dead_code, unused_imports)]
use candid::{self, CandidType, Decode, Deserialize, Encode, Principal};
use ic_cdk::api::call::CallResult as Result;

#[derive(CandidType, Deserialize)]
pub enum TransactionType {
    #[serde(rename = "decreaseLiquidity")]
    DecreaseLiquidity,
    #[serde(rename = "claim")]
    Claim,
    #[serde(rename = "swap")]
    Swap,
    #[serde(rename = "addLiquidity")]
    AddLiquidity,
    #[serde(rename = "transferPosition")]
    TransferPosition(candid::Nat),
    #[serde(rename = "increaseLiquidity")]
    IncreaseLiquidity,
}

#[derive(CandidType, Deserialize)]
pub struct SwapRecordInfo1 {
    pub to: String,
    pub feeAmount: candid::Int,
    pub action: TransactionType,
    pub feeAmountTotal: candid::Int,
    pub token0Id: String,
    pub token1Id: String,
    pub token0AmountTotal: candid::Nat,
    pub liquidityTotal: candid::Nat,
    pub from: String,
    pub tick: candid::Int,
    pub feeTire: candid::Nat,
    pub recipient: String,
    pub token0ChangeAmount: candid::Nat,
    pub token1AmountTotal: candid::Nat,
    pub liquidityChange: candid::Nat,
    pub token1Standard: String,
    pub token0Fee: candid::Nat,
    pub token1Fee: candid::Nat,
    pub timestamp: candid::Int,
    pub token1ChangeAmount: candid::Nat,
    pub token0Standard: String,
    pub price: candid::Nat,
    pub poolId: String,
}

#[derive(CandidType, Deserialize)]
pub struct PoolTvlData {
    pub token0Id: String,
    pub token1Id: String,
    pub pool: String,
    pub tvlUSD: f64,
    pub token0Symbol: String,
    pub token1Symbol: String,
}

#[derive(CandidType, Deserialize)]
pub struct SwapRecordInfo {
    pub to: String,
    pub feeAmount: candid::Int,
    pub action: TransactionType,
    pub feeAmountTotal: candid::Int,
    pub token0Id: String,
    pub token1Id: String,
    pub token0AmountTotal: candid::Nat,
    pub liquidityTotal: candid::Nat,
    pub from: String,
    pub tick: candid::Int,
    pub feeTire: candid::Nat,
    pub recipient: String,
    pub token0ChangeAmount: candid::Nat,
    pub token1AmountTotal: candid::Nat,
    pub liquidityChange: candid::Nat,
    pub token1Standard: String,
    pub token0Fee: candid::Nat,
    pub token1Fee: candid::Nat,
    pub timestamp: candid::Int,
    pub token1ChangeAmount: candid::Nat,
    pub token0Standard: String,
    pub price: candid::Nat,
    pub poolId: String,
}

#[derive(CandidType, Deserialize)]
pub struct SwapErrorInfo {
    pub data: SwapRecordInfo,
    pub error: String,
    pub timestamp: candid::Int,
}

#[derive(CandidType, Deserialize)]
pub enum NatResult {
    #[serde(rename = "ok")]
    Ok(candid::Nat),
    #[serde(rename = "err")]
    Err(String),
}

#[derive(CandidType, Deserialize)]
pub struct PoolBaseInfo {
    pub fee: candid::Int,
    pub token0Id: String,
    pub token1Id: String,
    pub pool: String,
    pub token1Standard: String,
    pub token1Decimals: f64,
    pub token0Standard: String,
    pub token0Symbol: String,
    pub token0Decimals: f64,
    pub token1Symbol: String,
}

#[derive(CandidType, Deserialize)]
pub struct TokenPrice {
    pub tokenId: String,
    pub volumeUSD7d: f64,
    pub priceICP: f64,
    pub priceUSD: f64,
}

#[derive(CandidType, Deserialize)]
pub struct HeaderField(pub String, pub String);

#[derive(CandidType, Deserialize)]
pub struct HttpRequest {
    pub url: String,
    pub method: String,
    pub body: serde_bytes::ByteBuf,
    pub headers: Vec<HeaderField>,
}

#[derive(CandidType, Deserialize)]
pub struct Token {
    pub arbitrary_data: String,
}

#[derive(CandidType, Deserialize)]
pub struct StreamingCallbackHttpResponse {
    pub token: Option<Token>,
    pub body: serde_bytes::ByteBuf,
}

candid::define_function!(pub CallbackStrategyCallback : (Token) -> (
    StreamingCallbackHttpResponse,
  ) query);
#[derive(CandidType, Deserialize)]
pub struct CallbackStrategy {
    pub token: Token,
    pub callback: CallbackStrategyCallback,
}

#[derive(CandidType, Deserialize)]
pub enum StreamingStrategy {
    Callback(CallbackStrategy),
}

#[derive(CandidType, Deserialize)]
pub struct HttpResponse {
    pub body: serde_bytes::ByteBuf,
    pub headers: Vec<HeaderField>,
    pub upgrade: Option<bool>,
    pub streaming_strategy: Option<StreamingStrategy>,
    pub status_code: u16,
}

pub struct Service(pub Principal);
impl Service {
    pub async fn add_client(&self, arg0: Principal) -> Result<()> {
        ic_cdk::call(self.0, "addClient", (arg0,)).await
    }
    pub async fn base_last_storage(&self) -> Result<(String,)> {
        ic_cdk::call(self.0, "baseLastStorage", ()).await
    }
    pub async fn base_storage(&self) -> Result<(Vec<String>,)> {
        ic_cdk::call(self.0, "baseStorage", ()).await
    }
    pub async fn batch_push(&self, arg0: Vec<SwapRecordInfo1>) -> Result<()> {
        ic_cdk::call(self.0, "batchPush", (arg0,)).await
    }
    pub async fn batch_update_pool_tvl(&self, arg0: Vec<PoolTvlData>) -> Result<()> {
        ic_cdk::call(self.0, "batchUpdatePoolTvl", (arg0,)).await
    }
    pub async fn batch_update_token_price_7_d_volume_usd(
        &self,
        arg0: Vec<(String, f64)>,
    ) -> Result<()> {
        ic_cdk::call(self.0, "batchUpdateTokenPrice7dVolumeUSD", (arg0,)).await
    }
    pub async fn clean_error_data(&self) -> Result<(Vec<SwapErrorInfo>,)> {
        ic_cdk::call(self.0, "cleanErrorData", ()).await
    }
    pub async fn cycle_available(&self) -> Result<(NatResult,)> {
        ic_cdk::call(self.0, "cycleAvailable", ()).await
    }
    pub async fn cycle_balance(&self) -> Result<(NatResult,)> {
        ic_cdk::call(self.0, "cycleBalance", ()).await
    }
    pub async fn get_all_pools(&self) -> Result<(Vec<PoolBaseInfo>,)> {
        ic_cdk::call(self.0, "getAllPools", ()).await
    }
    pub async fn get_allow_tokens(&self) -> Result<(Vec<String>,)> {
        ic_cdk::call(self.0, "getAllowTokens", ()).await
    }
    pub async fn get_clients(&self) -> Result<(Vec<Principal>,)> {
        ic_cdk::call(self.0, "getClients", ()).await
    }
    pub async fn get_controllers(&self) -> Result<(Vec<Principal>,)> {
        ic_cdk::call(self.0, "getControllers", ()).await
    }
    pub async fn get_data_queue(&self) -> Result<(Vec<SwapRecordInfo1>,)> {
        ic_cdk::call(self.0, "getDataQueue", ()).await
    }
    pub async fn get_error_data(&self) -> Result<(Vec<SwapErrorInfo>,)> {
        ic_cdk::call(self.0, "getErrorData", ()).await
    }
    pub async fn get_pool_last_price(&self, arg0: Principal) -> Result<(f64,)> {
        ic_cdk::call(self.0, "getPoolLastPrice", (arg0,)).await
    }
    pub async fn get_pool_last_price_time(&self) -> Result<(Vec<(String, candid::Int)>,)> {
        ic_cdk::call(self.0, "getPoolLastPriceTime", ()).await
    }
    pub async fn get_pool_tvl(&self) -> Result<(Vec<PoolTvlData>,)> {
        ic_cdk::call(self.0, "getPoolTvl", ()).await
    }
    pub async fn get_quote_tokens(&self) -> Result<(Vec<String>,)> {
        ic_cdk::call(self.0, "getQuoteTokens", ()).await
    }
    pub async fn get_storage_count(&self) -> Result<(Vec<(String, candid::Nat)>, candid::Int)> {
        ic_cdk::call(self.0, "getStorageCount", ()).await
    }
    pub async fn get_sync_error(&self) -> Result<(String,)> {
        ic_cdk::call(self.0, "getSyncError", ()).await
    }
    pub async fn get_sync_lock(&self) -> Result<(bool,)> {
        ic_cdk::call(self.0, "getSyncLock", ()).await
    }
    pub async fn get_token_price_metadata(&self) -> Result<(Vec<(String, TokenPrice)>,)> {
        ic_cdk::call(self.0, "getTokenPriceMetadata", ()).await
    }
    pub async fn http_request(&self, arg0: HttpRequest) -> Result<(HttpResponse,)> {
        ic_cdk::call(self.0, "http_request", (arg0,)).await
    }
    pub async fn init_storage_count(&self) -> Result<(Vec<(String, candid::Nat)>,)> {
        ic_cdk::call(self.0, "initStorageCount", ()).await
    }
    pub async fn push(&self, arg0: SwapRecordInfo1) -> Result<()> {
        ic_cdk::call(self.0, "push", (arg0,)).await
    }
    pub async fn remove_token_metadata(&self, arg0: Principal) -> Result<()> {
        ic_cdk::call(self.0, "removeTokenMetadata", (arg0,)).await
    }
    pub async fn retry_error_data(&self) -> Result<(Vec<SwapErrorInfo>,)> {
        ic_cdk::call(self.0, "retryErrorData", ()).await
    }
    pub async fn set_quote_tokens(&self, arg0: Vec<String>, arg1: bool) -> Result<()> {
        ic_cdk::call(self.0, "setQuoteTokens", (arg0, arg1)).await
    }
    pub async fn update_mini_proportion(&self, arg0: f64) -> Result<()> {
        ic_cdk::call(self.0, "updateMiniProportion", (arg0,)).await
    }
    pub async fn update_token_metadata(
        &self,
        arg0: Principal,
        arg1: String,
        arg2: candid::Nat,
    ) -> Result<()> {
        ic_cdk::call(self.0, "updateTokenMetadata", (arg0, arg1, arg2)).await
    }
}
