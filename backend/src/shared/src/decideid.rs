use candid::Principal;
use ic_canister_sig_creation::extract_raw_root_pk_from_der;
use ic_verifiable_credentials::{
    issuer_api::CredentialSpec, validate_ii_presentation_and_claims, VcFlowSigners,
};

use crate::ENV_VARS;

const ISSUER_CANISTER_ID: &str = "qgxyr-pyaaa-aaaah-qdcwq-cai";
const ISSUER_ORIGIN: &str = "https://id.decideai.xyz/";
const CRED_TYPE: &str = "ProofOfUniqueness";

/**
 * This function uses the ic-verifiable-credentials library (https://github.com/dfinity/verifiable-credentials-sdk/tree/main/rust-packages/ic-verifiable-credentials)
 * cloned to the local directory. See top-level Cargo.toml for more details.
 */
pub fn verify_decide_id_proof(jwt: &str, caller: Principal, now: u128) -> Result<(), String> {
    let signers = VcFlowSigners {
        ii_canister_id: ENV_VARS.ii_canister_id,
        ii_origin: ENV_VARS.ii_origin.clone(),
        issuer_canister_id: Principal::from_text(ISSUER_CANISTER_ID).unwrap(),
        issuer_origin: ISSUER_ORIGIN.into(),
    };

    let spec = CredentialSpec {
        credential_type: CRED_TYPE.into(),
        arguments: None,
    };

    let pk =
        extract_raw_root_pk_from_der(&ENV_VARS.ic_root_key_der).expect("Unable to extract the PK");

    validate_ii_presentation_and_claims(&jwt, caller, &signers, &spec, &pk, now)
        .map_err(|e| format!("{:?}", e))
        .map(|_| ())
}
