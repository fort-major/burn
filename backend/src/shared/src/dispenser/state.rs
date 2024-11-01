use candid::{Nat, Principal};

use ic_e8s::d::EDs;
use ic_stable_structures::{Cell, StableBTreeMap};
use num_bigint::BigUint;

use crate::burner::types::{Memory, TCycles, TimestampNs};

use super::{
    api::{
        CancelDistributionRequest, CancelDistributionResponse, CreateDistributionRequest,
        CreateDistributionResponse, FurnaceTriggerDistributionRequest,
        FurnaceTriggerDistributionResponse, GetDistributionsRequest, GetDistributionsResponse,
        WithdrawCanceledRequest,
    },
    types::{
        CurrentDistributionInfo, DispenserInfo, Distribution, DistributionId, DistributionScheme,
        DistributionStartCondition, DistributionStatus,
    },
};

pub struct DispenserState {
    pub common_pool_members: StableBTreeMap<Principal, EDs, Memory>,
    pub kamikaze_pool_members: StableBTreeMap<Principal, EDs, Memory>,
    pub bonfire_pool_members: StableBTreeMap<Principal, EDs, Memory>,

    pub unclaimed_tokens: StableBTreeMap<Principal, EDs, Memory>,

    pub scheduled_distributions: StableBTreeMap<DistributionId, Distribution, Memory>,
    pub active_distributions: StableBTreeMap<DistributionId, Distribution, Memory>,
    pub past_distributions: StableBTreeMap<DistributionId, Distribution, Memory>,

    pub dispenser_info: Cell<DispenserInfo, Memory>,
    pub current_distribution_info: Cell<CurrentDistributionInfo, Memory>,
}

impl DispenserState {
    pub fn furnace_trigger_distribution(
        &mut self,
        req: FurnaceTriggerDistributionRequest,
    ) -> FurnaceTriggerDistributionResponse {
        let mut distribution = self
            .scheduled_distributions
            .get(&req.distribution_id)
            .unwrap();

        distribution.start_condition = DistributionStartCondition::AtTickDelay(1);

        self.scheduled_distributions
            .insert(req.distribution_id, distribution);

        FurnaceTriggerDistributionResponse {}
    }

    pub fn claim_tokens(&mut self, caller: Principal, qty: EDs) {
        let prev_val = self
            .unclaimed_tokens
            .get(&caller)
            .unwrap_or_default()
            .to_decimals(self.get_dispenser_info().token_decimals);

        self.unclaimed_tokens.insert(caller, prev_val - qty);
    }

    pub fn revert_claim_tokens(&mut self, caller: Principal, qty: EDs) {
        let prev_val = self
            .unclaimed_tokens
            .get(&caller)
            .unwrap_or_default()
            .to_decimals(self.get_dispenser_info().token_decimals);

        self.unclaimed_tokens.insert(caller, prev_val + qty);
    }

    /// returns true if should reschedule
    pub fn dispense_kamikaze_batch(&mut self, batch_size: u64) -> bool {
        if self.kamikaze_pool_members.is_empty() {
            return false;
        }

        let mut distribution_info = self.get_current_distribution_info();

        let current_distribution_id = if let Some(id) = distribution_info.distribution_id {
            id
        } else {
            // if no distribution is set, skip
            return false;
        };

        let mut distribution = self
            .active_distributions
            .get(&current_distribution_id)
            .unwrap();

        let mut info = self.get_dispenser_info();

        let cur_tick_reward_opt = distribution.get_cur_tick_reward(info.token_fee.clone());
        if cur_tick_reward_opt.is_none() {
            return false;
        }

        let mut iter = if let Some(cursor) = distribution_info.kamikaze_pool_cursor {
            let mut iter = self.kamikaze_pool_members.range(cursor..);
            iter.next();

            iter
        } else {
            self.kamikaze_pool_members.iter()
        };

        let random_number = if let Some(n) = distribution_info.kamikaze_random_number.clone() {
            n
        } else {
            let n = info.generate_random_number();
            distribution_info.kamikaze_random_number = Some(n.clone());

            n
        };

        let mut counter = if let Some(c) = distribution_info.kamikaze_pool_counter.clone() {
            c
        } else {
            TCycles::zero()
        };

        let mut i = 0;

        let should_reschedule = loop {
            let entry = iter.next();

            if entry.is_none() {
                iter = self.kamikaze_pool_members.iter();
                continue;
            }

            let (pid, weight) = entry.map(|(p, e)| (p, e.to_const())).unwrap();

            counter += weight / &info.total_kamikaze_pool_members_weight;
            distribution_info.common_pool_cursor = Some(pid);

            if counter >= random_number {
                let unclaimed_reward = self
                    .unclaimed_tokens
                    .get(&pid)
                    .unwrap_or_default()
                    .to_decimals(info.token_decimals);

                let kamikaze_pool_reward = if distribution.distribute_to_bonfire {
                    cur_tick_reward_opt.unwrap()
                        * EDs::new(BigUint::from(3333_3333u64), 8).to_decimals(info.token_decimals)
                } else {
                    cur_tick_reward_opt.unwrap()
                        * EDs::new(BigUint::from(5000_0000u64), 8).to_decimals(info.token_decimals)
                };

                self.unclaimed_tokens
                    .insert(pid, unclaimed_reward + &kamikaze_pool_reward);

                distribution.leftover_qty -= &kamikaze_pool_reward;
                info.total_distributed += Nat(kamikaze_pool_reward.val);

                break false;
            }

            i += 1;
            if i == batch_size {
                break true;
            }
        };

        distribution_info.kamikaze_pool_counter = Some(counter);

        if !should_reschedule {
            distribution_info.kamikaze_pool_cursor = None;
            distribution_info.kamikaze_pool_counter = None;
            distribution_info.kamikaze_random_number = None;
        }

        self.active_distributions
            .insert(distribution.id, distribution);
        self.set_current_distribution_info(distribution_info);
        self.set_dispenser_info(info);

        should_reschedule
    }

