//! Admin API (`/api/admin`): accounts whose email is in `ADMIN_EMAILS`.
//! Requests, users, devices, sessions, anonymous statistics, usage, downloads, problem reports
//! and the audit log of admin actions (docs/notes/insights.md).

use std::sync::Arc;

use axum::extract::{FromRequestParts, Path, Query, State};
use axum::http::request::Parts;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::db::Status;
use crate::util::{ApiError, ApiResult};
use crate::{Authed, Relay};

pub fn router() -> Router<Arc<Relay>> {
    Router::new()
        .route("/session", get(session))
        .route("/users", get(users))
        .route("/users/{id}", delete(delete_user))
        .route("/users/{id}/devices", get(user_devices))
        .route("/users/{id}/{action}", post(user_action))
        .route("/devices/{id}", delete(delete_device))
        .route("/stats", get(stats))
        .route("/reports", get(reports))
        .route("/reports/{id}", get(report).post(update_report).delete(delete_report))
        .route("/audit", get(audit))
}

/// Signed in with an admin account.
pub struct Admin(Authed);

impl FromRequestParts<Arc<Relay>> for Admin {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, r: &Arc<Relay>) -> Result<Self, ApiError> {
        let a = Authed::from_request_parts(parts, r).await?;
        if !a.user.is_admin {
            return Err(ApiError::forbidden("admins only"));
        }
        Ok(Admin(a))
    }
}

async fn session(Admin(a): Admin) -> ApiResult<Json<Value>> {
    Ok(Json(json!({ "user": a.user })))
}

async fn users(State(r): State<Arc<Relay>>, _: Admin) -> ApiResult<Json<Value>> {
    let online = r.hub.online_by_user();
    let list: Vec<Value> =
        r.db.users()?
            .into_iter()
            .map(|u| {
                let devices = r.db.devices(&u.id).unwrap_or_default();
                let mut v = serde_json::to_value(&u).unwrap_or_default();
                v["devices"] = devices.len().into();
                v["online"] = online.get(&u.id).copied().unwrap_or(0).into();
                v["bytes"] = devices.iter().map(|d| d.bytes).sum::<i64>().into();
                v["last_seen"] = devices.iter().map(|d| d.last_seen).max().into();
                let latest = devices.iter().max_by_key(|d| d.last_seen);
                v["country"] = latest.and_then(|d| d.country.clone()).into();
                let mut platforms: Vec<&str> = devices.iter().map(|d| d.platform.as_str()).collect();
                platforms.sort_unstable();
                platforms.dedup();
                v["platforms"] = platforms.into();
                v
            })
            .collect();
    Ok(Json(json!({ "users": list })))
}

async fn user_action(State(r): State<Arc<Relay>>, Admin(a): Admin, Path((id, action)): Path<(String, String)>) -> ApiResult<Json<Value>> {
    let before = r.db.user(&id)?.ok_or_else(ApiError::not_found)?;
    if before.id == a.user.id && matches!(action.as_str(), "deny" | "block" | "remote_off") {
        return Err(ApiError::bad("you cannot lock yourself out"));
    }
    let user = match action.as_str() {
        "approve" | "unblock" => r.db.set_status(&id, Status::Approved)?,
        "deny" => r.db.set_status(&id, Status::Denied)?,
        "block" => r.db.set_status(&id, Status::Blocked)?,
        "remote_on" => r.db.set_remote(&id, true)?,
        "remote_off" => r.db.set_remote(&id, false)?,
        _ => return Err(ApiError::not_found()),
    }
    .ok_or_else(ApiError::not_found)?;
    tracing::info!(action, "admin changed an account");
    r.db.audit_add(&a.user.email, &action, &user.email, "");
    r.account_changed(&user);
    // Mails only for a decision on an open request.
    if before.status == Status::Pending {
        let (r2, u) = (r.clone(), user.clone());
        match action.as_str() {
            "approve" => drop(tokio::spawn(async move { r2.mail.approved(&u).await })),
            "deny" => drop(tokio::spawn(async move { r2.mail.denied(&u).await })),
            _ => {}
        }
    }
    Ok(Json(json!({ "user": user })))
}

