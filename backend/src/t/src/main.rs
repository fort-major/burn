pub fn main() {
    match validate_ii_presentation_and_claims(
        &req.vp_jwt,
        req.effective_vc_subject,
        &vc_flow_signers,
        &req.credential_spec,
        &ic_root_key_raw,
        time() as u128,
    ) {
        Ok(()) => Ok(()),
        Err(err) => Err(ContentError::NotAuthorized(format!(
            "VP validation error: {:?}",
            err
        ))),
    }
}
