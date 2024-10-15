

use candid::{decode_one, encode_one, Principal};
use ic_e8s::c::{E8s, ECs};
use ic_stable_structures::{storable::Bound, Cell, StableBTreeMap, Storable};



use super::{
    api::{
        BurnerInfo, GetBurnersRequest, GetBurnersResponse, GetKamikazesRequest,
        GetKamikazesResponse, GetTotalsResponse, KamikazeInfo,
    },
    types::{
        BurnerStateInfo, Memory, TCycles, TimestampNs, KAMIKAZE_POOL_POSITION_LIFESPAN_NS,
        TCYCLE_POS_ROUND_BASE_FEE,
    },
};

pub struct BurnerState {
    pub shares: StableBTreeMap<Principal, (TCycles, E8s), Memory>,

    pub kamikaze_shares: StableBTreeMap<Principal, (TCycles, u64), Memory>,
    pub kamikaze_rounds_won: StableBTreeMap<Principal, u64, Memory>,

    pub verified_via_decide_id: StableBTreeMap<Principal, (), Memory>,
    pub eligible_for_lottery: StableBTreeMap<Principal, (), Memory>,
    pub lottery_rounds_won: StableBTreeMap<Principal, u64, Memory>,

    pub info: Cell<BurnerStateInfo, Memory>,
}

