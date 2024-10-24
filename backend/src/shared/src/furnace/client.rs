use candid::Principal;
use ic_cdk::{api::call::CallResult, call};

use super::api::{GetCurRoundPositionsRequest, GetCurRoundPositionsResponse};

pub struct FurnaceClient(pub Principal);

impl FurnaceClient {
    pub async fn get_cur_round_positions(
        &self,
        req: GetCurRoundPositionsRequest,
    ) -> CallResult<(GetCurRoundPositionsResponse,)> {
        call(self.0, "get_cur_round_positions", (req,)).await
    }
}