    /// returns true if should reschedule
    pub fn dispense_common_batch(&mut self, batch_size: u64) -> bool {
        if self.common_pool_members.is_empty() {
            return false;
        }

        let mut distribution_info = self.get_current_distribution_info();

        let current_distribution_id = if let Some(id) = distribution_info.distribution_id {
            id
        } else {
            // if no distribution is set, skip
            return false;
        };

        let mut distribution = self
            .active_distributions
            .get(&current_distribution_id)
            .unwrap();

        let mut info = self.get_dispenser_info();

        let cur_tick_reward_opt = distribution.get_cur_tick_reward(info.token_fee.clone());
        if cur_tick_reward_opt.is_none() {
            return false;
        }

        let mut iter = if let Some(cursor) = distribution_info.common_pool_cursor {
            let mut iter = self.common_pool_members.range(cursor..);
            iter.next();

            iter
        } else {
            self.common_pool_members.iter()
        };

        let common_pool_reward = if distribution.distribute_to_bonfire {
            cur_tick_reward_opt.unwrap()
                * EDs::new(BigUint::from(3333_3333u64), 8).to_decimals(info.token_decimals)
        } else {
            cur_tick_reward_opt.unwrap()
                * EDs::new(BigUint::from(5000_0000u64), 8).to_decimals(info.token_decimals)
        };

        let mut i = 0;

        let should_reschedule = loop {
            let entry = iter.next();

            // if reached the end of the list, store both info entries and return false
            if entry.is_none() {
                break false;
            }

            let (pid, weight) = entry.map(|(p, e)| (p, e.to_const())).unwrap();
            let new_reward = (weight / &info.total_common_pool_members_weight)
                .to_dynamic()
                .to_decimals(common_pool_reward.decimals)
                * &common_pool_reward;

            let unclaimed_reward = self
                .unclaimed_tokens
                .get(&pid)
                .unwrap_or_default()
                .to_decimals(info.token_decimals);

            self.unclaimed_tokens
                .insert(pid, unclaimed_reward + &new_reward);

            distribution.leftover_qty -= &new_reward;
            info.total_distributed += Nat(new_reward.val);

            distribution_info.common_pool_cursor = Some(pid);

            i += 1;
            if i == batch_size {
                break true;
            }
        };

        if !should_reschedule {
            distribution_info.common_pool_cursor = None;
        }

        self.active_distributions
            .insert(distribution.id, distribution);
        self.set_current_distribution_info(distribution_info);
        self.set_dispenser_info(info);

        should_reschedule
    }

