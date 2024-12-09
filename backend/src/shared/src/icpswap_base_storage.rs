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
pub struct Transaction {
    pub to: String,
    pub action: TransactionType,
    pub token0Id: String,
    pub token1Id: String,
    pub liquidityTotal: candid::Nat,
    pub from: String,
    pub hash: String,
    pub tick: candid::Int,
    pub token1Price: f64,
    pub recipient: String,
    pub token0ChangeAmount: f64,
    pub sender: String,
    pub liquidityChange: candid::Nat,
    pub token1Standard: String,
    pub token0Fee: f64,
    pub token1Fee: f64,
    pub timestamp: candid::Int,
    pub token1ChangeAmount: f64,
    pub token1Decimals: f64,
    pub token0Standard: String,
    pub amountUSD: f64,
    pub amountToken0: f64,
    pub amountToken1: f64,
    pub poolFee: candid::Nat,
    pub token0Symbol: String,
    pub token0Decimals: f64,
    pub token0Price: f64,
    pub token1Symbol: String,
    pub poolId: String,
}

#[derive(CandidType, Deserialize)]
pub enum NatResult {
    #[serde(rename = "ok")]
    Ok(candid::Nat),
    #[serde(rename = "err")]
    Err(String),
}

#[derive(CandidType, Deserialize)]
pub struct RecordPage {
    pub content: Vec<Transaction>,
    pub offset: candid::Nat,
    pub limit: candid::Nat,
    pub totalElements: candid::Nat,
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
    pub async fn add_owners(&self, arg0: Vec<Principal>) -> Result<()> {
        ic_cdk::call(self.0, "addOwners", (arg0,)).await
    }
    pub async fn batch_insert(&self, arg0: Vec<Transaction>) -> Result<()> {
        ic_cdk::call(self.0, "batchInsert", (arg0,)).await
    }
    pub async fn cycle_available(&self) -> Result<(NatResult,)> {
        ic_cdk::call(self.0, "cycleAvailable", ()).await
    }
    pub async fn cycle_balance(&self) -> Result<(NatResult,)> {
        ic_cdk::call(self.0, "cycleBalance", ()).await
    }
    pub async fn get_base_record(
        &self,
        arg0: candid::Nat,
        arg1: candid::Nat,
        arg2: Vec<String>,
    ) -> Result<(RecordPage,)> {
        ic_cdk::call(self.0, "getBaseRecord", (arg0, arg1, arg2)).await
    }
    pub async fn get_by_pool(
        &self,
        arg0: candid::Nat,
        arg1: candid::Nat,
        arg2: String,
    ) -> Result<(RecordPage,)> {
        ic_cdk::call(self.0, "getByPool", (arg0, arg1, arg2)).await
    }
    pub async fn get_by_token(
        &self,
        arg0: candid::Nat,
        arg1: candid::Nat,
        arg2: String,
    ) -> Result<(RecordPage,)> {
        ic_cdk::call(self.0, "getByToken", (arg0, arg1, arg2)).await
    }
    pub async fn get_first_block(&self) -> Result<(candid::Nat,)> {
        ic_cdk::call(self.0, "getFirstBlock", ()).await
    }
    pub async fn get_owners(&self) -> Result<(Vec<Principal>,)> {
        ic_cdk::call(self.0, "getOwners", ()).await
    }
    pub async fn get_pools(&self) -> Result<(Vec<(String, PoolBaseInfo)>,)> {
        ic_cdk::call(self.0, "getPools", ()).await
    }
    pub async fn get_tx(&self, arg0: candid::Nat, arg1: candid::Nat) -> Result<(RecordPage,)> {
        ic_cdk::call(self.0, "getTx", (arg0, arg1)).await
    }
    pub async fn get_tx_count(&self) -> Result<(candid::Nat,)> {
        ic_cdk::call(self.0, "getTxCount", ()).await
    }
    pub async fn http_request(&self, arg0: HttpRequest) -> Result<(HttpResponse,)> {
        ic_cdk::call(self.0, "http_request", (arg0,)).await
    }
    pub async fn insert(&self, arg0: Transaction) -> Result<()> {
        ic_cdk::call(self.0, "insert", (arg0,)).await
    }
}
