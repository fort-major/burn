use std::time::Duration;

use ic_e8s::c::E8s;

use crate::{burner::types::TimestampNs, ONE_DAY_NS, ONE_HOUR_NS};

pub fn f64_to_e8s(n: f64) -> E8s {
    if n < 0.0 {
        panic!("Only positive numbers allowed");
    }

    let n_u128 = (n * 1_0000_0000.0) as u128;

    E8s::from(n_u128 / 1_0000_0000)
}

fn next_sunday_15_utc(now: TimestampNs) -> u64 {
    let days_since_epoch = now / ONE_DAY_NS;
    let current_weekday = (days_since_epoch + 4) % 7; // 1970-01-01 was a Thursday (day 4)

    // Calculate the number of days until next Sunday
    let days_to_next_sunday = if current_weekday == 0 {
        7
    } else {
        7 - current_weekday
    };

    // Calculate next Sunday's date (00:00:00 UTC)
    let next_sunday_start_ns = now + days_to_next_sunday * ONE_DAY_NS;

    // Add 15 hours (15:00 UTC) to the start of Sunday
    next_sunday_start_ns + 15 * ONE_HOUR_NS
}

/// Calculates the duration in seconds until next Sunday 15:00 UTC
pub fn duration_until_next_sunday_15_00(now: u64) -> Duration {
    let next_sunday_secs = next_sunday_15_utc(now);

    Duration::from_nanos(next_sunday_secs - now)
}
