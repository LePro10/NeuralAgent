//! Releases: CI uploads the builds of a version, then publishes its manifest. The relay answers
//! the desktop updater (Tauri's dynamic endpoint), the phone app's update check and the landing
//! page's download links, and keeps only the newest versions (the server's disk is small).
//!
//! Layout: `<releases>/<version>/<file>` plus `<version>/manifest.json` once published. A version
//! without a manifest is an upload in progress and invisible.

use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::Context;
use axum::Json;
use axum::Router;
use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Path as UrlPath, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post, put};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

use crate::util::{ApiError, ApiResult};
use crate::{Relay, bearer};

/// Published versions kept on disk.
const KEEP: usize = 3;
/// Largest single upload (an installer).
const MAX_FILE: usize = 600 * 1024 * 1024;

/// What CI publishes for a version.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Manifest {
    pub version: String,
    #[serde(default)]
    pub notes: String,
    /// RFC 3339.
    pub pub_date: String,
    /// Updater bundles by Tauri platform (`darwin-aarch64`, `windows-x86_64`, …).
    #[serde(default)]
    pub updates: BTreeMap<String, Update>,
    /// Installers by kind (`mac`, `mac-intel`, `windows`, `linux`, `linux-deb`, `android`).
    #[serde(default)]
    pub downloads: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Update {
    pub file: String,
    /// Contents of the `.sig` file (minisign, made with the updater key).
    pub signature: String,
}

pub fn router() -> Router<Arc<Relay>> {
    Router::new()
        .route("/releases/latest", get(latest))
        .route("/releases/{version}/files/{name}", put(upload).layer(DefaultBodyLimit::max(MAX_FILE)))
        .route("/releases/{version}/publish", post(publish))
        .route("/update/{target}/{arch}/{current}", get(update))
}

/// `/download/<version>/<file>` and `/download/latest/<kind>`.
pub fn downloads() -> Router<Arc<Relay>> {
    Router::new().route("/download/{version}/{name}", get(download))
}

fn dir(relay: &Relay) -> ApiResult<&Path> {
    relay.cfg.releases.as_deref().ok_or_else(ApiError::not_found)
}

fn uploader(relay: &Relay, headers: &HeaderMap) -> ApiResult<()> {
    let want = relay.cfg.release_token.as_deref().ok_or_else(|| ApiError::forbidden("uploads are off"))?;
    let got = bearer(headers).ok_or_else(ApiError::unauthorized)?;
    // Compared as hashes, so the time taken says nothing about the token.
    if crate::util::hash(got) != crate::util::hash(want) {
        return Err(ApiError::unauthorized());
    }
    Ok(())
}

/// `1.2.3` or `1.2.3-beta.1`.
pub fn valid_version(v: &str) -> bool {
    let (core, pre) = v.split_once('-').unwrap_or((v, ""));
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|p| !p.is_empty() && p.len() <= 6 && p.bytes().all(|b| b.is_ascii_digit()))
        && pre.len() <= 32
        && pre.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.')
        && !(v.contains('-') && pre.is_empty())
}

fn valid_name(n: &str) -> bool {
    !n.is_empty()
        && n.len() <= 120
        && !n.starts_with('.')
        && n != "manifest.json"
        && n.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-+".contains(&b))
}

/// Semver order; a pre-release comes before its release.
pub fn compare(a: &str, b: &str) -> Ordering {
    let split = |v: &str| {
        let (core, pre) = v.split_once('-').map(|(c, p)| (c, Some(p.to_string()))).unwrap_or((v, None));
        let n: Vec<u64> = core.split('.').map(|p| p.parse().unwrap_or(0)).collect();
        (n, pre)
    };
    let (na, pa) = split(a);
    let (nb, pb) = split(b);
    na.cmp(&nb).then_with(|| match (pa, pb) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(x), Some(y)) => x.cmp(&y),
    })
}

/// Published manifests, newest first.
fn published(root: &Path) -> Vec<Manifest> {
    let mut v: Vec<Manifest> = std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| serde_json::from_slice::<Manifest>(&std::fs::read(e.path().join("manifest.json")).ok()?).ok())
        .filter(|m| valid_version(&m.version))
        .collect();
    v.sort_by(|a, b| compare(&b.version, &a.version));
    v
}

