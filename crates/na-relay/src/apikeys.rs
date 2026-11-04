//! Scoped admin API keys and answers to problem reports (docs/notes/autopilot.md, D91).
//!
//! A key (`nak_…`) is shown once when created and stored hashed. It carries scopes:
//! `reports:read` (list and read reports) and `reports:reply` (answer, change status). It never
//! reaches users, devices or deletion. The report routes of the admin API accept either an admin
//! session or a key with the needed scope. Reporters read answers through `GET /api/me/reports`.

use std::sync::Arc;

use anyhow::Result;
use axum::Json;
use axum::extract::{FromRequestParts, Path, State};
use axum::http::request::Parts;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::admin::Admin;
use crate::db::Db;
use crate::util::{ApiError, ApiResult, hash, now, token};
use crate::{Authed, Relay, bearer};

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS api_keys(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, hint TEXT NOT NULL, scopes TEXT NOT NULL,
  created_at INTEGER NOT NULL, created_by TEXT NOT NULL, last_used INTEGER);
CREATE TABLE IF NOT EXISTS report_answers(
  id INTEGER PRIMARY KEY AUTOINCREMENT, report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  at INTEGER NOT NULL, author TEXT NOT NULL, text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS report_answers_report ON report_answers(report_id);
";

pub const SCOPES: [&str; 2] = ["reports:read", "reports:reply"];
const KEY_PREFIX: &str = "nak_";
const MAX_KEYS: usize = 50;

#[derive(Debug, Clone, Serialize)]
pub struct ApiKeyRow {
    pub id: String,
    pub name: String,
    /// First characters of the key, to recognise it. Never enough to use it.
    pub hint: String,
    pub scopes: Vec<String>,
    pub created_at: i64,
    pub created_by: String,
    pub last_used: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Answer {
    pub at: i64,
    pub text: String,
}

fn key_row(r: &rusqlite::Row) -> rusqlite::Result<ApiKeyRow> {
    let scopes: String = r.get(3)?;
    Ok(ApiKeyRow {
        id: r.get(0)?,
        name: r.get(1)?,
        hint: r.get(2)?,
        scopes: scopes.split(',').filter(|s| !s.is_empty()).map(String::from).collect(),
        created_at: r.get(4)?,
        created_by: r.get(5)?,
        last_used: r.get(6)?,
    })
}

const KEY_COLS: &str = "id, name, hint, scopes, created_at, created_by, last_used";

impl Db {
    pub fn api_key_add(&self, name: &str, key: &str, scopes: &[String], by: &str) -> Result<String> {
        let id = format!("k-{}", &hash(key)[..10]);
        self.0.lock().execute(
            "INSERT INTO api_keys(id, name, hash, hint, scopes, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, name, hash(key), &key[..key.len().min(8)], scopes.join(","), now(), by],
        )?;
        Ok(id)
    }

    pub fn api_keys(&self) -> Result<Vec<ApiKeyRow>> {
        let c = self.0.lock();
        let mut st = c.prepare(&format!("SELECT {KEY_COLS} FROM api_keys ORDER BY created_at DESC"))?;
        Ok(st.query_map([], key_row)?.collect::<rusqlite::Result<_>>()?)
    }

    pub fn api_key_revoke(&self, id: &str) -> Result<Option<String>> {
        let c = self.0.lock();
        let name: Option<String> = c.query_row("SELECT name FROM api_keys WHERE id = ?1", [id], |r| r.get(0)).optional()?;
        c.execute("DELETE FROM api_keys WHERE id = ?1", [id])?;
        Ok(name)
    }

    /// The key behind a presented secret; marks it as used (at most once a minute).
    pub fn api_key_use(&self, key: &str) -> Result<Option<ApiKeyRow>> {
        let c = self.0.lock();
        let row = c.query_row(&format!("SELECT {KEY_COLS} FROM api_keys WHERE hash = ?1"), [hash(key)], key_row).optional()?;
        if let Some(k) = &row
            && k.last_used.is_none_or(|t| t + 60 < now())
        {
            c.execute("UPDATE api_keys SET last_used = ?2 WHERE id = ?1", params![k.id, now()])?;
        }
        Ok(row)
    }

    pub fn answer_add(&self, report_id: &str, author: &str, text: &str) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO report_answers(report_id, at, author, text) VALUES (?1, ?2, ?3, ?4)",
            params![report_id, now(), author, text],
        )?;
        Ok(())
    }

    pub fn answers(&self, report_id: &str, with_author: bool) -> Result<Vec<Value>> {
        let c = self.0.lock();
        let mut st = c.prepare("SELECT at, author, text FROM report_answers WHERE report_id = ?1 ORDER BY id")?;
        Ok(st
            .query_map([report_id], |r| {
                let mut v = json!({ "at": r.get::<_, i64>(0)?, "text": r.get::<_, String>(2)? });
                if with_author {
                    v["author"] = r.get::<_, String>(1)?.into();
                }
                Ok(v)
            })?
            .collect::<rusqlite::Result<_>>()?)
    }

    /// Own reports (newest first) with the answers they got.
    pub fn reports_of(&self, user: &str) -> Result<Vec<Value>> {
        let ids: Vec<(String, i64, i64, String, String)> = {
            let c = self.0.lock();
            let mut st = c.prepare(
                "SELECT id, created_at, updated_at, status, summary FROM reports WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 100",
            )?;
            st.query_map([user], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?.collect::<rusqlite::Result<_>>()?
        };
        ids.into_iter()
            .map(|(id, created_at, updated_at, status, summary)| {
                let answers = self.answers(&id, false)?;
                Ok(json!({ "id": id, "created_at": created_at, "updated_at": updated_at, "status": status, "summary": summary, "answers": answers }))
            })
            .collect()
    }
}

/// Who is calling a report route: an admin session or a key with the needed scope.
pub struct Reporter {
    /// For the audit log: the admin's email or `key:<name>`.
    pub actor: String,
    /// True for an API key (gets less detail than an admin session).
    pub by_key: bool,
}

/// `SCOPE` 0 = reports:read, 1 = reports:reply.
pub struct Scoped<const SCOPE: u8>(pub Reporter);

impl<const SCOPE: u8> FromRequestParts<Arc<Relay>> for Scoped<SCOPE> {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, r: &Arc<Relay>) -> Result<Self, ApiError> {
        let t = bearer(&parts.headers).ok_or_else(ApiError::unauthorized)?;
        if t.starts_with(KEY_PREFIX) {
            let need = SCOPES[SCOPE as usize];
            let k = r.db.api_key_use(t)?.ok_or_else(ApiError::unauthorized)?;
            if !k.scopes.iter().any(|s| s == need) {
                return Err(ApiError::forbidden(format!("this key lacks the scope {need}")));
            }
            return Ok(Scoped(Reporter { actor: format!("key:{}", k.name), by_key: true }));
        }
        let a = r.authenticate(t)?;
        if !a.user.is_admin {
            return Err(ApiError::forbidden("admins only"));
        }
        Ok(Scoped(Reporter { actor: a.user.email, by_key: false }))
    }
}