    /// returns true if should reschedule
    pub fn dispense_bonfire_batch(&mut self, batch_size: u64) -> bool {
        if self.bonfire_pool_members.is_empty() {
            return false;
        }

        let mut distribution_info = self.get_current_distribution_info();

        let current_distribution_id = if let Some(id) = distribution_info.distribution_id {
            id
        } else {
            // if no distribution is set, skip
            return false;
        };

        let mut distribution = self
            .active_distributions
            .get(&current_distribution_id)
            .unwrap();

        if !distribution.distribute_to_bonfire {
            return false;
        }

        let mut info = self.get_dispenser_info();

        let cur_tick_reward_opt = distribution.get_cur_tick_reward(info.token_fee.clone());
        if cur_tick_reward_opt.is_none() {
            return false;
        }

        let mut iter = if let Some(cursor) = distribution_info.bonfire_pool_cursor {
            let mut iter = self.bonfire_pool_members.range(cursor..);
            iter.next();

            iter
        } else {
            self.bonfire_pool_members.iter()
        };

        let bonfire_pool_reward = cur_tick_reward_opt.unwrap()
            * EDs::new(BigUint::from(3333_3333u64), 8).to_decimals(info.token_decimals);
        let mut i = 0;

        let should_reschedule = loop {
            let entry = iter.next();

            // if reached the end of the list, store both info entries and return false
            if entry.is_none() {
                break false;
            }

            let (pid, weight) = entry.map(|(p, e)| (p, e.to_const())).unwrap();
            let new_reward = (weight / &info.total_bonfire_pool_members_weight)
                .to_dynamic()
                .to_decimals(bonfire_pool_reward.decimals)
                * &bonfire_pool_reward;

            let unclaimed_reward = self
                .unclaimed_tokens
                .get(&pid)
                .unwrap_or_default()
                .to_decimals(info.token_decimals);

            self.unclaimed_tokens
                .insert(pid, unclaimed_reward + &new_reward);

            distribution.leftover_qty -= &new_reward;
            info.total_distributed += Nat(new_reward.val);

            distribution_info.bonfire_pool_cursor = Some(pid);

            i += 1;
            if i == batch_size {
                break true;
            }
        };

        if !should_reschedule {
            distribution_info.bonfire_pool_cursor = None;
        }

        self.active_distributions
            .insert(distribution.id, distribution);
        self.set_current_distribution_info(distribution_info);
        self.set_dispenser_info(info);

        should_reschedule
    }

    pub fn find_next_active_distribution(&mut self) -> bool {
        let mut distribution_info = self.get_current_distribution_info();

        let mut iter = if let Some(id) = distribution_info.distribution_id {
            let mut iter = self.active_distributions.range(id..);
            iter.next();

            iter
        } else {
            self.active_distributions.iter()
        };

        let entry = iter.next();
        if entry.is_none() {
            return false;
        }

        let (id, _) = entry.unwrap();

        distribution_info.distribution_id = Some(id);
        self.set_current_distribution_info(distribution_info);

        true
    }

    pub fn complete_active_distributions_batch(&mut self, batch_size: u64) -> bool {
        let mut distribution_info = self.get_current_distribution_info();

        let mut iter = if let Some(id) = distribution_info.distribution_id {
            self.active_distributions.range(id..)
        } else {
            self.active_distributions.iter()
        };

        let info = self.get_dispenser_info();
        let mut distributions_to_remove = Vec::new();

        let mut i = 0;
        let should_reschedule = loop {
            let entry = iter.next();
            if entry.is_none() {
                break false;
            }

            let (id, mut distribution) = entry.unwrap();

            distribution_info.distribution_id = Some(id);

            let is_complete_now = distribution.try_complete(info.token_fee.clone());

            if is_complete_now {
                distributions_to_remove.push(id);
                self.past_distributions.insert(id, distribution);
            }

            i += 1;
            if i == batch_size {
                break true;
            }
        };

        for id in distributions_to_remove {
            self.active_distributions.remove(&id);
        }

        if !should_reschedule {
            distribution_info.distribution_id = None;
        }

        self.set_current_distribution_info(distribution_info);

        should_reschedule
    }

    pub fn activate_scheduled_distributions_batch(&mut self, batch_size: u64) -> bool {
        let mut distribution_info = self.get_current_distribution_info();

        let mut iter = if let Some(id) = distribution_info.distribution_id {
            self.scheduled_distributions.range(id..)
        } else {
            self.scheduled_distributions.iter()
        };

        let mut distributions_to_activate = Vec::new();

        let mut i = 0;
        let should_reschedule = loop {
            let entry = iter.next();
            if entry.is_none() {
                break false;
            }

            let (id, mut distribution) = entry.unwrap();

            distribution_info.distribution_id = Some(id);

            let is_active_now = distribution.try_activate();

            if is_active_now {
                distributions_to_activate.push(id);
                self.active_distributions.insert(id, distribution);
            }

            i += 1;
            if i == batch_size {
                break true;
            }
        };

        for id in distributions_to_activate {
            self.scheduled_distributions.remove(&id);
        }

        if !should_reschedule {
            distribution_info.distribution_id = None;
        }

        self.set_current_distribution_info(distribution_info);

        should_reschedule
    }

    pub fn complete_tick(&mut self, now: TimestampNs) {
        self.common_pool_members.clear_new();
        self.kamikaze_pool_members.clear_new();

        self.set_current_distribution_info(CurrentDistributionInfo::default());

        let mut info = self.get_dispenser_info();
        info.complete_round(now);
        self.set_dispenser_info(info);
    }

