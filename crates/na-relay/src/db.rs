//! SQLite storage: accounts, provider identities, devices, admin passkeys and anonymous stats.
//! One connection behind a mutex; the relay's write load is a few rows per sign-in.

use std::path::Path;

use anyhow::{Result, bail};
use parking_lot::Mutex;
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::Serialize;

use crate::util::{day, now};

/// Devices one account may have signed in at the same time.
pub const MAX_DEVICES: usize = 20;

const SCHEMA: &str = "
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, avatar TEXT,
  status TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, remote INTEGER NOT NULL DEFAULT 1,
  message TEXT, provider TEXT NOT NULL, notified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, decided_at INTEGER);
CREATE TABLE IF NOT EXISTS identities(
  provider TEXT NOT NULL, subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(provider, subject));
CREATE TABLE IF NOT EXISTS devices(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, platform TEXT NOT NULL, kind TEXT NOT NULL, pubkey TEXT,
  refresh_hash TEXT, prev_hash TEXT, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  revoked_at INTEGER, bytes INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS devices_user ON devices(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS devices_refresh ON devices(refresh_hash);
CREATE TABLE IF NOT EXISTS passkeys(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  x BLOB NOT NULL, y BLOB NOT NULL, sign_count INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS stats(day TEXT NOT NULL, key TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY(day, key));
CREATE TABLE IF NOT EXISTS device_days(day TEXT NOT NULL, device_id TEXT NOT NULL, PRIMARY KEY(day, device_id));
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL);
";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Pending,
    Approved,
    Denied,
    Blocked,
}

impl Status {
    fn parse(s: &str) -> Status {
        match s {
            "approved" => Status::Approved,
            "denied" => Status::Denied,
            "blocked" => Status::Blocked,
            _ => Status::Pending,
        }
    }
    pub fn as_str(&self) -> &'static str {
        match self {
            Status::Pending => "pending",
            Status::Approved => "approved",
            Status::Denied => "denied",
            Status::Blocked => "blocked",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: String,
    pub avatar: Option<String>,
    pub status: Status,
    pub is_admin: bool,
    /// Remote access switched on for this account (admin can turn it off without blocking).
    pub remote: bool,
    pub message: Option<String>,
    pub provider: String,
    pub created_at: i64,
    pub decided_at: Option<i64>,
}

impl User {
    /// May route messages between its devices.
    pub fn can_route(&self) -> bool {
        self.status == Status::Approved && self.remote
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Device {
    pub id: String,
    #[serde(skip)]
    pub user_id: String,
    pub name: String,
    pub platform: String,
    /// `host` (a desktop that runs agents) or `client` (phone, browser).
    pub kind: String,
    pub pubkey: Option<String>,
    pub created_at: i64,
    pub last_seen: i64,
    pub bytes: i64,
}

pub struct Identity<'a> {
    pub provider: &'a str,
    pub subject: &'a str,
    pub email: &'a str,
    pub name: &'a str,
    pub avatar: Option<&'a str>,
}

pub enum Refresh {
    Ok(Device),
    /// An already rotated token came back: someone copied it. The device is signed out.
    Reused(Device),
    Unknown,
}

/// A stored passkey: credential id, P-256 x and y, signature counter.
pub type Passkey = (String, Vec<u8>, Vec<u8>, u32);

pub struct Db(Mutex<Connection>);

const USER_COLS: &str = "id, email, name, avatar, status, is_admin, remote, message, provider, created_at, decided_at";
const DEVICE_COLS: &str = "id, user_id, name, platform, kind, pubkey, created_at, last_seen, bytes";

fn user_row(r: &Row) -> rusqlite::Result<User> {
    Ok(User {
        id: r.get(0)?,
        email: r.get(1)?,
        name: r.get(2)?,
        avatar: r.get(3)?,
        status: Status::parse(&r.get::<_, String>(4)?),
        is_admin: r.get(5)?,
        remote: r.get(6)?,
        message: r.get(7)?,
        provider: r.get(8)?,
        created_at: r.get(9)?,
        decided_at: r.get(10)?,
    })
}

fn device_row(r: &Row) -> rusqlite::Result<Device> {
    Ok(Device {
        id: r.get(0)?,
        user_id: r.get(1)?,
        name: r.get(2)?,
        platform: r.get(3)?,
        kind: r.get(4)?,
        pubkey: r.get(5)?,
        created_at: r.get(6)?,
        last_seen: r.get(7)?,
        bytes: r.get(8)?,
    })
}

impl Db {
    pub fn open(path: &Path) -> Result<Db> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let c = Connection::open(path)?;
        c.pragma_update(None, "journal_mode", "WAL")?;
        Db::init(c)
    }

    pub fn memory() -> Result<Db> {
        Db::init(Connection::open_in_memory()?)
    }

    fn init(c: Connection) -> Result<Db> {
        c.execute_batch(SCHEMA)?;
        // Columns added after the first release (fails harmlessly when present).
        let _ = c.execute("ALTER TABLE devices ADD COLUMN push TEXT", []);
        Ok(Db(Mutex::new(c)))
    }

    /// Signs in with a provider identity: the same identity, else an account with the same
    /// (verified) email, else a new pending account. Emails in `admins` are approved admins.
    /// Returns the account and whether it was created now.
    pub fn login(&self, id: &Identity, admins: &[String]) -> Result<(User, bool)> {
        let email = id.email.trim().to_lowercase();
        let admin = admins.iter().any(|a| a.eq_ignore_ascii_case(&email));
        let mut c = self.0.lock();
        let tx = c.transaction()?;
        let by_identity: Option<String> = tx
            .query_row("SELECT user_id FROM identities WHERE provider = ?1 AND subject = ?2", params![id.provider, id.subject], |r| {
                r.get(0)
            })
            .optional()?;
        let existing = match by_identity {
            Some(u) => Some(u),
            None => tx.query_row("SELECT id FROM users WHERE email = ?1", [&email], |r| r.get(0)).optional()?,
        };
        let created = existing.is_none();
        let user_id = match existing {
            Some(u) => {
                tx.execute("UPDATE users SET name = ?2, avatar = COALESCE(?3, avatar) WHERE id = ?1", params![u, id.name, id.avatar])?;
                u
            }
            None => {
                let u = uuid::Uuid::new_v4().to_string();
                let status = if admin { "approved" } else { "pending" };
                tx.execute(
                    "INSERT INTO users(id, email, name, avatar, status, provider, created_at, decided_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![u, email, id.name, id.avatar, status, id.provider, now(), admin.then(now)],
                )?;
                u
            }
        };
        if admin {
            tx.execute("UPDATE users SET is_admin = 1, status = 'approved' WHERE id = ?1", [&user_id])?;
        }
        tx.execute(
            "INSERT OR IGNORE INTO identities(provider, subject, user_id) VALUES (?1, ?2, ?3)",
            params![id.provider, id.subject, user_id],
        )?;
        let user = tx.query_row(&format!("SELECT {USER_COLS} FROM users WHERE id = ?1"), [&user_id], user_row)?;
        tx.commit()?;
        Ok((user, created))
    }

    pub fn user(&self, id: &str) -> Result<Option<User>> {
        Ok(self.0.lock().query_row(&format!("SELECT {USER_COLS} FROM users WHERE id = ?1"), [id], user_row).optional()?)
    }

    pub fn users(&self) -> Result<Vec<User>> {
        let c = self.0.lock();
        let mut st = c.prepare(&format!("SELECT {USER_COLS} FROM users ORDER BY created_at DESC"))?;
        Ok(st.query_map([], user_row)?.collect::<rusqlite::Result<_>>()?)
    }

    pub fn admins(&self) -> Result<Vec<User>> {
        Ok(self.users()?.into_iter().filter(|u| u.is_admin).collect())
    }

    pub fn set_status(&self, id: &str, status: Status) -> Result<Option<User>> {
        self.0.lock().execute("UPDATE users SET status = ?2, decided_at = ?3 WHERE id = ?1", params![id, status.as_str(), now()])?;
        self.user(id)
    }

    pub fn set_remote(&self, id: &str, on: bool) -> Result<Option<User>> {
        self.0.lock().execute("UPDATE users SET remote = ?2 WHERE id = ?1", params![id, on])?;
        self.user(id)
    }

    pub fn set_message(&self, id: &str, message: &str) -> Result<()> {
        self.0.lock().execute("UPDATE users SET message = ?2 WHERE id = ?1", params![id, message])?;
        Ok(())
    }

    /// True exactly once per account: the admins have to hear about this request.
    pub fn take_notify(&self, id: &str) -> Result<bool> {
        Ok(self.0.lock().execute("UPDATE users SET notified = 1 WHERE id = ?1 AND notified = 0 AND status = 'pending'", [id])? == 1)
    }

    pub fn delete_user(&self, id: &str) -> Result<()> {
        self.0.lock().execute("DELETE FROM users WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn add_device(
        &self,
        user_id: &str,
        name: &str,
        platform: &str,
        kind: &str,
        pubkey: Option<&str>,
        refresh_hash: &str,
    ) -> Result<Device> {
        let c = self.0.lock();
        let active: i64 = c.query_row("SELECT COUNT(*) FROM devices WHERE user_id = ?1 AND revoked_at IS NULL", [user_id], |r| r.get(0))?;
        if active as usize >= MAX_DEVICES {
            bail!("too many devices: sign out an old one first");
        }
        let id = uuid::Uuid::new_v4().to_string();
        let t = now();
        c.execute(
            "INSERT INTO devices(id, user_id, name, platform, kind, pubkey, refresh_hash, created_at, last_seen) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![id, user_id, name, platform, kind, pubkey, refresh_hash, t],
        )?;
        Ok(c.query_row(&format!("SELECT {DEVICE_COLS} FROM devices WHERE id = ?1"), [&id], device_row)?)
    }

    /// An active (not signed out) device.
    pub fn device(&self, id: &str) -> Result<Option<Device>> {
        Ok(self
            .0
            .lock()
            .query_row(&format!("SELECT {DEVICE_COLS} FROM devices WHERE id = ?1 AND revoked_at IS NULL"), [id], device_row)
            .optional()?)
    }

    pub fn devices(&self, user_id: &str) -> Result<Vec<Device>> {
        let c = self.0.lock();
        let mut st =
            c.prepare(&format!("SELECT {DEVICE_COLS} FROM devices WHERE user_id = ?1 AND revoked_at IS NULL ORDER BY created_at"))?;
        Ok(st.query_map([user_id], device_row)?.collect::<rusqlite::Result<_>>()?)
    }

    pub fn update_device(&self, id: &str, name: Option<&str>, pubkey: Option<&str>) -> Result<()> {
        self.0.lock().execute(
            "UPDATE devices SET name = COALESCE(?2, name), pubkey = COALESCE(?3, pubkey) WHERE id = ?1",
            params![id, name, pubkey],
        )?;
        Ok(())
    }

    /// Looks up a refresh token; the current one is valid, the one before it means theft.
    pub fn refresh(&self, hash: &str) -> Result<Refresh> {
        let c = self.0.lock();
        let q = |col: &str| {
            c.query_row(&format!("SELECT {DEVICE_COLS} FROM devices WHERE {col} = ?1 AND revoked_at IS NULL"), [hash], device_row)
                .optional()
        };
        if let Some(d) = q("refresh_hash")? {
            return Ok(Refresh::Ok(d));
        }
        if let Some(d) = q("prev_hash")? {
            return Ok(Refresh::Reused(d));
        }
        Ok(Refresh::Unknown)
    }

    pub fn rotate(&self, device_id: &str, new_hash: &str) -> Result<()> {
        self.0.lock().execute(
            "UPDATE devices SET prev_hash = refresh_hash, refresh_hash = ?2, last_seen = ?3 WHERE id = ?1",
            params![device_id, new_hash, now()],
        )?;
        Ok(())
    }

    pub fn revoke_device(&self, id: &str) -> Result<()> {
        self.0.lock().execute(
            "UPDATE devices SET revoked_at = ?2, refresh_hash = NULL, prev_hash = NULL, push = NULL WHERE id = ?1",
            params![id, now()],
        )?;
        Ok(())
    }

    /// What a device is woken with (FCM token or Web Push subscription); `None` clears it.
    pub fn set_push(&self, id: &str, target: Option<&crate::push::Target>) -> Result<()> {
        let v = target.map(serde_json::to_string).transpose()?;
        self.0.lock().execute("UPDATE devices SET push = ?2 WHERE id = ?1", params![id, v])?;
        Ok(())
    }

    /// Active client devices of an account that can be woken.
    pub fn push_targets(&self, user_id: &str) -> Result<Vec<(String, crate::push::Target)>> {
        let c = self.0.lock();
        let mut st =
            c.prepare("SELECT id, push FROM devices WHERE user_id = ?1 AND revoked_at IS NULL AND kind = 'client' AND push IS NOT NULL")?;
        let rows = st.query_map([user_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        Ok(rows.filter_map(|r| r.ok()).filter_map(|(id, v)| Some((id, serde_json::from_str(&v).ok()?))).collect())
    }

    pub fn kv_get(&self, key: &str) -> Result<Option<String>> {
        Ok(self.0.lock().query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0)).optional()?)
    }

    pub fn kv_set(&self, key: &str, value: &str) -> Result<()> {
        self.0
            .lock()
            .execute("INSERT INTO kv(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2", params![key, value])?;
        Ok(())
    }

    /// Signs out every device of an account; returns their ids.
    pub fn revoke_all(&self, user_id: &str) -> Result<Vec<String>> {
        let ids: Vec<String> = self.devices(user_id)?.into_iter().map(|d| d.id).collect();
        for id in &ids {
            self.revoke_device(id)?;
        }
        Ok(ids)
    }

    pub fn seen(&self, device_id: &str, bytes: i64) -> Result<()> {
        let c = self.0.lock();
        c.execute("UPDATE devices SET last_seen = ?2, bytes = bytes + ?3 WHERE id = ?1", params![device_id, now(), bytes])?;
        c.execute("INSERT OR IGNORE INTO device_days(day, device_id) VALUES (?1, ?2)", params![day(0), device_id])?;
        Ok(())
    }

    pub fn bump(&self, key: &str, n: i64) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO stats(day, key, value) VALUES (?1, ?2, ?3) ON CONFLICT(day, key) DO UPDATE SET value = value + ?3",
            params![day(0), key, n],
        )?;
        Ok(())
    }

    pub fn add_passkey(&self, user_id: &str, id: &str, x: &[u8], y: &[u8], sign_count: u32) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO passkeys(id, user_id, x, y, sign_count, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, user_id, x, y, sign_count, now()],
        )?;
        Ok(())
    }

    /// Passkeys of an account: (credential id, x, y, sign count).
    pub fn passkeys(&self, user_id: &str) -> Result<Vec<Passkey>> {
        let c = self.0.lock();
        let mut st = c.prepare("SELECT id, x, y, sign_count FROM passkeys WHERE user_id = ?1")?;
        Ok(st.query_map([user_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<rusqlite::Result<_>>()?)
    }

    pub fn set_sign_count(&self, id: &str, n: u32) -> Result<()> {
        self.0.lock().execute("UPDATE passkeys SET sign_count = ?2 WHERE id = ?1", params![id, n])?;
        Ok(())
    }

    /// Anonymous numbers for the admin dashboard: totals plus one row per day.
    pub fn stats(&self, days: u32) -> Result<serde_json::Value> {
        let c = self.0.lock();
        let count = |sql: &str| c.query_row(sql, [], |r| r.get::<_, i64>(0));
        let since = day(days.saturating_sub(1));
        let mut per_day: std::collections::BTreeMap<String, serde_json::Map<String, serde_json::Value>> = Default::default();
        {
            let mut st = c.prepare("SELECT day, key, value FROM stats WHERE day >= ?1")?;
            for row in st.query_map([&since], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)))? {
                let (d, k, v) = row?;
                per_day.entry(d).or_default().insert(k, v.into());
            }
            let mut st = c.prepare("SELECT day, COUNT(*) FROM device_days WHERE day >= ?1 GROUP BY day")?;
            for row in st.query_map([&since], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
                let (d, n) = row?;
                per_day.entry(d).or_default().insert("active_devices".into(), n.into());
            }
        }
        Ok(serde_json::json!({
            "users": count("SELECT COUNT(*) FROM users WHERE status = 'approved'")?,
            "pending": count("SELECT COUNT(*) FROM users WHERE status = 'pending'")?,
            "devices": count("SELECT COUNT(*) FROM devices WHERE revoked_at IS NULL")?,
            "days": per_day.into_iter().map(|(d, mut m)| { m.insert("day".into(), d.into()); m }).collect::<Vec<_>>(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id<'a>(provider: &'a str, subject: &'a str, email: &'a str) -> Identity<'a> {
        Identity { provider, subject, email, name: "Test", avatar: None }
    }

    #[test]
    fn login_links_providers_by_email_and_admins_are_approved() {
        let db = Db::memory().unwrap();
        let admins = vec!["boss@example.com".to_string()];
        let (a, created) = db.login(&id("github", "1", "Ann@Example.com"), &admins).unwrap();
        assert!(created);
        assert_eq!(a.status, Status::Pending);
        assert_eq!(a.email, "ann@example.com");
        let (b, created) = db.login(&id("google", "g-1", "ann@example.com"), &admins).unwrap();
        assert!(!created);
        assert_eq!(a.id, b.id);
        let (c, _) = db.login(&id("google", "g-1", "ann@example.com"), &admins).unwrap();
        assert_eq!(a.id, c.id);
        let (boss, _) = db.login(&id("github", "2", "boss@example.com"), &admins).unwrap();
        assert!(boss.is_admin);
        assert_eq!(boss.status, Status::Approved);
        assert!(db.take_notify(&a.id).unwrap());
        assert!(!db.take_notify(&a.id).unwrap());
        assert!(!db.take_notify(&boss.id).unwrap());
    }

    #[test]
    fn refresh_rotation_detects_reuse() {
        let db = Db::memory().unwrap();
        let (u, _) = db.login(&id("github", "1", "a@example.com"), &[]).unwrap();
        let d = db.add_device(&u.id, "Mac", "macos", "host", None, "h1").unwrap();
        assert!(matches!(db.refresh("h1").unwrap(), Refresh::Ok(_)));
        db.rotate(&d.id, "h2").unwrap();
        assert!(matches!(db.refresh("h2").unwrap(), Refresh::Ok(_)));
        assert!(matches!(db.refresh("h1").unwrap(), Refresh::Reused(_)));
        db.revoke_device(&d.id).unwrap();
        assert!(matches!(db.refresh("h2").unwrap(), Refresh::Unknown));
        assert!(db.device(&d.id).unwrap().is_none());
    }

    #[test]
    fn device_limit() {
        let db = Db::memory().unwrap();
        let (u, _) = db.login(&id("github", "1", "a@example.com"), &[]).unwrap();
        for i in 0..MAX_DEVICES {
            db.add_device(&u.id, "d", "web", "client", None, &format!("h{i}")).unwrap();
        }
        assert!(db.add_device(&u.id, "d", "web", "client", None, "hx").is_err());
    }
}