#[derive(Deserialize)]
pub struct NewKey {
    name: String,
    scopes: Vec<String>,
}

pub async fn list_keys(State(r): State<Arc<Relay>>, _: Admin) -> ApiResult<Json<Value>> {
    Ok(Json(json!({ "keys": r.db.api_keys()?, "scopes": SCOPES })))
}

/// The key itself is in this answer only.
pub async fn create_key(State(r): State<Arc<Relay>>, Admin(a): Admin, Json(b): Json<NewKey>) -> ApiResult<Json<Value>> {
    let name = crate::telemetry::clean(&b.name, 60);
    let mut scopes: Vec<String> = b.scopes.into_iter().filter(|s| SCOPES.contains(&s.as_str())).collect();
    scopes.sort();
    scopes.dedup();
    if name.is_empty() || scopes.is_empty() {
        return Err(ApiError::bad("a name and at least one scope are needed"));
    }
    if r.db.api_keys()?.len() >= MAX_KEYS {
        return Err(ApiError::bad("too many keys, revoke one first"));
    }
    let key = format!("{KEY_PREFIX}{}", token());
    let id = r.db.api_key_add(&name, &key, &scopes, &a.user.email)?;
    r.db.audit_add(&a.user.email, "create api key", &id, &format!("{name} [{}]", scopes.join(", ")));
    Ok(Json(json!({ "id": id, "key": key, "name": name, "scopes": scopes })))
}

pub async fn revoke_key(State(r): State<Arc<Relay>>, Admin(a): Admin, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let name = r.db.api_key_revoke(&id)?.ok_or_else(ApiError::not_found)?;
    r.db.audit_add(&a.user.email, "revoke api key", &id, &name);
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct ReplyBody {
    text: String,
    /// Default `seen`.
    status: Option<String>,
}

/// `POST /api/admin/reports/{id}/reply`.
pub async fn reply(
    State(r): State<Arc<Relay>>,
    Scoped(who): Scoped<1>,
    Path(id): Path<String>,
    Json(b): Json<ReplyBody>,
) -> ApiResult<Json<Value>> {
    let text = crate::telemetry::clean(&b.text, 4000);
    if text.is_empty() {
        return Err(ApiError::bad("write an answer first"));
    }
    let status = b.status.unwrap_or_else(|| "seen".into());
    if !crate::insights::REPORT_STATUSES.contains(&status.as_str()) {
        return Err(ApiError::bad("unknown status"));
    }
    let rep = r.db.report(&id)?.ok_or_else(ApiError::not_found)?;
    let Some(user) = rep.user_id.clone() else {
        return Err(ApiError::bad("this report was sent without signing in, so it cannot be answered"));
    };
    r.db.answer_add(&id, &who.actor, &text)?;
    r.db.update_report(&id, Some(&status), None)?;
    r.db.audit_add(&who.actor, "report reply", &id, &status);
    let r2 = r.clone();
    let body = text.chars().take(140).collect::<String>();
    tokio::spawn(async move { r2.push.notify_report_answer(&r2, &user, &id, &body).await });
    Ok(Json(json!({ "ok": true, "answers": r.db.answers(&rep.id, true)? })))
}

/// `GET /api/me/reports`: the signed-in account's own reports with the answers.
pub async fn mine(State(r): State<Arc<Relay>>, a: Authed) -> ApiResult<Json<Value>> {
    Ok(Json(json!({ "reports": r.db.reports_of(&a.user.id)? })))
}
