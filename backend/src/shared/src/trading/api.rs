use candid::CandidType;
use ic_e8s::c::E8s;
use serde::Deserialize;

#[derive(CandidType, Deserialize)]
pub struct OrderRequest {
    pub sell: bool,
    pub short: bool,
    pub qty: E8s,
    pub expected_price: f64,
}

#[derive(CandidType, Deserialize)]
pub struct GetPriceHistoryRequest {
    pub skip: u64,
    pub take: u64,
    pub kind: CandleKind,
    pub short: bool,
}

#[derive(CandidType, Deserialize)]
pub enum CandleKind {
    FourHours,
    OneDay,
}
