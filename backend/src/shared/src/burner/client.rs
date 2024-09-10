use candid::Principal;
use ic_cdk::{api::call::CallResult, call};

pub struct BurnerClient(pub Principal);

impl BurnerClient {
    pub async fn stake(&self, qty_e8s_u64: u64) -> CallResult<()> {
        call(self.0, "stake", (qty_e8s_u64,)).await
    }
}
