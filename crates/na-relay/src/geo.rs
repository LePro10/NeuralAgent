//! Country of a request, for the admin statistics. Only the two-letter country code is ever
//! stored, never the IP address. Sources, in order: a `cf-ipcountry` header from a trusted proxy
//! (Cloudflare), else the DB-IP "IP to Country Lite" table (CSV `start,end,CC`, CC BY 4.0,
//! <https://db-ip.com>) loaded at start from `NA_RELAY_GEOIP` (default `<data>/geoip.csv`).
//! Without either the country is unknown ("--").

use std::net::IpAddr;
use std::path::Path;

use axum::http::HeaderMap;

#[derive(Default)]
pub struct Geo {
    v4: Vec<(u32, u32, [u8; 2])>,
    v6: Vec<(u128, u128, [u8; 2])>,
}

/// Unknown country.
pub const UNKNOWN: &str = "--";

fn code(s: &str) -> Option<[u8; 2]> {
    let b = s.trim().trim_matches('"').as_bytes();
    (b.len() == 2 && b.iter().all(u8::is_ascii_alphabetic)).then(|| [b[0].to_ascii_uppercase(), b[1].to_ascii_uppercase()])
}

impl Geo {
    /// Loads the table; a missing or broken file leaves the lookup empty (logged once).
    pub fn load(path: Option<&Path>) -> Geo {
        let Some(path) = path else { return Geo::default() };
        match std::fs::read_to_string(path) {
            Ok(text) => {
                let g = Geo::parse(&text);
                tracing::info!(v4 = g.v4.len(), v6 = g.v6.len(), "geoip table loaded");
                g
            }
            Err(_) => {
                tracing::info!(path = %path.display(), "no geoip table, countries come only from proxy headers");
                Geo::default()
            }
        }
    }

    pub fn parse(text: &str) -> Geo {
        let mut g = Geo::default();
        for line in text.lines() {
            let mut it = line.split(',');
            let (Some(a), Some(b), Some(c)) = (it.next(), it.next(), it.next()) else { continue };
            let (Ok(a), Ok(b), Some(c)) = (a.trim_matches('"').parse::<IpAddr>(), b.trim_matches('"').parse::<IpAddr>(), code(c)) else {
                continue;
            };
            match (a, b) {
                (IpAddr::V4(a), IpAddr::V4(b)) => g.v4.push((a.into(), b.into(), c)),
                (IpAddr::V6(a), IpAddr::V6(b)) => g.v6.push((a.into(), b.into(), c)),
                _ => {}
            }
        }
        g.v4.sort_unstable_by_key(|r| r.0);
        g.v6.sort_unstable_by_key(|r| r.0);
        g
    }

    pub fn is_empty(&self) -> bool {
        self.v4.is_empty() && self.v6.is_empty()
    }

    fn table(&self, ip: IpAddr) -> Option<[u8; 2]> {
        fn find<T: Ord + Copy>(rows: &[(T, T, [u8; 2])], x: T) -> Option<[u8; 2]> {
            let i = rows.partition_point(|r| r.0 <= x).checked_sub(1)?;
            let r = rows[i];
            (x <= r.1).then_some(r.2)
        }
        match ip {
            IpAddr::V4(v) => find(&self.v4, u32::from(v)),
            IpAddr::V6(v) => match v.to_ipv4_mapped() {
                Some(m) => find(&self.v4, u32::from(m)),
                None => find(&self.v6, u128::from(v)),
            },
        }
    }

    /// The country of `ip` (`trusted`: the request came through our proxy, so its headers count).
    pub fn country(&self, ip: IpAddr, headers: &HeaderMap, trusted: bool) -> String {
        if trusted
            && let Some(c) = headers.get("cf-ipcountry").and_then(|v| v.to_str().ok()).and_then(code)
            && &c != b"XX"
        {
            return String::from_utf8_lossy(&c).into_owned();
        }
        self.table(ip).map(|c| String::from_utf8_lossy(&c).into_owned()).unwrap_or_else(|| UNKNOWN.into())
    }
}

/// A valid stored country code (or `--`).
pub fn valid(c: &str) -> bool {
    c == UNKNOWN || code(c).is_some_and(|b| b == c.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup() {
        let g = Geo::parse("1.0.0.0,1.0.0.255,AU\n2.16.0.0,2.16.255.255,DE\n\"2a00::\",\"2a00:ffff::\",\"CH\"\nbad line\n");
        let h = HeaderMap::new();
        assert_eq!(g.country("1.0.0.7".parse().unwrap(), &h, false), "AU");
        assert_eq!(g.country("2.16.4.4".parse().unwrap(), &h, false), "DE");
        assert_eq!(g.country("2.17.0.1".parse().unwrap(), &h, false), "--");
        assert_eq!(g.country("2a00::1".parse().unwrap(), &h, false), "CH");
        assert_eq!(g.country("::ffff:1.0.0.9".parse().unwrap(), &h, false), "AU");
        let mut h = HeaderMap::new();
        h.insert("cf-ipcountry", "fr".parse().unwrap());
        assert_eq!(g.country("1.0.0.7".parse().unwrap(), &h, true), "FR");
        assert_eq!(g.country("1.0.0.7".parse().unwrap(), &h, false), "AU", "untrusted headers are ignored");
        assert!(valid("DE") && valid("--") && !valid("de") && !valid("DEU"));
    }
}
