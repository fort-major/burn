use candid::CandidType;
use ic_e8s::c::E8s;
use serde::Deserialize;

#[derive(CandidType, Deserialize)]
pub struct OrderRequest {
    pub sell: bool,
    pub short: bool,
    pub qty: E8s,
}
