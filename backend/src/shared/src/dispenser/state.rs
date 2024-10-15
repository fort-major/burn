use candid::{Nat, Principal};
use ic_e8s::d::EDs;
use ic_stable_structures::{Cell, StableBTreeMap};


use crate::burner::types::{Memory, TCycles, TimestampNs};

use super::{
    api::{CreateDistributionRequest, CreateDistributionResponse},
    types::{
        CurrentDistributionInfo, DispenserInfo, DistributionId, DistributionScheme,
        ScheduledDistribution,
    },
};

pub struct DispenserState {
    pub common_pool_members: StableBTreeMap<Principal, TCycles, Memory>,
    pub kamikaze_pool_members: StableBTreeMap<Principal, TCycles, Memory>,

    pub unclaimed_tokens: StableBTreeMap<Principal, EDs, Memory>,

    pub distributions: StableBTreeMap<DistributionId, ScheduledDistribution, Memory>,

    pub dispenser_info: Cell<DispenserInfo, Memory>,
    pub current_distribution_info: Cell<CurrentDistributionInfo, Memory>,
}

impl DispenserState {
    // TODO: instead of fetching total weights, calculate them locally

    /// returns true if should reschedule
    pub fn dispense_kamikaze_batch(&mut self, batch_size: u64) -> bool {
        let mut distribution_info = self.get_current_distribution_info();

        let current_distribution_id = if let Some(id) = distribution_info.distribution_id {
            id
        } else {
            // if no distribution is set, skip
            return false;
        };

        let distribution = self.distributions.get(&current_distribution_id).unwrap();

        let mut info = self.get_dispenser_info();

        // only half goes to the common pool
        let kamikaze_pool_reward = distribution.cur_tick_reward / EDs::two(info.token_decimals);

        // if nobody is in the pool, simply mark the distributed tokens for burning
        if self.kamikaze_pool_members.is_empty() {
            info.tokens_to_burn += kamikaze_pool_reward;

            self.set_dispenser_info(info);

            return false;
        }

        let mut iter = if let Some(cursor) = distribution_info.kamikaze_pool_cursor {
            let mut iter = self.kamikaze_pool_members.range(cursor..);
            iter.next();

            iter
        } else {
            self.kamikaze_pool_members.iter()
        };

        let random_number = if let Some(n) = distribution_info.kamikaze_random_number {
            n
        } else {
            info.generate_random_number()
        };

        let mut counter = if let Some(c) = distribution_info.kamikaze_pool_counter {
            c
        } else {
            TCycles::zero()
        };

        let mut i = 0;

        let should_reschedule = loop {
            let (pid, weight) = iter
                .next()
                .expect("The winner should be found before the end of the list");

            distribution_info.common_pool_cursor = Some(pid);
            counter += weight / &info.total_kamikaze_pool_members_weight;

            if counter >= random_number {
                let unclaimed_reward = self.unclaimed_tokens.get(&pid).unwrap_or_default();

                self.unclaimed_tokens
                    .insert(pid, unclaimed_reward + kamikaze_pool_reward);

                break false;
            }

            i += 1;
            if i == batch_size {
                break true;
            }
        };

        distribution_info.kamikaze_pool_counter = Some(counter);
        distribution_info.kamikaze_random_number = Some(random_number);

        self.set_current_distribution_info(distribution_info);
        self.set_dispenser_info(info);

        should_reschedule
    }

    /// returns true if should reschedule
    pub fn dispense_common_batch(&mut self, batch_size: u64) -> bool {
        let mut distribution_info = self.get_current_distribution_info();

        let current_distribution_id = if let Some(id) = distribution_info.distribution_id {
            id
        } else {
            // if no distribution is set, skip
            return false;
        };

        let distribution = self.distributions.get(&current_distribution_id).unwrap();

        let mut info = self.get_dispenser_info();

        // only half goes to the common pool
        let common_pool_reward = distribution.cur_tick_reward / EDs::two(info.token_decimals);

        // if nobody is in the pool, simply mark the distributed tokens for burning
        if self.common_pool_members.is_empty() {
            info.tokens_to_burn += common_pool_reward;

            self.set_dispenser_info(info);

            return false;
        }

        let mut iter = if let Some(cursor) = distribution_info.common_pool_cursor {
            let mut iter = self.common_pool_members.range(cursor..);
            iter.next();

            iter
        } else {
            self.common_pool_members.iter()
        };

        let mut i = 0;

        let should_reschedule = loop {
            let entry = iter.next();

            // if reached the end of the list, store both info entries and return false
            if entry.is_none() {
                break false;
            }

            let (pid, weight) = entry.unwrap();
            let new_reward = (weight / &info.total_common_pool_members_weight)
                .to_dynamic()
                .to_decimals(common_pool_reward.decimals)
                * &common_pool_reward;

            let unclaimed_reward = self.unclaimed_tokens.get(&pid).unwrap_or_default();

            self.unclaimed_tokens
                .insert(pid, unclaimed_reward + new_reward);

            distribution_info.common_pool_cursor = Some(pid);

            i += 1;
            if i == batch_size {
                break true;
            }
        };

        self.set_current_distribution_info(distribution_info);
        self.set_dispenser_info(info);

        should_reschedule
    }

