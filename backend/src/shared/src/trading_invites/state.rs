use candid::Principal;
use ic_stable_structures::StableBTreeMap;

use crate::burner::types::Memory;

use super::types::{Invite, MemberInfo};

pub struct TradingInvitesState {
    pub members: StableBTreeMap<Principal, MemberInfo, Memory>,
    pub invites: StableBTreeMap<Invite, Principal, Memory>,
}
