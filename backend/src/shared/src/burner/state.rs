use std::collections::BTreeSet;

use candid::{decode_one, encode_one, Principal};
use ic_e8s::c::{E8s, ECs};
use ic_stable_structures::{storable::Bound, Cell, StableBTreeMap, Storable};

use crate::decideid::verify_decide_id_proof;

use super::{
    api::{GetBurnersRequest, GetBurnersResponse, GetTotalsResponse},
    types::{BurnerStateInfo, Memory, TCycles, TimestampNs, TCYCLE_POS_ROUND_BASE_FEE},
};

pub struct BurnerState {
    pub shares: StableBTreeMap<Principal, (TCycles, E8s), Memory>,
    pub info: Cell<BurnerStateInfo, Memory>,
    pub verified_via_decide_id: StableBTreeMap<Principal, (), Memory>,
    pub eligible_for_lottery: StableBTreeMap<Principal, (), Memory>,
}

impl BurnerState {
    pub fn init(&mut self, seed: Vec<u8>) {
        let mut info = self.get_info();

        info.init(seed);

        self.set_info(info);
    }

    // TODO: delete this function, once the initialization is complete
    pub fn init_tmp_can_migrate(&mut self) {
        let mut info = self.get_info();

        // only do this, if never done this before
        if info.tmp_can_migrate.is_some() {
            return;
        }

        let mut can_migrate_set = BTreeSet::new();
        let mut iter = self.shares.iter();

        while let Some((id, _)) = iter.next() {
            can_migrate_set.insert(id);
        }

        info.tmp_can_migrate = Some(can_migrate_set);

        self.set_info(info);
    }

    pub fn migrate_burner_account(
        &mut self,
        caller: &Principal,
        to: Principal,
    ) -> Result<(), String> {
        let mut info = self.get_info();

        if !info.can_migrate(caller) {
            return Err(String::from("Access denied"));
        }

        if let Some((share_1, reward_1)) = self.shares.remove(caller) {
            let (share_2, reward_2) = if let Some((s1, r1)) = self.shares.get(&to) {
                (s1, r1)
            } else {
                (TCycles::zero(), E8s::zero())
            };

            let share = share_1 + share_2;
            let reward = reward_1 + reward_2;

            if &share > &BurnerStateInfo::get_current_fee() {
                if self.verified_via_decide_id.contains_key(&to) {
                    self.eligible_for_lottery.insert(to, ());
                }
            }

            self.shares.insert(to, (share, reward));

            info.note_migrated(caller);

            Ok(())
        } else {
            Err(String::from("No entry found"))
        }
    }

    pub fn mint_share(&mut self, qty: TCycles, to: Principal) {
        // add new share to the account
        let cur_opt = self.shares.get(&to);
        let mut info = self.get_info();

        let (share, unclaimed_reward) = if let Some((mut cur_share, cur_unclaimed_reward)) = cur_opt
        {
            cur_share += &qty;

            (cur_share, cur_unclaimed_reward)
        } else {
            (qty.clone(), E8s::zero())
        };

        // allow the pool member to participate in the lottery
        if &share >= &BurnerStateInfo::get_current_fee() {
            if self.verified_via_decide_id.contains_key(&to) {
                self.eligible_for_lottery.insert(to, ());
            }
        }

        self.shares.insert(to, (share, unclaimed_reward));

        // adjust total share supply
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

    // returns true if the round is complete
    pub fn lottery_round(&mut self) -> bool {
        if self.eligible_for_lottery.is_empty() {
            return false;
        }

        let info = self.get_info();

        let cur_reward = &info.current_burn_token_reward / E8s::two(); // only distribute half the block via the lottery

        let winner_idx = info.current_winning_idx(self.eligible_for_lottery.len());

        // we don't split lottery in batches in hope that "skip" will scale well even on high numbers of participants
        let (winner, _) = self
            .eligible_for_lottery
            .iter()
            .skip(winner_idx as usize)
            .next()
            .expect("The lottery winner should be found");

        let (share, unclaimed_reward) = self
            .shares
            .get(&winner)
            .expect("The lottery winner should have a share!");

        self.shares
            .insert(winner, (share, unclaimed_reward + cur_reward));

        true
    }

    // return true if the round has completed
    pub fn pos_round_batch(&mut self, lottery_round_complete: bool, batch_size: u64) -> bool {
        // only run the protocol if someone is minting
        if self.shares.len() == 0 {
            return true;
        }

        let mut info = self.get_info();

        let mut iter = if let Some(id) = info.next_burner_id {
            let mut i = self.shares.range(&id..);
            i.next();

            i
        } else {
            self.shares.iter()
        };

        let fee = BurnerStateInfo::get_current_fee();

        let mut cur_reward = info
            .current_burn_token_reward
            .clone()
            .to_dynamic()
            .to_decimals(12)
            .to_const();

        if lottery_round_complete {
            cur_reward /= ECs::<12>::two(); // only distribute half the block via the pool shares
        }

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

                if new_share < fee {
                    self.eligible_for_lottery.remove(&account);
                }

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

    pub fn verify_decide_id(
        &mut self,
        jwt: &str,
        caller: Principal,
        now: TimestampNs,
    ) -> Result<(), String> {
        if self.verified_via_decide_id.contains_key(&caller) {
            return Err(String::from("Already verified"));
        }

        verify_decide_id_proof(jwt, caller, now as u128)?;

        self.verified_via_decide_id.insert(caller, ());

        if let Some((share, _)) = self.shares.get(&caller) {
            if share >= BurnerStateInfo::get_current_fee() {
                self.eligible_for_lottery.insert(caller, ());
            }
        }

        Ok(())
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

        let fee = BurnerStateInfo::get_current_fee();
        let mut entries = Vec::new();
        let mut i = 0;

        loop {
            if let Some((account, (share, unclaimed_reward))) = iter.next() {
                if share < fee {
                    continue;
                }

                let is_lottery_participant = self.eligible_for_lottery.contains_key(&account);

                entries.push((account, share, unclaimed_reward, is_lottery_participant));
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

    pub fn get_total_verified_accounts(&self) -> u32 {
        self.verified_via_decide_id.len() as u32
    }

    pub fn get_totals(&self, caller: &Principal) -> GetTotalsResponse {
        let info = self.get_info();
        let fee = BurnerStateInfo::get_current_fee();
        let (share, unclaimed_reward) = self.shares.get(caller).unwrap_or_default();
        let verified_via_decide_id = self.verified_via_decide_id.contains_key(caller);
        let eligible_for_lottery = self.eligible_for_lottery.contains_key(caller);

        GetTotalsResponse {
            total_share_supply: info.total_shares_supply,
            total_tcycles_burned: info.total_tcycles_burned,
            total_burn_token_minted: info.total_burn_token_minted,
            current_burn_token_reward: info.current_burn_token_reward,
            pos_start_key: info.next_burner_id,
            current_pos_round: info.current_pos_round,
            pos_round_delay_ns: info.pos_round_delay_ns,
            current_share_fee: fee,

            total_burners: self.shares.len(),
            total_verified_accounts: self.verified_via_decide_id.len(),
            total_lottery_participants: self.eligible_for_lottery.len(),

            your_share_tcycles: share,
            your_unclaimed_reward_e8s: unclaimed_reward,
            your_decide_id_verification_status: verified_via_decide_id,
            your_lottery_eligibility_status: eligible_for_lottery,
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