    // return Some(true) if should be rescheduled, return Some(false) if distribution is found, return None if no active distributions left
    pub fn find_next_active_distribution(&mut self, batch_size: u64) -> Option<bool> {
        let mut distribution_info = self.get_current_distribution_info();
        let info = self.get_dispenser_info();

        let mut iter = if let Some(id) = distribution_info.distribution_id {
            let mut iter = self.distributions.range(id..);
            iter.next();

            iter
        } else {
            self.distributions.iter()
        };

        let mut i = 0;
        let result = loop {
            let entry = iter.next();
            if entry.is_none() {
                break None;
            }

            let (id, distribution) = entry.unwrap();

            distribution_info.distribution_id = Some(id);

            if distribution.start_at_tick <= info.cur_tick {
                break Some(false);
            }

            i += 1;
            if i == batch_size {
                break Some(true);
            }
        };

        self.set_current_distribution_info(distribution_info);

        result
    }

    /// precondition - the provided id points to an active existing distribution
    pub fn try_complete_active_distribution(&mut self) {
        let id = if let Some(id) = self.get_current_distribution_info().distribution_id {
            id
        } else {
            return;
        };
        let distribution = if let Some(d) = self.distributions.get(&id) {
            d
        } else {
            return;
        };

        let info = self.get_dispenser_info();

        if distribution.start_at_tick + distribution.duration_ticks - 1 == info.cur_tick {
            self.distributions.remove(&id);

            return;
        }

        self.distributions.insert(id, distribution);
    }

    pub fn complete_tick(&mut self, now: TimestampNs) {
        let mut cur_distribution_info = self.get_current_distribution_info();

        cur_distribution_info.distribution_id = None;
        cur_distribution_info.common_pool_cursor = None;
        cur_distribution_info.kamikaze_pool_cursor = None;
        cur_distribution_info.kamikaze_pool_counter = None;
        cur_distribution_info.kamikaze_random_number = None;

        self.set_current_distribution_info(cur_distribution_info);

        let mut info = self.get_dispenser_info();
        info.complete_round(now);
        self.set_dispenser_info(info);
    }

    pub fn create_distribution(
        &mut self,
        req: CreateDistributionRequest,
        caller: Principal,
    ) -> CreateDistributionResponse {
        let mut info = self.get_dispenser_info();
        let id = info.generate_distribution_id();

        let cur_reward = match &req.scheme {
            DistributionScheme::Linear => req.qty.clone() / Nat::from(req.duration_ticks),
            DistributionScheme::Logarithmic => unreachable!(),
        };

        let distribution = ScheduledDistribution {
            id,
            owner: caller,
            name: req.name,
            start_at_tick: req.start_at_tick.unwrap(),
            duration_ticks: req.duration_ticks,
            scheme: req.scheme,
            cur_tick_reward: EDs::new(cur_reward.0, info.token_decimals),
            scheduled_qty: EDs::new(req.qty.0.clone(), info.token_decimals),
            leftover_qty: EDs::new(req.qty.0, info.token_decimals),
        };

        self.distributions.insert(id, distribution);

        CreateDistributionResponse {
            distribution_id: id,
        }
    }

    pub fn init(
        &mut self,
        seed: Vec<u8>,
        token_can_id: Principal,
        token_decimals: u8,
        token_fee: Nat,
        now: TimestampNs,
    ) {
        let mut info = self.get_dispenser_info();
        info.init(seed, token_can_id, token_decimals, token_fee, now);

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
