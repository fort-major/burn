use std::time::Duration;

use chrono::Datelike;
use ic_e8s::c::E8s;

use crate::{burner::types::TimestampNs, ONE_DAY_NS, ONE_HOUR_NS, ONE_WEEK_NS};

pub fn f64_to_e8s(n: f64) -> E8s {
    if n < 0.0 {
        panic!("Only positive numbers allowed");
    }

    let n_u128 = (n * 1_0000_0000.0) as u128;

    E8s::from(n_u128)
}

fn next_sunday_n_utc(current_timestamp_nanos: u64, n: u64) -> Duration {
    if n >= 24 {
        unreachable!("Invalid hour"); // Invalid hour, must be between 0 and 23
    }

    // Calculate the current time in days, hours, and seconds
    let current_days = current_timestamp_nanos / ONE_DAY_NS;
    let current_nanoseconds_of_day = current_timestamp_nanos % ONE_DAY_NS;

    // Calculate the current day of the week (0 = Thursday 1970-01-01)
    let current_day_of_week = (current_days + 4) % 7;

    // Calculate the target time for the next Sunday at N:00 UTC
    let days_until_sunday = if current_day_of_week == 0 {
        0
    } else {
        7 - current_day_of_week
    };
    let target_nanoseconds_of_day = n * ONE_HOUR_NS;

    // Calculate the time difference in seconds
    let mut duration_until_target = days_until_sunday * ONE_DAY_NS + target_nanoseconds_of_day;
    if current_nanoseconds_of_day > target_nanoseconds_of_day {
        duration_until_target += ONE_WEEK_NS;
    }
    duration_until_target -= current_nanoseconds_of_day;

    // Convert the duration to nanoseconds
    Duration::from_nanos(duration_until_target)
}

/// Calculates the duration in seconds until next Sunday 15:00 UTC
pub fn duration_until_next_sunday_15_00(now: u64) -> Duration {
    next_sunday_n_utc(now, 15)
}

/// Calculates the duration in seconds until next Sunday 12:00 UTC
pub fn duration_until_next_sunday_12_00(now: u64) -> Duration {
    next_sunday_n_utc(now, 12)
}

pub fn escape_script_tag(s: &str) -> String {
    html_escape::encode_script(s).to_string()
}