    pub fn create_distribution(
        &mut self,
        mut req: CreateDistributionRequest,
        caller: Principal,
    ) -> CreateDistributionResponse {
        let mut info = self.get_dispenser_info();
        let id = info.generate_distribution_id();

        let cur_reward = match &req.scheme {
            DistributionScheme::Linear => req.qty.clone() / Nat::from(req.duration_ticks),
            DistributionScheme::Logarithmic => unreachable!(),
        };

        let status = match &mut req.start_condition {
            DistributionStartCondition::AtTickDelay(d) => {
                if *d == 0 {
                    *d = 1;
                }
                DistributionStatus::Scheduled
            }
            _ => DistributionStatus::Scheduled,
        };

        let distribution = Distribution {
            id,
            owner: caller,
            name: req.name,

            start_condition: req.start_condition,
            duration_ticks: req.duration_ticks,
            scheme: req.scheme,
            status,

            cur_tick_reward: EDs::new(cur_reward.0, info.token_decimals),

            scheduled_qty: EDs::new(req.qty.0.clone(), info.token_decimals),
            leftover_qty: EDs::new(req.qty.0, info.token_decimals),

            hidden: req.hidden,
            distribute_to_bonfire: req.distribute_to_bonfire,
        };

        self.set_dispenser_info(info);

        if matches!(status, DistributionStatus::InProgress) {
            self.active_distributions.insert(id, distribution);
        } else {
            self.scheduled_distributions.insert(id, distribution);
        }

        CreateDistributionResponse {
            distribution_id: id,
        }
    }

    pub fn cancel_distribution(
        &mut self,
        req: CancelDistributionRequest,
    ) -> CancelDistributionResponse {
        let mut distribution = self
            .scheduled_distributions
            .remove(&req.distribution_id)
            .unwrap();

        distribution.status = DistributionStatus::Canceled;

        self.past_distributions
            .insert(req.distribution_id, distribution);

        CancelDistributionResponse {}
    }

    pub fn withdraw_canceled(&mut self, req: WithdrawCanceledRequest) {
        let mut distribution = self.past_distributions.get(&req.distribution_id).unwrap();

        let info = self.get_dispenser_info();
        let qty_eds = EDs::new(req.qty.0, info.token_decimals);

        distribution.leftover_qty -= qty_eds;

        self.past_distributions
            .insert(req.distribution_id, distribution);
    }

    pub fn revert_withdraw_canceled(&mut self, req: WithdrawCanceledRequest) {
        let mut distribution = self.past_distributions.get(&req.distribution_id).unwrap();

        let info = self.get_dispenser_info();
        let qty_eds = EDs::new((req.qty - info.token_fee).0, info.token_decimals);

        distribution.leftover_qty += qty_eds;

        self.past_distributions
            .insert(req.distribution_id, distribution);
    }

    pub fn get_distribution(&self, id: DistributionId) -> Option<Distribution> {
        let mut d = self.active_distributions.get(&id);

        if d.is_none() {
            d = self.scheduled_distributions.get(&id);
        }

        if d.is_none() {
            d = self.past_distributions.get(&id);
        }

        d.map(|it| it.try_to_hidden())
    }

    pub fn get_distributions(&self, req: GetDistributionsRequest) -> GetDistributionsResponse {
        let col = match req.status {
            DistributionStatus::Scheduled => &self.scheduled_distributions,
            DistributionStatus::InProgress => &self.active_distributions,
            _ => &self.past_distributions,
        };

        let mut iter = if let Some(id) = req.skip {
            col.range(&id..)
        } else {
            col.iter()
        };

        let mut result = Vec::new();

        let mut i = 0;
        loop {
            let entry = iter.next();
            if entry.is_none() {
                break;
            }

            let (_, d) = entry.unwrap();

            result.push(d.try_to_hidden());

            i += 1;
            if i >= req.take {
                break;
            }
        }

        GetDistributionsResponse {
            distributions: result,
        }
    }

    pub fn init(&mut self, seed: Vec<u8>, token_decimals: u8, token_fee: Nat, now: TimestampNs) {
        let mut info = self.get_dispenser_info();
        info.init(seed, token_decimals, token_fee, now);

        self.set_dispenser_info(info);
    }

    pub fn get_dispenser_info(&self) -> DispenserInfo {
        self.dispenser_info.get().clone()
    }

    pub fn set_dispenser_info(&mut self, info: DispenserInfo) {
        self.dispenser_info
            .set(info)
            .expect("Unable to store dispenser info");
    }

    pub fn get_current_distribution_info(&self) -> CurrentDistributionInfo {
        self.current_distribution_info.get().clone()
    }

    pub fn set_current_distribution_info(&mut self, info: CurrentDistributionInfo) {
        self.current_distribution_info
            .set(info)
            .expect("Unable to store distribution info");
    }
}