/// The newest published release that is not a pre-release (what the public downloads offer).
fn newest_stable(root: &Path) -> ApiResult<Manifest> {
    published(root).into_iter().find(|m| !m.version.contains('-')).ok_or_else(ApiError::not_found)
}

async fn upload(
    State(relay): State<Arc<Relay>>,
    UrlPath((version, name)): UrlPath<(String, String)>,
    headers: HeaderMap,
    body: Body,
) -> ApiResult<StatusCode> {
    uploader(&relay, &headers)?;
    if !valid_version(&version) || !valid_name(&name) {
        return Err(ApiError::bad("bad version or file name"));
    }
    let vdir = dir(&relay)?.join(&version);
    if vdir.join("manifest.json").exists() {
        return Err(ApiError(StatusCode::CONFLICT, "this version is published already".into()));
    }
    tokio::fs::create_dir_all(&vdir).await.context("release dir")?;
    let part = vdir.join(format!(".{name}.part"));
    let mut f = tokio::fs::File::create(&part).await.context("create upload")?;
    let mut stream = body.into_data_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| ApiError::bad(format!("upload broke off: {e}")))?;
        f.write_all(&chunk).await.context("write upload")?;
    }
    f.flush().await.context("flush upload")?;
    drop(f);
    tokio::fs::rename(&part, vdir.join(&name)).await.context("finish upload")?;
    tracing::info!(%version, %name, "release file uploaded");
    Ok(StatusCode::NO_CONTENT)
}

async fn publish(
    State(relay): State<Arc<Relay>>,
    UrlPath(version): UrlPath<String>,
    headers: HeaderMap,
    Json(m): Json<Manifest>,
) -> ApiResult<Json<Manifest>> {
    uploader(&relay, &headers)?;
    if !valid_version(&version) || m.version != version {
        return Err(ApiError::bad("the manifest's version does not match"));
    }
    let root = dir(&relay)?.to_path_buf();
    let vdir = root.join(&version);
    let files = m.updates.values().map(|u| &u.file).chain(m.downloads.values());
    for f in files {
        if !valid_name(f) || !vdir.join(f).is_file() {
            return Err(ApiError::bad(format!("{f} was not uploaded")));
        }
    }
    if m.updates.values().any(|u| u.signature.trim().is_empty()) {
        return Err(ApiError::bad("every update needs its signature"));
    }
    let tmp = vdir.join(".manifest.json.part");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&m).context("manifest")?).context("write manifest")?;
    std::fs::rename(&tmp, vdir.join("manifest.json")).context("publish manifest")?;
    tracing::info!(%version, "release published");
    prune(&root, KEEP);
    Ok(Json(m))
}