impl BurnerState {
    pub fn init(&mut self, seed: Vec<u8>) {
        let mut info = self.get_info();

        info.init(seed);

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

            self.set_info(info);

            Ok(())
        } else {
            Err(String::from("No entry found"))
        }
    }

    pub fn mint_kamikaze_share(&mut self, qty: TCycles, to: Principal, now: TimestampNs) {
        // add new share to the account
        let cur_opt = self.kamikaze_shares.get(&to);
        let mut info = self.get_info();

        let (share, created_at) = if let Some((mut cur_share, created_at)) = cur_opt {
            cur_share += &qty;

            (cur_share, created_at)
        } else {
            (qty.clone(), now)
        };

        self.kamikaze_shares.insert(to, (share, created_at));

        // adjust total share supply
        info.total_shares_supply += &qty;
        info.kamikaze_pool_total_shares =
            Some(info.kamikaze_pool_total_shares.unwrap_or_default() + qty);

        self.set_info(info);
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

    // returns true if any winner was determined
    /*     pub fn lottery_round(&mut self) -> bool {
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

        let rounds_won = self.lottery_rounds_won.get(&winner).unwrap_or_default();
        self.lottery_rounds_won.insert(winner, rounds_won + 1);

        true
    } */

    // returns Some(true) if should be rescheduled, returns Some(false) if round completed, returns None if nobody is in the pool
    pub fn kamikaze_round_batch(&mut self, batch_size: u64) -> Option<bool> {
        // only run the protocol if someone is minting
        if self.kamikaze_shares.len() == 0 {
            return None;
        }

        let mut info = self.get_info();

        let mut iter = if let Some(id) = info.next_kamikaze_id {
            let mut i = self.kamikaze_shares.range(&id..);
            i.next();

            i
        } else {
            self.kamikaze_shares.iter()
        };

        let random_number = if let Some(random_number) = info.kamikaze_pool_random_number.clone() {
            random_number
        } else {
            let n = info.generate_random_number();
            info.kamikaze_pool_random_number = Some(n.clone());

            n
        };

        let mut counter = info.kamikaze_pool_counter.unwrap_or_default();

        let total_shares = info
            .kamikaze_pool_total_shares
            .clone()
            .expect("Total shares should be present");

        let mut i: u64 = 0;

        let should_reschedule = loop {
            let (pid, (share, _)) = iter.next().expect("The winner should be found!");

            counter += share / &total_shares;
            info.next_kamikaze_id = Some(pid);

            if counter >= random_number {
                let cur_reward = &info.current_burn_token_reward / E8s::two(); // only distribute half the block via the lottery
                let (common_pool_shares, unclaimed_reward) =
                    self.shares.get(&pid).unwrap_or_default();

                self.shares
                    .insert(pid, (common_pool_shares, unclaimed_reward + cur_reward));

                let prev_rounds_won = self.kamikaze_rounds_won.get(&pid).unwrap_or_default();
                self.kamikaze_rounds_won.insert(pid, prev_rounds_won + 1);

                break false;
            }

            i += 1;

            if i == batch_size {
                break true;
            }
        };

        if should_reschedule {
            info.kamikaze_pool_counter = Some(counter);
        } else {
            info.next_kamikaze_id = None;
            info.kamikaze_pool_counter = None;
            info.kamikaze_pool_random_number = None;
        }

        self.set_info(info);

        Some(should_reschedule)
    }

    pub fn kamikaze_harakiri_batch(&mut self, now: TimestampNs, batch_size: u64) -> bool {
        // only run the protocol if someone is minting
        if self.kamikaze_shares.len() == 0 {
            return false;
        }

        let mut info = self.get_info();

        let mut iter = if let Some(id) = info.next_kamikaze_id {
            let mut i = self.kamikaze_shares.range(&id..);
            i.next();

            i
        } else {
            self.kamikaze_shares.iter()
        };

        let mut kamikaze_total_supply = info
            .kamikaze_pool_total_shares
            .expect("Total supply should be set");

        let mut positions_to_remove = Vec::new();
        let mut i = 0;

        let should_reschedule = loop {
            let entry = iter.next();
            if entry.is_none() {
                break false;
            }

            let (pid, (shares, created_at)) = entry.unwrap();

            info.next_kamikaze_id = Some(pid);

            if now - created_at >= KAMIKAZE_POOL_POSITION_LIFESPAN_NS {
                kamikaze_total_supply -= shares;
                positions_to_remove.push(pid);
            }

            i += 1;
            if i == batch_size {
                break true;
            }
        };

        for pid in positions_to_remove {
            self.kamikaze_shares.remove(&pid);
        }

        info.kamikaze_pool_total_shares = Some(kamikaze_total_supply);

        if !should_reschedule {
            info.next_kamikaze_id = None;
        }

        self.set_info(info);

        should_reschedule
    }

    // return true if the round has completed
    pub fn pos_round_batch(&mut self, split_reward_in_half: bool, batch_size: u64) -> bool {
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

        if split_reward_in_half {
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

    /*     pub fn verify_decide_id(
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
    } */

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
                let rounds_won = self.lottery_rounds_won.get(&account).unwrap_or_default();

                let entry = BurnerInfo {
                    pid: account,
                    share,
                    unclaimed_reward,
                    is_lottery_participant,
                    lottery_rounds_won: rounds_won,
                };

                entries.push(entry);
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

    pub fn get_kamikazes(&self, req: GetKamikazesRequest) -> GetKamikazesResponse {
        let mut iter = if let Some(start_from) = req.start {
            let mut i = self.kamikaze_shares.range(&start_from..);
            i.next();
            i
        } else {
            self.kamikaze_shares.iter()
        };

        let mut entries = Vec::new();
        let mut i = 0;

        loop {
            let entry = iter.next();
            if entry.is_none() {
                break;
            }

            let (pid, (share, created_at)) = entry.unwrap();

            let rounds_won = self.kamikaze_rounds_won.get(&pid).unwrap_or_default();

            let entry = KamikazeInfo {
                pid,
                share,
                created_at,
                rounds_won,
            };

            entries.push(entry);
            i += 1;

            if i == req.take {
                break;
            }
        }

        GetKamikazesResponse { entries }
    }

    pub fn get_total_verified_accounts(&self) -> u32 {
        self.verified_via_decide_id.len() as u32
    }

    pub fn get_totals(&self, caller: &Principal) -> GetTotalsResponse {
        let info = self.get_info();
        let fee = BurnerStateInfo::get_current_fee();
        let is_lottery_enabled = info.is_lottery_enabled();

        let (share, unclaimed_reward) = self.shares.get(caller).unwrap_or_default();
        let verified_via_decide_id = self.verified_via_decide_id.contains_key(caller);
        let eligible_for_lottery = self.eligible_for_lottery.contains_key(caller);
        let icp_to_cycles_exchange_rate = info.get_icp_to_cycles_exchange_rate();

        let (kamikaze_share, kamikaze_created_at) = self
            .kamikaze_shares
            .get(caller)
            .map(|(share, created_at)| (share, Some(created_at)))
            .unwrap_or((TCycles::zero(), None));

        GetTotalsResponse {
            total_share_supply: info.total_shares_supply,
            total_tcycles_burned: info.total_tcycles_burned,
            total_burn_token_minted: info.total_burn_token_minted,
            current_burn_token_reward: info.current_burn_token_reward,
            pos_start_key: info.next_burner_id,
            current_pos_round: info.current_pos_round,
            pos_round_delay_ns: info.pos_round_delay_ns,
            current_share_fee: fee,
            is_lottery_enabled,

            total_burners: self.shares.len() + self.kamikaze_shares.len(),
            total_verified_accounts: self.verified_via_decide_id.len(),
            total_lottery_participants: self.eligible_for_lottery.len(),

            icp_to_cycles_exchange_rate,
            total_kamikaze_pool_supply: info.kamikaze_pool_total_shares.unwrap_or_default(),

            your_share_tcycles: share,
            your_kamikaze_share_tcycles: kamikaze_share,
            your_kamikaze_position_created_at: kamikaze_created_at,
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
