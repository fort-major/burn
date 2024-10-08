use candid::{decode_one, encode_one, CandidType, Int, Nat, Principal};
use ic_cdk::{api::call::CallResult, call};
use ic_e8s::c::E8s;
use ic_stable_structures::{storable::Bound, Storable};
use serde::Deserialize;

use crate::{utils::f64_to_e8s, ENV_VARS};

pub const ICPSWAP_CAN_ID: &str = "ggzvv-5qaaa-aaaag-qck7a-cai";

pub type GetAllTokensResponse = Vec<ICPSwapTokenInfo>;

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

#[derive(CandidType, Deserialize)]
pub struct ICPSwapTokenInfo {
    pub can_id: Principal,
    pub exchange_rate_usd: E8s,
}

impl Storable for ICPSwapTokenInfo {
    fn to_bytes(&self) -> std::borrow::Cow<[u8]> {
        std::borrow::Cow::Owned(encode_one(self).expect("Unable to encode"))
    }

    fn from_bytes(bytes: std::borrow::Cow<[u8]>) -> Self {
        decode_one(&bytes).expect("Unable to decode")
    }

    const BOUND: Bound = Bound::Unbounded;
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

    pub async fn get_all_tokens(&self) -> CallResult<GetAllTokensResponse> {
        if self.mock {
            Ok(vec![
                ICPSwapTokenInfo {
                    can_id: ENV_VARS.burn_token_canister_id,
                    exchange_rate_usd: E8s::from(0_0556_0000u64),
                },
                ICPSwapTokenInfo {
                    can_id: ENV_VARS.icp_token_canister_id,
                    exchange_rate_usd: E8s::from(8_0300_0000u64),
                },
            ])
        } else {
            call::<(), (Vec<ICPSwapTokenEntry>,)>(self.can_id, "getAllTokens", ())
                .await
                .map(|(tokens,)| {
                    tokens
                        .into_iter()
                        .map(|token| ICPSwapTokenInfo {
                            can_id: Principal::from_text(token.address).unwrap(),
                            exchange_rate_usd: f64_to_e8s(token.priceUSD),
                        })
                        .collect()
                })
        }
    }
}
