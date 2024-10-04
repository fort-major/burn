use candid::{CandidType, Int, Nat, Principal};
use ic_cdk::{api::call::CallResult, call};
use serde::Deserialize;

use crate::ENV_VARS;

pub const ICPSWAP_CAN_ID: &str = "ggzvv-5qaaa-aaaag-qck7a-cai";

pub type GetAllTokensResponse = Vec<ICPSwapTokenEntry>;

#[derive(CandidType, Deserialize)]
pub struct ICPSwapTokenEntry {
    pub id: Nat,
    pub volumeUSD1d: f64,
    pub volumeUSD7d: f64,
    pub totalVolumeUSD: f64,
    pub name: String,
    pub volumeUSD: f64,
    pub feesUSD: f64,
    pub priceUSDChange: f64,
    pub address: String,
    pub txCount: Int,
    pub priceUSD: f64,
    pub standard: String,
    pub symbol: String,
}

pub struct ICPSwapClient {
    pub can_id: Principal,
    pub mock: bool,
}

impl ICPSwapClient {
    pub fn new(can_id: Option<Principal>, mock: bool) -> Self {
        Self {
            can_id: can_id.unwrap_or(Principal::from_text(ICPSWAP_CAN_ID).unwrap()),
            mock,
        }
    }

    pub async fn get_all_tokens(&self) -> CallResult<(GetAllTokensResponse,)> {
        if self.mock {
            Ok((vec![
                ICPSwapTokenEntry {
                    address: ENV_VARS.burn_token_canister_id.to_text(),
                    standard: String::from("ICRC-2"),
                    name: String::from("MSQ Cycle Burn"),
                    symbol: String::from("BURN"),
                    priceUSD: 0.035,

                    id: Nat::from(0u64),
                    volumeUSD1d: 0.0,
                    volumeUSD7d: 0.0,
                    totalVolumeUSD: 0.0,
                    volumeUSD: 0.0,
                    feesUSD: 0.0,
                    priceUSDChange: 0.0,
                    txCount: Int::from(10u64),
                },
                ICPSwapTokenEntry {
                    address: String::from("ryjl3-tyaaa-aaaaa-aaaba-cai"),
                    standard: String::from("ICRC-1"),
                    name: String::from("Internet Computer"),
                    symbol: String::from("ICP"),
                    priceUSD: 8.03,

                    id: Nat::from(1u64),
                    volumeUSD1d: 0.0,
                    volumeUSD7d: 0.0,
                    totalVolumeUSD: 0.0,
                    volumeUSD: 0.0,
                    feesUSD: 0.0,
                    priceUSDChange: 0.0,
                    txCount: Int::from(10u64),
                },
            ],))
        } else {
            call(self.can_id, "getAllTokens", ()).await
        }
    }
}
