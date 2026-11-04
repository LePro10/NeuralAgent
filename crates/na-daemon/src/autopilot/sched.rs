//! Routine schedules: when is a routine next due, and does a run missed during sleep happen once.

use chrono::{DateTime, Datelike, Duration, Local, NaiveTime, TimeZone};
use na_protocol::{Millis, Schedule};

pub const MIN_MINUTES: u32 = 5;

/// "09:00" → (9, 0).
pub fn parse_at(at: &str) -> Option<NaiveTime> {
    let (h, m) = at.trim().split_once(':')?;
    NaiveTime::from_hms_opt(h.trim().parse().ok()?, m.trim().parse().ok()?, 0)
}

pub fn validate(s: &Schedule) -> Result<(), String> {
    match s {
        Schedule::Every { minutes } if *minutes < MIN_MINUTES => Err(format!("a routine runs at most every {MIN_MINUTES} minutes")),
        Schedule::Every { .. } => Ok(()),
        Schedule::Daily { at } => parse_at(at).map(|_| ()).ok_or_else(|| format!("\"{at}\" is not a time like 09:00")),
        Schedule::Weekly { day, at } => {
            if *day > 6 {
                return Err("the day of the week is 0 (Monday) to 6 (Sunday)".into());
            }
            parse_at(at).map(|_| ()).ok_or_else(|| format!("\"{at}\" is not a time like 09:00"))
        }
    }
}

fn at_local(d: chrono::NaiveDate, t: NaiveTime) -> Option<DateTime<Local>> {
    // A time that does not exist (spring forward) counts as the hour after.
    Local
        .from_local_datetime(&d.and_time(t))
        .earliest()
        .or_else(|| Local.from_local_datetime(&d.and_time(t + Duration::hours(1))).earliest())
}

/// The first moment strictly after `after` the schedule fires.
pub fn next_after(s: &Schedule, after: DateTime<Local>) -> Option<DateTime<Local>> {
    match s {
        Schedule::Every { minutes } => Some(after + Duration::minutes((*minutes).max(MIN_MINUTES) as i64)),
        Schedule::Daily { at } => {
            let t = parse_at(at)?;
            (0..3).find_map(|i| at_local(after.date_naive() + Duration::days(i), t).filter(|c| *c > after))
        }
        Schedule::Weekly { day, at } => {
            let t = parse_at(at)?;
            (0..9).find_map(|i| {
                let d = after.date_naive() + Duration::days(i);
                (d.weekday().num_days_from_monday() == *day as u32).then(|| at_local(d, t)).flatten().filter(|c| *c > after)
            })
        }
    }
}

fn local(ms: Millis) -> DateTime<Local> {
    Local.timestamp_millis_opt(ms).single().unwrap_or_else(Local::now)
}

/// When a routine is next due, counted from its last run (or from when it was set up).
pub fn next_due(s: &Schedule, last: Millis) -> Option<Millis> {
    next_after(s, local(last)).map(|d| d.timestamp_millis())
}

/// Due now? A run missed while the computer slept is due once; after it runs `last` is "now", so
/// the other missed slots do not follow.
pub fn due(s: &Schedule, last: Millis, now: Millis) -> bool {
    next_due(s, last).is_some_and(|n| n <= now)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(y, mo, d, h, mi, 0).earliest().unwrap()
    }

    #[test]
    fn every_counts_from_the_last_run() {
        let last = at(2026, 11, 3, 10, 0);
        let s = Schedule::Every { minutes: 360 };
        assert_eq!(next_after(&s, last).unwrap(), at(2026, 11, 3, 16, 0));
        let ms = last.timestamp_millis();
        assert!(!due(&s, ms, ms + 359 * 60_000));
        assert!(due(&s, ms, ms + 360 * 60_000));
    }

    #[test]
    fn daily_takes_today_or_tomorrow() {
        let s = Schedule::Daily { at: "09:00".into() };
        assert_eq!(next_after(&s, at(2026, 11, 3, 8, 0)).unwrap(), at(2026, 11, 3, 9, 0));
        assert_eq!(next_after(&s, at(2026, 11, 3, 9, 0)).unwrap(), at(2026, 11, 4, 9, 0));
        assert_eq!(next_after(&s, at(2026, 11, 3, 23, 59)).unwrap(), at(2026, 11, 4, 9, 0));
    }

    #[test]
    fn weekly_finds_the_day() {
        // 2026-11-03 is a Tuesday (day 1). Monday = 0.
        let s = Schedule::Weekly { day: 0, at: "14:30".into() };
        assert_eq!(next_after(&s, at(2026, 11, 3, 10, 0)).unwrap(), at(2026, 11, 9, 14, 30));
        let tue = Schedule::Weekly { day: 1, at: "14:30".into() };
        assert_eq!(next_after(&tue, at(2026, 11, 3, 10, 0)).unwrap(), at(2026, 11, 3, 14, 30));
        assert_eq!(next_after(&tue, at(2026, 11, 3, 15, 0)).unwrap(), at(2026, 11, 10, 14, 30));
    }

    #[test]
    fn a_missed_run_happens_once() {
        // Daily 09:00, last ran Monday 09:00, the Mac slept until Thursday noon.
        let s = Schedule::Daily { at: "09:00".into() };
        let last = at(2026, 11, 2, 9, 0).timestamp_millis();
        let now = at(2026, 11, 5, 12, 0).timestamp_millis();
        assert!(due(&s, last, now));
        // After that run `last` = now: the next slot is Friday 09:00, not the three missed ones.
        assert!(!due(&s, now, now + 60_000));
        assert_eq!(next_due(&s, now).unwrap(), at(2026, 11, 6, 9, 0).timestamp_millis());
    }

    #[test]
    fn validates() {
        assert!(validate(&Schedule::Every { minutes: 4 }).is_err());
        assert!(validate(&Schedule::Every { minutes: 5 }).is_ok());
        assert!(validate(&Schedule::Daily { at: "25:00".into() }).is_err());
        assert!(validate(&Schedule::Daily { at: "9:5".into() }).is_ok());
        assert!(validate(&Schedule::Weekly { day: 7, at: "09:00".into() }).is_err());
        assert!(validate(&Schedule::Weekly { day: 6, at: "nine".into() }).is_err());
    }
}
