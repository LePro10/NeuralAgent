//! Storage for what the admin area shows beyond accounts: anonymous installs (usage pings),
//! problem reports sent from the apps, and the admin audit log. Counters per day stay in the
//! `stats` table (`Db::bump`). Nothing here stores an IP address; installs are known only by a
//! hash of a random id the app made up, and an app can turn the pings off.

use anyhow::Result;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::db::Db;
use crate::util::{day, now};

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS installs(
  id TEXT PRIMARY KEY, app TEXT NOT NULL, version TEXT NOT NULL, os TEXT NOT NULL, os_version TEXT,
  arch TEXT, locale TEXT, country TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS install_days(day TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(day, id));
CREATE TABLE IF NOT EXISTS reports(
  id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, status TEXT NOT NULL,
  user_id TEXT, email TEXT, app TEXT NOT NULL, version TEXT NOT NULL, os TEXT NOT NULL, country TEXT NOT NULL,
  summary TEXT NOT NULL, details TEXT NOT NULL, diagnostics TEXT NOT NULL, note TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS reports_created ON reports(created_at);
CREATE TABLE IF NOT EXISTS audit(
  at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS audit_at ON audit(at);
";

/// Installs not heard from for this long are forgotten.
const INSTALL_KEEP_DAYS: u32 = 400;
/// Solved reports are deleted after this many days.
const REPORT_KEEP_DAYS: i64 = 180;
const AUDIT_KEEP_DAYS: i64 = 365;

/// One anonymous usage ping, already checked by the handler.
#[derive(Debug, Clone)]
pub struct Ping {
    /// sha256 of the app's random install id.
    pub id: String,
    pub app: String,
    pub version: String,
    pub os: String,
    pub os_version: Option<String>,
    pub arch: Option<String>,
    pub locale: Option<String>,
    pub country: String,
    /// Feature counters since the last ping (`agents_started`, `agent.claude`, …).
    pub counts: Vec<(String, i64)>,
}

#[derive(Debug, Clone)]
pub struct NewReport {
    pub user_id: Option<String>,
    pub email: Option<String>,
    pub app: String,
    pub version: String,
    pub os: String,
    pub country: String,
    pub summary: String,
    pub details: String,
    pub diagnostics: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReportRow {
    pub id: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub status: String,
    pub user_id: Option<String>,
    pub email: Option<String>,
    pub app: String,
    pub version: String,
    pub os: String,
    pub country: String,
    pub summary: String,
    pub details: String,
    pub note: String,
    /// Only in the single-report answer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditRow {
    pub at: i64,
    pub actor: String,
    pub action: String,
    pub target: String,
    pub detail: String,
}

pub const REPORT_STATUSES: [&str; 3] = ["open", "seen", "solved"];

fn report_id() -> String {
    const ABC: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let r: [u8; 6] = rand::random();
    format!("R-{}", r.iter().map(|b| ABC[*b as usize % ABC.len()] as char).collect::<String>())
}

const REPORT_COLS: &str = "id, created_at, updated_at, status, user_id, email, app, version, os, country, summary, details, note";

fn report_row(r: &rusqlite::Row) -> rusqlite::Result<ReportRow> {
    Ok(ReportRow {
        id: r.get(0)?,
        created_at: r.get(1)?,
        updated_at: r.get(2)?,
        status: r.get(3)?,
        user_id: r.get(4)?,
        email: r.get(5)?,
        app: r.get(6)?,
        version: r.get(7)?,
        os: r.get(8)?,
        country: r.get(9)?,
        summary: r.get(10)?,
        details: r.get(11)?,
        note: r.get(12)?,
        diagnostics: None,
    })
}

/// `[(value, count)]` sorted by count, as JSON.
fn counted(c: &rusqlite::Connection, sql: &str, since: i64) -> Result<Value> {
    let mut st = c.prepare(sql)?;
    let rows = st
        .query_map([since], |r| Ok(json!({ "key": r.get::<_, Option<String>>(0)?.unwrap_or_default(), "n": r.get::<_, i64>(1)? })))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Value::Array(rows))
}

impl Db {
    pub fn install_ping(&self, p: &Ping) -> Result<()> {
        let mut c = self.0.lock();
        let tx = c.transaction()?;
        let t = now();
        tx.execute(
            "INSERT INTO installs(id, app, version, os, os_version, arch, locale, country, first_seen, last_seen)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
             ON CONFLICT(id) DO UPDATE SET app = ?2, version = ?3, os = ?4, os_version = ?5, arch = ?6, locale = ?7,
               country = ?8, last_seen = ?9",
            params![p.id, p.app, p.version, p.os, p.os_version, p.arch, p.locale, p.country, t],
        )?;
        let today = day(0);
        let new_today = tx.execute("INSERT OR IGNORE INTO install_days(day, id) VALUES (?1, ?2)", params![today, p.id])? == 1;
        let bump = |k: &str, n: i64| {
            tx.execute(
                "INSERT INTO stats(day, key, value) VALUES (?1, ?2, ?3) ON CONFLICT(day, key) DO UPDATE SET value = value + ?3",
                params![today, k, n],
            )
        };
        bump(&format!("ping:{}", p.app), 1)?;
        if new_today {
            bump(&format!("active:{}", p.app), 1)?;
        }
        for (k, n) in &p.counts {
            bump(&format!("use:{k}"), *n)?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Active installs and what they run, for the Usage page.
    pub fn installs_summary(&self, days: u32) -> Result<Value> {
        let c = self.0.lock();
        let t = now();
        let active = |d: i64| c.query_row("SELECT COUNT(*) FROM installs WHERE last_seen >= ?1", [t - d * 86400], |r| r.get::<_, i64>(0));
        let since = t - 30 * 86400;
        let mut daily = vec![];
        {
            let mut st = c.prepare("SELECT day, COUNT(*) FROM install_days WHERE day >= ?1 GROUP BY day ORDER BY day")?;
            for row in
                st.query_map([day(days.saturating_sub(1))], |r| Ok(json!({ "day": r.get::<_, String>(0)?, "n": r.get::<_, i64>(1)? })))?
            {
                daily.push(row?);
            }
        }
        let new_in_period =
            c.query_row("SELECT COUNT(*) FROM installs WHERE first_seen >= ?1", [t - days as i64 * 86400], |r| r.get::<_, i64>(0))?;
        let by = |col: &str| {
            counted(&c, &format!("SELECT {col}, COUNT(*) n FROM installs WHERE last_seen >= ?1 GROUP BY 1 ORDER BY n DESC LIMIT 40"), since)
        };
        Ok(json!({
            "total": c.query_row("SELECT COUNT(*) FROM installs", [], |r| r.get::<_, i64>(0))?,
            "active": { "d1": active(1)?, "d7": active(7)?, "d30": active(30)? },
            "new": new_in_period,
            "daily": daily,
            "by_app": by("app")?,
            "by_os": by("os")?,
            "by_os_version": by("os || ' ' || COALESCE(os_version, '')")?,
            "by_version": by("version")?,
            "by_country": by("country")?,
            "by_arch": by("arch")?,
            "by_language": by("lower(substr(COALESCE(locale, ''), 1, 2))")?,
        }))
    }

    /// Sum of every counter over the last `days` days.
    pub fn totals(&self, days: u32) -> Result<Map<String, Value>> {
        let c = self.0.lock();
        let mut st = c.prepare("SELECT key, SUM(value) FROM stats WHERE day >= ?1 GROUP BY key")?;
        let mut m = Map::new();
        for row in st.query_map([day(days.saturating_sub(1))], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
            let (k, v) = row?;
            m.insert(k, v.into());
        }
        Ok(m)
    }

    pub fn add_report(&self, r: &NewReport) -> Result<String> {
        let c = self.0.lock();
        let t = now();
        loop {
            let id = report_id();
            let n = c.execute(
                "INSERT OR IGNORE INTO reports(id, created_at, updated_at, status, user_id, email, app, version, os, country, summary, details, diagnostics)
                 VALUES (?1, ?2, ?2, 'open', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![id, t, r.user_id, r.email, r.app, r.version, r.os, r.country, r.summary, r.details, r.diagnostics],
            )?;
            if n == 1 {
                return Ok(id);
            }
        }
    }

    pub fn reports(&self, limit: u32) -> Result<Vec<ReportRow>> {
        let c = self.0.lock();
        let mut st = c.prepare(&format!("SELECT {REPORT_COLS} FROM reports ORDER BY created_at DESC LIMIT ?1"))?;
        Ok(st.query_map([limit], report_row)?.collect::<rusqlite::Result<_>>()?)
    }

    pub fn report(&self, id: &str) -> Result<Option<ReportRow>> {
        let c = self.0.lock();
        let row = c
            .query_row(&format!("SELECT {REPORT_COLS}, diagnostics FROM reports WHERE id = ?1"), [id], |r| {
                let mut row = report_row(r)?;
                let d: String = r.get(13)?;
                row.diagnostics = Some(serde_json::from_str(&d).unwrap_or(Value::String(d)));
                Ok(row)
            })
            .optional()?;
        Ok(row)
    }

    pub fn update_report(&self, id: &str, status: Option<&str>, note: Option<&str>) -> Result<bool> {
        Ok(self.0.lock().execute(
            "UPDATE reports SET status = COALESCE(?2, status), note = COALESCE(?3, note), updated_at = ?4 WHERE id = ?1",
            params![id, status, note, now()],
        )? == 1)
    }

    pub fn delete_report(&self, id: &str) -> Result<bool> {
        Ok(self.0.lock().execute("DELETE FROM reports WHERE id = ?1", [id])? == 1)
    }

    pub fn open_reports(&self) -> Result<i64> {
        Ok(self.0.lock().query_row("SELECT COUNT(*) FROM reports WHERE status = 'open'", [], |r| r.get(0))?)
    }

    pub fn audit_add(&self, actor: &str, action: &str, target: &str, detail: &str) {
        let r = self.0.lock().execute(
            "INSERT INTO audit(at, actor, action, target, detail) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![now(), actor, action, target, detail],
        );
        if let Err(e) = r {
            tracing::warn!("audit write failed: {e}");
        }
    }

    pub fn audit(&self, limit: u32) -> Result<Vec<AuditRow>> {
        let c = self.0.lock();
        let mut st = c.prepare("SELECT at, actor, action, target, detail FROM audit ORDER BY at DESC, rowid DESC LIMIT ?1")?;
        Ok(st
            .query_map([limit], |r| {
                Ok(AuditRow { at: r.get(0)?, actor: r.get(1)?, action: r.get(2)?, target: r.get(3)?, detail: r.get(4)? })
            })?
            .collect::<rusqlite::Result<_>>()?)
    }

    /// Drops old installs, solved reports and old audit lines. Cheap; runs at most once a day.
    pub fn prune(&self) -> Result<()> {
        let today = day(0);
        if self.kv_get("pruned")?.as_deref() == Some(today.as_str()) {
            return Ok(());
        }
        {
            let c = self.0.lock();
            let t = now();
            c.execute("DELETE FROM installs WHERE last_seen < ?1", [t - INSTALL_KEEP_DAYS as i64 * 86400])?;
            c.execute("DELETE FROM install_days WHERE day < ?1", [day(INSTALL_KEEP_DAYS)])?;
            c.execute("DELETE FROM reports WHERE status = 'solved' AND updated_at < ?1", [t - REPORT_KEEP_DAYS * 86400])?;
            c.execute("DELETE FROM audit WHERE at < ?1", [t - AUDIT_KEEP_DAYS * 86400])?;
        }
        self.kv_set("pruned", &today)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ping(id: &str, os: &str) -> Ping {
        Ping {
            id: id.into(),
            app: "desktop".into(),
            version: "0.4.1".into(),
            os: os.into(),
            os_version: Some("15.1".into()),
            arch: Some("aarch64".into()),
            locale: Some("de-CH".into()),
            country: "CH".into(),
            counts: vec![("agents_started".into(), 3)],
        }
    }

    #[test]
    fn installs_and_counters() {
        let db = Db::memory().unwrap();
        db.install_ping(&ping("a", "macos")).unwrap();
        db.install_ping(&ping("a", "macos")).unwrap();
        db.install_ping(&ping("b", "windows")).unwrap();
        let s = db.installs_summary(30).unwrap();
        assert_eq!(s["total"], 2);
        assert_eq!(s["active"]["d1"], 2);
        assert_eq!(s["by_os"][0]["n"], 1);
        assert_eq!(s["by_language"][0]["key"], "de");
        let t = db.totals(30).unwrap();
        assert_eq!(t["use:agents_started"], 9);
        assert_eq!(t["active:desktop"], 2, "one active count per install and day");
        assert_eq!(t["ping:desktop"], 3);
    }

    #[test]
    fn reports_and_audit() {
        let db = Db::memory().unwrap();
        let r = NewReport {
            user_id: None,
            email: Some("a@example.com".into()),
            app: "desktop".into(),
            version: "0.4.1".into(),
            os: "macos".into(),
            country: "DE".into(),
            summary: "Agents do not start".into(),
            details: "".into(),
            diagnostics: r#"{"log":["x"]}"#.into(),
        };
        let id = db.add_report(&r).unwrap();
        assert!(id.starts_with("R-") && id.len() == 8);
        assert_eq!(db.open_reports().unwrap(), 1);
        let list = db.reports(10).unwrap();
        assert!(list[0].diagnostics.is_none());
        assert_eq!(db.report(&id).unwrap().unwrap().diagnostics.unwrap()["log"][0], "x");
        assert!(db.update_report(&id, Some("solved"), Some("fixed in 0.4.2")).unwrap());
        assert_eq!(db.open_reports().unwrap(), 0);
        db.audit_add("boss@example.com", "approve", "a@example.com", "");
        assert_eq!(db.audit(5).unwrap()[0].action, "approve");
        db.prune().unwrap();
        assert!(db.delete_report(&id).unwrap());
    }
}
