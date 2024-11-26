use candid::{decode_one, encode_one, CandidType};
use ic_stable_structures::{storable::Bound, Storable};
use serde::Deserialize;

pub type Invite = [u8; 32];

pub const BRIBE_SIZE_E8S: u64 = 1000_0000_0000;

#[derive(CandidType, Deserialize, Debug, Default)]
pub struct MemberInfo {
    pub cur_invite: Option<Invite>,
}

impl Storable for MemberInfo {
    fn to_bytes(&self) -> std::borrow::Cow<[u8]> {
        std::borrow::Cow::Owned(encode_one(self).expect("Unable to encode"))
    }

    fn from_bytes(bytes: std::borrow::Cow<[u8]>) -> Self {
        decode_one(&bytes).expect("Unable to decode")
    }

    const BOUND: Bound = Bound::Unbounded;
}
