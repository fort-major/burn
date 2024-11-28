use candid::Principal;
use ic_cdk::{api::call::CallResult, call};


pub struct TradingClient(pub Principal);

impl TradingClient {
    pub async fn register(&self, pid: Principal, inviter: Option<Principal>) -> CallResult<()> {
        call(self.0, "register", (pid, inviter)).await
    }
}