async fn delete_user(State(r): State<Arc<Relay>>, Admin(a): Admin, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    if id == a.user.id {
        return Err(ApiError::bad("you cannot delete yourself"));
    }
    let gone = r.db.user(&id)?.ok_or_else(ApiError::not_found)?;
    r.db.audit_add(&a.user.email, "delete account", &gone.email, "");
    r.access.remove_where(|x| x.user_id == id);
    r.hub.kick_user(&id, "account deleted");
    r.db.delete_user(&id)?;
    tracing::info!("admin deleted an account");
    Ok(Json(json!({ "ok": true })))
}

async fn user_devices(State(r): State<Arc<Relay>>, _: Admin, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    Ok(Json(json!({ "devices": r.hub.device_list(&r, &id) })))
}

async fn delete_device(State(r): State<Arc<Relay>>, Admin(a): Admin, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let d = r.db.device(&id)?.ok_or_else(ApiError::not_found)?;
    let owner = r.db.user(&d.user_id)?.map(|u| u.email).unwrap_or_default();
    r.db.audit_add(&a.user.email, "sign out device", &owner, &d.name);
    r.sign_out_device(&id, "signed out by the admin");
    r.hub.presence(&r, &d.user_id);
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct StatsQuery {
    days: Option<u32>,
}

async fn stats(State(r): State<Arc<Relay>>, _: Admin, Query(q): Query<StatsQuery>) -> ApiResult<Json<Value>> {
    let days = q.days.unwrap_or(30).clamp(1, 365);
    let mut s = r.db.stats(days)?;
    s["online"] = r.hub.connections().into();
    s["totals"] = Value::Object(r.db.totals(days)?);
    s["installs"] = r.db.installs_summary(days)?;
    s["open_reports"] = r.db.open_reports()?.into();
    s["geoip"] = (!r.geo_empty()).into();
    Ok(Json(s))
}

async fn reports(State(r): State<Arc<Relay>>, _: Admin) -> ApiResult<Json<Value>> {
    Ok(Json(json!({ "reports": r.db.reports(500)? })))
}

async fn report(State(r): State<Arc<Relay>>, _: Admin, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let rep = r.db.report(&id)?.ok_or_else(ApiError::not_found)?;
    // The account behind a signed-in report, with its devices (versions, platforms, countries).
    let user = match &rep.user_id {
        Some(uid) => r.db.user(uid)?.map(|u| json!({ "user": u, "devices": r.hub.device_list(&r, uid) })),
        None => None,
    };
    Ok(Json(json!({ "report": rep, "account": user })))
}

#[derive(Deserialize)]
struct ReportUpdate {
    status: Option<String>,
    note: Option<String>,
}

async fn update_report(
    State(r): State<Arc<Relay>>,
    Admin(a): Admin,
    Path(id): Path<String>,
    Json(b): Json<ReportUpdate>,
) -> ApiResult<Json<Value>> {
    if let Some(s) = &b.status
        && !crate::insights::REPORT_STATUSES.contains(&s.as_str())
    {
        return Err(ApiError::bad("unknown status"));
    }
    let note = b.note.as_deref().map(|n| crate::telemetry::clean(n, 4000));
    if !r.db.update_report(&id, b.status.as_deref(), note.as_deref())? {
        return Err(ApiError::not_found());
    }
    if let Some(s) = &b.status {
        r.db.audit_add(&a.user.email, &format!("report {s}"), &id, "");
    }
    Ok(Json(json!({ "report": r.db.report(&id)? })))
}

async fn delete_report(State(r): State<Arc<Relay>>, Admin(a): Admin, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    if !r.db.delete_report(&id)? {
        return Err(ApiError::not_found());
    }
    r.db.audit_add(&a.user.email, "delete report", &id, "");
    Ok(Json(json!({ "ok": true })))
}

async fn audit(State(r): State<Arc<Relay>>, _: Admin) -> ApiResult<Json<Value>> {
    Ok(Json(json!({ "audit": r.db.audit(300)? })))
}
