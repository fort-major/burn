use candid::Principal;
use ic_cdk::{api::call::CallResult, call};

use super::api::{
    GetBurnersRequest, GetBurnersResponse, GetKamikazesRequest, GetKamikazesResponse,
};

pub struct BurnerClient(pub Principal);

impl BurnerClient {
    pub async fn stake(&self, qty_e8s_u64: u64) -> CallResult<()> {
        call(self.0, "stake", (qty_e8s_u64,)).await
    }

    pub async fn get_burners(&self, req: GetBurnersRequest) -> CallResult<(GetBurnersResponse,)> {
        call(self.0, "get_burners", (req,)).await
    }

    pub async fn get_kamikazes(
        &self,
        req: GetKamikazesRequest,
    ) -> CallResult<(GetKamikazesResponse,)> {
        call(self.0, "get_kamikazes", (req,)).await
    }
}