/// Keeps the newest `keep` published versions and drops uploads older than the newest.
pub fn prune(root: &Path, keep: usize) {
    let all = published(root);
    let Some(newest) = all.first().map(|m| m.version.clone()) else { return };
    let kept: Vec<&str> = all.iter().take(keep).map(|m| m.version.as_str()).collect();
    for e in std::fs::read_dir(root).into_iter().flatten().flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let is_published = e.path().join("manifest.json").exists();
        let drop = if is_published { !kept.contains(&name.as_str()) } else { compare(&name, &newest) != Ordering::Greater };
        if drop {
            tracing::info!(version = %name, "release removed");
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}

fn file_url(relay: &Relay, version: &str, file: &str) -> String {
    format!("{}/download/{version}/{file}", relay.cfg.public_url)
}

/// Clients poll the update endpoints every few minutes (and on focus); a minute of shared caching
/// lets a proxy or the client absorb bursts without delaying a release noticeably.
fn cached(res: impl IntoResponse) -> Response {
    let mut res = res.into_response();
    res.headers_mut().insert(axum::http::header::CACHE_CONTROL, axum::http::HeaderValue::from_static("public, max-age=60"));
    res
}

/// The newest release for the landing page and the phone app.
async fn latest(State(relay): State<Arc<Relay>>) -> ApiResult<Response> {
    let m = newest_stable(dir(&relay)?)?;
    let downloads: BTreeMap<&String, String> = m.downloads.iter().map(|(k, f)| (k, file_url(&relay, &m.version, f))).collect();
    Ok(cached(Json(serde_json::json!({ "version": m.version, "notes": m.notes, "pub_date": m.pub_date, "downloads": downloads }))))
}

/// Tauri's dynamic update endpoint: 204 when there is nothing newer for this platform.
async fn update(
    State(relay): State<Arc<Relay>>,
    UrlPath((target, arch, current)): UrlPath<(String, String, String)>,
) -> ApiResult<Response> {
    let platform = format!("{target}-{arch}");
    let newer = published(dir(&relay)?)
        .into_iter()
        .filter(|m| current.contains('-') || !m.version.contains('-')) // only testers get pre-releases
        .find(|m| m.updates.contains_key(&platform));
    let Some(m) = newer.filter(|m| compare(&m.version, &current) == Ordering::Greater) else {
        return Ok(cached(StatusCode::NO_CONTENT));
    };
    let u = &m.updates[&platform];
    Ok(cached(Json(serde_json::json!({
        "version": m.version,
        "notes": m.notes,
        "pub_date": m.pub_date,
        "url": file_url(&relay, &m.version, &u.file),
        "signature": u.signature,
    }))))
}

async fn download(State(relay): State<Arc<Relay>>, UrlPath((version, name)): UrlPath<(String, String)>) -> ApiResult<Response> {
    let root = dir(&relay)?;
    if version == "latest" {
        let m = newest_stable(root)?;
        let file = m.downloads.get(&name).ok_or_else(ApiError::not_found)?;
        return Ok(Redirect::temporary(&format!("/download/{}/{file}", m.version)).into_response());
    }
    if !valid_version(&version) || !valid_name(&name) {
        return Err(ApiError::not_found());
    }
    let vdir: PathBuf = root.join(&version);
    if !vdir.join("manifest.json").exists() {
        return Err(ApiError::not_found());
    }
    let path = vdir.join(&name);
    let file = tokio::fs::File::open(&path).await.map_err(|_| ApiError::not_found())?;
    let len = file.metadata().await.context("stat")?.len();
    let body = Body::from_stream(tokio_util::io::ReaderStream::new(file));
    Ok((
        [
            ("content-type", "application/octet-stream".to_string()),
            ("content-length", len.to_string()),
            ("content-disposition", format!("attachment; filename=\"{name}\"")),
            ("cache-control", "public, max-age=31536000, immutable".to_string()),
        ],
        body,
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions() {
        assert!(valid_version("0.1.0") && valid_version("1.20.3-beta.1"));
        assert!(!valid_version("1.2") && !valid_version("../1.2.3") && !valid_version("1.2.3-") && !valid_version("v1.2.3"));
        assert_eq!(compare("0.10.0", "0.9.9"), Ordering::Greater);
        assert_eq!(compare("1.0.0-beta.1", "1.0.0"), Ordering::Less);
        assert_eq!(compare("1.0.0", "1.0.0"), Ordering::Equal);
    }

    /// CI's whole path against a real server: upload, publish, update check, download, pruning.
    #[tokio::test]
    async fn upload_publish_update_prune() {
        let root = std::env::temp_dir().join(format!("na-releases-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let mut cfg = crate::config::Config::local(&base);
        cfg.releases = Some(root.clone());
        cfg.release_token = Some("ci-token".into());
        let relay = Relay::new(cfg, crate::db::Db::memory().unwrap());
        let app = crate::router(relay).into_make_service_with_connect_info::<std::net::SocketAddr>();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let http = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().unwrap();

        let put = |v: &str, name: &str, token: &str| {
            http.put(format!("{base}/api/releases/{v}/files/{name}")).bearer_auth(token).body(format!("{v}:{name}")).send()
        };
        let manifest = |v: &str| {
            json!({ "version": v, "notes": "n", "pub_date": "2026-10-30T00:00:00Z",
                    "updates": { "darwin-aarch64": { "file": "app.tar.gz", "signature": "sig" } },
                    "downloads": { "mac": "app.dmg" } })
        };
        let publish =
            |v: &str, m: serde_json::Value| http.post(format!("{base}/api/releases/{v}/publish")).bearer_auth("ci-token").json(&m).send();
        use serde_json::json;

        assert_eq!(put("0.2.0", "app.tar.gz", "wrong").await.unwrap().status(), 401);
        assert_eq!(put("0.2.0", "../x", "ci-token").await.unwrap().status(), 404); // never reaches a path
        assert_eq!(put("0.2.0", "app.tar.gz", "ci-token").await.unwrap().status(), 204);
        // Not published yet: invisible, and publishing needs every file.
        assert_eq!(http.get(format!("{base}/api/update/darwin/aarch64/0.1.0")).send().await.unwrap().status(), 204);
        assert_eq!(publish("0.2.0", manifest("0.2.0")).await.unwrap().status(), 400);
        assert_eq!(put("0.2.0", "app.dmg", "ci-token").await.unwrap().status(), 204);
        assert_eq!(publish("0.2.0", manifest("0.3.0")).await.unwrap().status(), 400);
        assert_eq!(publish("0.2.0", manifest("0.2.0")).await.unwrap().status(), 200);
        assert_eq!(put("0.2.0", "app.dmg", "ci-token").await.unwrap().status(), 409);

        let u: serde_json::Value = http.get(format!("{base}/api/update/darwin/aarch64/0.1.0")).send().await.unwrap().json().await.unwrap();
        assert_eq!((u["version"].as_str(), u["signature"].as_str()), (Some("0.2.0"), Some("sig")));
        assert_eq!(u["url"], format!("{base}/download/0.2.0/app.tar.gz"));
        let up_to_date = http.get(format!("{base}/api/update/darwin/aarch64/0.2.0")).send().await.unwrap();
        assert_eq!(up_to_date.status(), 204);
        assert_eq!(up_to_date.headers()["cache-control"], "public, max-age=60");
        assert_eq!(http.get(format!("{base}/api/update/windows/x86_64/0.1.0")).send().await.unwrap().status(), 204);
        let body = http.get(format!("{base}/download/0.2.0/app.tar.gz")).send().await.unwrap().text().await.unwrap();
        assert_eq!(body, "0.2.0:app.tar.gz");
        let r = http.get(format!("{base}/download/latest/mac")).send().await.unwrap();
        assert_eq!(r.headers()["location"], "/download/0.2.0/app.dmg");
        let l: serde_json::Value = http.get(format!("{base}/api/releases/latest")).send().await.unwrap().json().await.unwrap();
        assert_eq!(l["downloads"]["mac"], format!("{base}/download/0.2.0/app.dmg"));

        // Three more versions: the oldest goes, a pre-release reaches only testers.
        for v in ["0.3.0", "0.4.0", "0.5.0", "0.6.0-beta.1"] {
            put(v, "app.tar.gz", "ci-token").await.unwrap();
            put(v, "app.dmg", "ci-token").await.unwrap();
            assert_eq!(publish(v, manifest(v)).await.unwrap().status(), 200);
        }
        let left: Vec<String> = {
            let mut v: Vec<String> = std::fs::read_dir(&root).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into()).collect();
            v.sort();
            v
        };
        assert_eq!(left, ["0.4.0", "0.5.0", "0.6.0-beta.1"]);
        let u: serde_json::Value = http.get(format!("{base}/api/update/darwin/aarch64/0.3.0")).send().await.unwrap().json().await.unwrap();
        assert_eq!(u["version"], "0.5.0");
        let u: serde_json::Value =
            http.get(format!("{base}/api/update/darwin/aarch64/0.5.0-beta.2")).send().await.unwrap().json().await.unwrap();
        assert_eq!(u["version"], "0.6.0-beta.1");
        let l: serde_json::Value = http.get(format!("{base}/api/releases/latest")).send().await.unwrap().json().await.unwrap();
        assert_eq!(l["version"], "0.5.0");
        assert_eq!(http.get(format!("{base}/download/0.2.0/app.dmg")).send().await.unwrap().status(), 404);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn names() {
        assert!(valid_name("NeuralAgent_0.2.0_aarch64.dmg") && valid_name("NeuralAgent.app.tar.gz"));
        assert!(!valid_name("../x") && !valid_name(".hidden") && !valid_name("manifest.json") && !valid_name("a/b"));
    }
}
