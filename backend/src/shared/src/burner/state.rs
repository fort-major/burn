use candid::{decode_one, encode_one, Principal};
use ic_e8s::c::E8s;
use ic_stable_structures::{storable::Bound, Cell, StableBTreeMap, Storable};

use super::{
    api::{GetBurnersRequest, GetBurnersResponse, GetTotalsResponse},
    types::{BurnerStateInfo, Memory, TCycles, TCYCLE_POS_ROUND_BASE_FEE},
};

pub struct BurnerState {
    pub shares: StableBTreeMap<Principal, (TCycles, E8s), Memory>,
    pub info: Cell<BurnerStateInfo, Memory>,
}

impl BurnerState {
    pub fn init(&mut self, seed: Vec<u8>) {
        let mut info = self.get_info();

        info.init(seed);

        self.set_info(info);
    }

    pub fn mint_share(&mut self, qty: TCycles, to: Principal) {
        let cur_opt = self.shares.get(&to);

        let entry = if let Some((mut cur_share, cur_unclaimed_reward)) = cur_opt {
            cur_share += &qty;

            (cur_share, cur_unclaimed_reward)
        } else {
            (qty.clone(), E8s::zero())
        };

        self.shares.insert(to, entry);

        let mut info = self.get_info();
        info.total_shares_supply += &qty;
        self.set_info(info);
    }

    pub fn claim_reward(&mut self, caller: Principal) -> Option<E8s> {
        let fee = TCycles::from(TCYCLE_POS_ROUND_BASE_FEE);

        if let Some((share, unclaimed_reward)) = self.shares.get(&caller) {
            if share < fee {
                let mut info = self.get_info();
                info.total_shares_supply -= &share;
                self.set_info(info);

                self.shares.remove(&caller);
            } else {
                self.shares.insert(caller, (share, E8s::zero()));
            }

            if unclaimed_reward > E8s::zero() {
                let mut info = self.get_info();
                info.total_burn_token_minted += &unclaimed_reward;
                self.set_info(info);

                Some(unclaimed_reward)
            } else {
                None
            }
        } else {
            None
        }
    }

    pub fn revert_claim_reward(&mut self, caller: Principal, unclaimed_reward: E8s) {
        let mut info = self.get_info();
        info.total_burn_token_minted -= &unclaimed_reward;
        self.set_info(info);

        if let Some((share, reward)) = self.shares.get(&caller) {
            self.shares
                .insert(caller, (share, reward + unclaimed_reward));
        } else {
            self.shares
                .insert(caller, (TCycles::zero(), unclaimed_reward));
        }
    }

    // return true if the round has completed
    pub fn pos_round_batch(&mut self, batch_size: u64, is_stopped: bool) -> bool {
        // only run the protocol if someone is minting
        if self.shares.len() == 0 {
            return true;
        }

        let mut info = self.get_info();

        let mut iter = if let Some(id) = info.next_burner_id {
            // if we're continuing the round, and the canister is stopped - continue, until the round is completed

            let mut i = self.shares.range(&id..);
            i.next();
            i
        } else {
            // if we're about to start a new round, but the canister is stopped - don't start it, return early
            if is_stopped {
                return true;
            }

            self.shares.iter()
        };

        let fee = info.get_current_fee();

        let cur_reward = info
            .current_burn_token_reward
            .clone()
            .to_dynamic()
            .to_decimals(12)
            .to_const();

        let mut total_shares_burned = TCycles::zero();
        let mut accounts_to_update = Vec::with_capacity(batch_size as usize);
        let mut i: u64 = 0;
        let mut completed = false;

        loop {
            if let Some((account, (share, unclaimed_reward))) = iter.next() {
                if share < fee {
                    continue;
                }

                let new_reward = (&cur_reward * &share / &info.total_shares_supply)
                    .to_dynamic()
                    .to_decimals(8)
                    .to_const();
                let new_share = share - &fee;

                accounts_to_update.push((account, (new_share, unclaimed_reward + new_reward)));
                info.next_burner_id = Some(account);
                total_shares_burned += &fee;

                i += 1;

                if i == batch_size {
                    break;
                }
            } else {
                completed = true;
                info.complete_round();

                break;
            }
        }

        if accounts_to_update.is_empty() && !completed {
            completed = true;
            info.complete_round();
        }

        for (account, entry) in accounts_to_update {
            self.shares.insert(account, entry);
        }

        info.total_shares_supply -= total_shares_burned;

        self.set_info(info);

        completed
    }

    pub fn get_info(&self) -> BurnerStateInfo {
        self.info.get().clone()
    }

    pub fn set_info(&mut self, info: BurnerStateInfo) {
        self.info.set(info).expect("Unable to store info");
    }

    pub fn get_burners(&self, req: GetBurnersRequest) -> GetBurnersResponse {
        let mut iter = if let Some(start_from) = req.start {
            let mut i = self.shares.range(&start_from..);
            i.next();
            i
        } else {
            self.shares.iter()
        };

        let mut entries = Vec::new();
        let mut i = 0;

        loop {
            if let Some((account, (share, unclaimed_reward))) = iter.next() {
                entries.push((account, share, unclaimed_reward));
                i += 1;

                if i == req.take {
                    break;
                }
            } else {
                break;
            }
        }

        GetBurnersResponse { entries }
    }

    pub fn get_totals(&self, caller: &Principal) -> GetTotalsResponse {
        let info = self.get_info();
        let fee = info.get_current_fee();
        let (share, unclaimed_reward) = self.shares.get(caller).unwrap_or_default();

        GetTotalsResponse {
            total_share_supply: info.total_shares_supply,
            total_tcycles_burned: info.total_tcycles_burned,
            total_burn_token_minted: info.total_burn_token_minted,
            total_burners: self.shares.len(),
            current_burn_token_reward: info.current_burn_token_reward,
            pos_start_key: info.next_burner_id,
            current_pos_round: info.current_pos_round,
            pos_round_delay_ns: info.pos_round_delay_ns,
            your_share_tcycles: share,
            your_unclaimed_reward_e8s: unclaimed_reward,
            current_share_fee: fee,
        }
    }
}

impl Storable for BurnerStateInfo {
    fn to_bytes(&self) -> std::borrow::Cow<[u8]> {
        std::borrow::Cow::Owned(encode_one(self).unwrap())
    }

    fn from_bytes(bytes: std::borrow::Cow<[u8]>) -> Self {
        decode_one(&bytes).unwrap()
    }

    const BOUND: ic_stable_structures::storable::Bound = Bound::Unbounded;
}
