use candid::Principal;
use ic_canister_sig_creation::IC_ROOT_PUBLIC_KEY;
use ic_verifiable_credentials::{
    issuer_api::CredentialSpec, validate_ii_presentation_and_claims, VcFlowSigners,
};

const II_CANISTER_ID: &str = "rdmx6-jaaaa-aaaaa-aaadq-cai";
const II_ORIGIN: &str = "https://identity.ic0.app/";
const ISSUER_CANISTER_ID: &str = "qgxyr-pyaaa-aaaah-qdcwq-cai";
const ISSUER_ORIGIN: &str = "https://id.decideai.xyz/";
const CRED_TYPE: &str = "ProofOfUniqueness";

/**
 * This function uses the ic-verifiable-credentials library (https://github.com/dfinity/verifiable-credentials-sdk/tree/main/rust-packages/ic-verifiable-credentials)
 * cloned to the local directory. See top-level Cargo.toml for more details.
 */
pub fn verify_decide_id_proof(jwt: &str, caller: Principal, now: u128) -> Result<(), String> {
    let signers = VcFlowSigners {
        ii_canister_id: Principal::from_text(II_CANISTER_ID).unwrap(),
        ii_origin: II_ORIGIN.into(),
        issuer_canister_id: Principal::from_text(ISSUER_CANISTER_ID).unwrap(),
        issuer_origin: ISSUER_ORIGIN.into(),
    };

    let spec = CredentialSpec {
        credential_type: CRED_TYPE.into(),
        arguments: None,
    };

    validate_ii_presentation_and_claims(&jwt, caller, &signers, &spec, &IC_ROOT_PUBLIC_KEY, now)
        .map_err(|e| format!("{:?}", e))
        .map(|_| ())
}
