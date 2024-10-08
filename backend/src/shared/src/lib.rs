use burner::types::TimestampNs;
use candid::{CandidType, Principal};
use env::{
    CAN_BURNER_CANISTER_ID, CAN_BURN_TOKEN_CANISTER_ID, CAN_IC_HOST, CAN_II_CANISTER_ID, CAN_MODE,
    CAN_ROOT_KEY,
};
use lazy_static::lazy_static;
use serde::Deserialize;

pub mod burner;
pub mod decideid;
mod env;
pub mod furnace;
pub mod icpswap;
pub mod icrc1;
pub mod utils;

pub const CMC_CAN_ID: &str = "rkp4c-7iaaa-aaaaa-aaaca-cai";
pub const ICP_CAN_ID: &str = "ryjl3-tyaaa-aaaaa-aaaba-cai";
pub const MEMO_TOP_UP_CANISTER: u64 = 1347768404_u64;
pub const ICP_FEE: u64 = 10_000u64;
pub const CYCLES_BURNER_FEE: u128 = 10_000_000_000_u128;
pub const MIN_ICP_STAKE_E8S_U64: u64 = 5000_0000;

pub const ONE_MINUTE_NS: u64 = 1_000_000_000 * 60;
pub const ONE_HOUR_NS: u64 = ONE_MINUTE_NS * 60;
pub const ONE_DAY_NS: u64 = ONE_HOUR_NS * 24;
pub const ONE_WEEK_NS: u64 = ONE_DAY_NS * 7;
pub const ONE_MONTH_NS: u64 = ONE_WEEK_NS * 30;

pub trait Guard<T> {
    fn validate_and_escape(
        &mut self,
        state: &T,
        caller: Principal,
        now: TimestampNs,
    ) -> Result<(), String>;
}

pub fn escape_script_tag(s: &str) -> String {
    html_escape::encode_script(s).to_string()
}

lazy_static! {
    pub static ref ENV_VARS: EnvVarsState = EnvVarsState::new();
}

#[derive(CandidType, Deserialize, Clone)]
pub enum CanisterMode {
    Dev,
    IC,
}

#[derive(CandidType, Deserialize, Clone)]
pub struct EnvVarsState {
    pub burner_canister_id: Principal,
    pub burn_token_canister_id: Principal,
    pub ii_canister_id: Principal,
    pub ii_origin: String,
    pub ic_root_key_der: Vec<u8>,
    pub icp_token_canister_id: Principal,
    pub mode: CanisterMode,
}

impl EnvVarsState {
    pub fn new() -> Self {
        let ii_origin = if CAN_MODE == "ic" {
            String::from("https://identity.ic0.app/")
        } else {
            String::from(CAN_IC_HOST).replace("http://", &format!("http://{}.", CAN_II_CANISTER_ID))
        };

        Self {
            burner_canister_id: Principal::from_text(CAN_BURNER_CANISTER_ID).unwrap(),
            burn_token_canister_id: Principal::from_text(CAN_BURN_TOKEN_CANISTER_ID).unwrap(),
            ii_canister_id: Principal::from_text(CAN_II_CANISTER_ID).unwrap(),

            ii_origin,

            ic_root_key_der: CAN_ROOT_KEY
                .trim_start_matches("[")
                .trim_end_matches("]")
                .split(",")
                .map(|chunk| chunk.trim().parse().expect("Unable to parse ic root key"))
                .collect(),

            icp_token_canister_id: Principal::from_text("ryjl3-tyaaa-aaaaa-aaaba-cai").unwrap(),
            mode: if CAN_MODE == "ic" {
                CanisterMode::IC
            } else {
                CanisterMode::Dev
            },
        }
    }
}
