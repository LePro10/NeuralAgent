//! Push to phones and browsers when an agent needs attention: FCM (Android app) and Web Push
//! (installed web remote, e.g. on iPhone). A computer only says "this session needs you";
//! the relay forwards that minimum — kind, computer id, session id — and the device writes
//! the text. Targets are the account's other devices that are not on screen right now.
use crate::{Relay, util::now};
use aes_gcm::{Aes128Gcm, KeyInit, aead::Aead};
use anyhow::{Context, Result, anyhow, bail};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD as B64};
use hkdf::Hkdf;
use p256::{
    PublicKey, SecretKey,
    ecdsa::{Signature, SigningKey, signature::Signer},
    elliptic_curve::sec1::ToEncodedPoint,
};
use parking_lot::Mutex;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::Sha256;
use std::collections::HashMap;

/// What a device registered to be woken with.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Target {
    Fcm(String),
    Web { endpoint: String, p256dh: String, auth: String },
}

/// Push services a browser may hand out; the relay posts nowhere else.
const WEB_PUSH_HOSTS: &[&str] =
    &["fcm.googleapis.com", "updates.push.services.mozilla.com", "push.services.mozilla.com", "web.push.apple.com"];

impl Target {
    pub fn check(&self) -> Result<()> {
        match self {
            Target::Fcm(t) if !t.is_empty() && t.len() < 4096 => Ok(()),
            Target::Fcm(_) => bail!("bad token"),
            Target::Web { endpoint, p256dh, auth } => {
                let u = url::Url::parse(endpoint)?;
                let host = u.host_str().unwrap_or_default();
                let known = WEB_PUSH_HOSTS.contains(&host) || host.ends_with(".push.apple.com") || host.ends_with(".notify.windows.com");
                // Test builds also accept a local mock push service, for the end-to-end test.
                let mock = cfg!(feature = "test-login") && u.scheme() == "http" && host == "127.0.0.1";
                if !mock && (u.scheme() != "https" || !known) || endpoint.len() > 2048 {
                    bail!("unknown push service");
                }
                let key = B64.decode(p256dh)?;
                PublicKey::from_sec1_bytes(&key).map_err(|_| anyhow!("bad key"))?;
                if B64.decode(auth)?.len() != 16 {
                    bail!("bad auth secret");
                }
                Ok(())
            }
        }
    }
}

#[derive(Deserialize)]
struct ServiceAccount {
    project_id: String,
    client_email: String,
    private_key: String,
    #[serde(default = "token_uri")]
    token_uri: String,
}
fn token_uri() -> String {
    "https://oauth2.googleapis.com/token".into()
}

pub struct Push {
    fcm: Option<(ServiceAccount, rsa::pkcs1v15::SigningKey<Sha256>)>,
    fcm_token: tokio::sync::Mutex<Option<(String, i64)>>,
    vapid: SigningKey,
    /// Per account: (minute, count).
    budget: Mutex<HashMap<String, (i64, u32)>>,
}

/// Pushes per account and minute; an agent swarm finishing at once still fits.
const PER_MINUTE: u32 = 30;

impl Push {
    /// `fcm`: path of the Firebase service-account JSON. `vapid`: the Web Push key (base64url
    /// scalar); without one a key is made and kept in the database.
    pub fn new(fcm: Option<&std::path::Path>, vapid: Option<String>, db: &crate::db::Db) -> Result<Push> {
        let fcm = match fcm {
            Some(p) => {
                let sa: ServiceAccount = serde_json::from_slice(&std::fs::read(p).context("reading the FCM service account")?)?;
                use rsa::pkcs8::DecodePrivateKey;
                let key = rsa::RsaPrivateKey::from_pkcs8_pem(&sa.private_key).context("FCM private key")?;
                Some((sa, rsa::pkcs1v15::SigningKey::<Sha256>::new(key)))
            }
            None => None,
        };
        let scalar = match vapid.or(db.kv_get("vapid")?) {
            Some(s) => B64.decode(s.trim())?,
            None => {
                let k = random_secret();
                let s = B64.encode(k.to_bytes());
                db.kv_set("vapid", &s)?;
                k.to_bytes().to_vec()
            }
        };
        let vapid = SigningKey::from_slice(&scalar).map_err(|_| anyhow!("bad VAPID key"))?;
        Ok(Push { fcm, fcm_token: Default::default(), vapid, budget: Default::default() })
    }

    pub fn fcm_ready(&self) -> bool {
        self.fcm.is_some()
    }

    /// The Web Push application server key browsers subscribe with.
    pub fn vapid_public(&self) -> String {
        B64.encode(self.vapid.verifying_key().to_encoded_point(false).as_bytes())
    }

    fn allow(&self, user: &str) -> bool {
        let minute = now() / 60;
        let mut b = self.budget.lock();
        let e = b.entry(user.to_string()).or_insert((minute, 0));
        if e.0 != minute {
            *e = (minute, 0);
        }
        e.1 += 1;
        e.1 <= PER_MINUTE
    }

    async fn fcm_access(&self, r: &Relay) -> Result<String> {
        let (sa, key) = self.fcm.as_ref().ok_or_else(|| anyhow!("FCM not configured"))?;
        let mut cached = self.fcm_token.lock().await;
        if let Some((t, until)) = cached.as_ref()
            && *until > now() + 60
        {
            return Ok(t.clone());
        }
        let iat = now();
        let claims = json!({ "iss": sa.client_email, "scope": "https://www.googleapis.com/auth/firebase.messaging",
            "aud": sa.token_uri, "iat": iat, "exp": iat + 3600 });
        let signing_input = format!("{}.{}", B64.encode(br#"{"alg":"RS256","typ":"JWT"}"#), B64.encode(claims.to_string()));
        use rsa::signature::{SignatureEncoding, Signer as _};
        let sig = key.sign(signing_input.as_bytes()).to_bytes();
        let jwt = format!("{signing_input}.{}", B64.encode(sig));
        let res: Value = r
            .http
            .post(&sa.token_uri)
            .form(&[("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"), ("assertion", jwt.as_str())])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let token = res["access_token"].as_str().ok_or_else(|| anyhow!("no access token"))?.to_string();
        *cached = Some((token.clone(), iat + res["expires_in"].as_i64().unwrap_or(3600)));
        Ok(token)
    }

    /// Sends one notice to every device of `user` that registered for push and is not on
    /// screen. Gone registrations are dropped.
    pub async fn notify(&self, r: &Relay, user: &str, data: &Notice) -> Result<usize> {
        if !self.allow(user) {
            bail!("push budget used up");
        }
        let mut sent = 0;
        for (device, target) in r.db.push_targets(user)? {
            if r.hub.on_screen(&device) {
                continue;
            }
            let res = match &target {
                Target::Fcm(token) => self.send_fcm(r, token, data).await,
                Target::Web { endpoint, p256dh, auth } => self.send_web(r, endpoint, p256dh, auth, data).await,
            };
            match res {
                Ok(true) => sent += 1,
                Ok(false) => {
                    tracing::info!(%device, "push registration gone, dropped");
                    let _ = r.db.set_push(&device, None);
                }
                Err(e) => tracing::warn!(%device, "push failed: {e:#}"),
            }
        }
        if sent > 0 {
            let _ = r.db.bump("pushes", sent as i64);
        }
        Ok(sent)
    }

    /// Ok(false): the token no longer exists.
    async fn send_fcm(&self, r: &Relay, token: &str, n: &Notice) -> Result<bool> {
        let (sa, _) = self.fcm.as_ref().ok_or_else(|| anyhow!("FCM not configured"))?;
        let access = self.fcm_access(r).await?;
        // Data only: the app builds the notification, so a tap can open the agent.
        let body = json!({ "message": { "token": token, "data": n.fields(),
            "android": { "priority": "high", "ttl": "900s" } } });
        let res = r
            .http
            .post(format!("https://fcm.googleapis.com/v1/projects/{}/messages:send", sa.project_id))
            .bearer_auth(access)
            .json(&body)
            .send()
            .await?;
        match res.status().as_u16() {
            200 => Ok(true),
            404 => Ok(false),
            400 if res.text().await.unwrap_or_default().contains("INVALID_ARGUMENT") => Ok(false),
            s => bail!("FCM answered {s}"),
        }
    }

    async fn send_web(&self, r: &Relay, endpoint: &str, p256dh: &str, auth: &str, n: &Notice) -> Result<bool> {
        let body = encrypt(&serde_json::to_vec(&n.fields())?, &B64.decode(p256dh)?, &B64.decode(auth)?)?;
        let u = url::Url::parse(endpoint)?;
        let aud = u.origin().ascii_serialization();
        let res = r
            .http
            .post(endpoint)
            .header("Authorization", format!("vapid t={}, k={}", self.vapid_jwt(&aud), self.vapid_public()))
            .header("Content-Encoding", "aes128gcm")
            .header("Content-Type", "application/octet-stream")
            .header("TTL", "900")
            .header("Urgency", "high")
            .body(body)
            .send()
            .await?;
        match res.status().as_u16() {
            200..=202 => Ok(true),
            404 | 410 => Ok(false),
            s => bail!("web push answered {s}"),
        }
    }

    fn vapid_jwt(&self, aud: &str) -> String {
        let claims = json!({ "aud": aud, "exp": now() + 12 * 3600, "sub": "mailto:agent@neuralhub.dev" });
        let input = format!("{}.{}", B64.encode(br#"{"typ":"JWT","alg":"ES256"}"#), B64.encode(claims.to_string()));
        let sig: Signature = self.vapid.sign(input.as_bytes());
        format!("{input}.{}", B64.encode(sig.to_bytes()))
    }
}

/// What a computer may say about a session: nothing but which one and why.
#[derive(Debug, Clone, Deserialize)]
pub struct Notice {
    pub kind: String,
    pub sid: String,
    #[serde(skip)]
    pub host: String,
}

impl Notice {
    pub fn valid(&self) -> bool {
        matches!(self.kind.as_str(), "waiting" | "done" | "error")
            && !self.sid.is_empty()
            && self.sid.len() <= 64
            && self.sid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    }
    fn fields(&self) -> Value {
        json!({ "t": "attention", "kind": self.kind, "host": self.host, "sid": self.sid })
    }
}

fn random_secret() -> SecretKey {
    loop {
        let mut b = [0u8; 32];
        rand::rng().fill_bytes(&mut b);
        if let Ok(k) = SecretKey::from_slice(&b) {
            return k;
        }
    }
}

/// RFC 8291 (Web Push message encryption, aes128gcm, one record).
pub fn encrypt(plain: &[u8], ua_public: &[u8], auth: &[u8]) -> Result<Vec<u8>> {
    let ua = PublicKey::from_sec1_bytes(ua_public).map_err(|_| anyhow!("bad key"))?;
    let eph = random_secret();
    let as_public = eph.public_key().to_encoded_point(false);
    let shared = p256::ecdh::diffie_hellman(eph.to_nonzero_scalar(), ua.as_affine());
    let mut info = b"WebPush: info\0".to_vec();
    info.extend_from_slice(ua_public);
    info.extend_from_slice(as_public.as_bytes());
    let mut ikm = [0u8; 32];
    Hkdf::<Sha256>::new(Some(auth), shared.raw_secret_bytes()).expand(&info, &mut ikm).map_err(|_| anyhow!("hkdf"))?;
    let mut salt = [0u8; 16];
    rand::rng().fill_bytes(&mut salt);
    let hk = Hkdf::<Sha256>::new(Some(&salt), &ikm);
    let (mut cek, mut nonce) = ([0u8; 16], [0u8; 12]);
    hk.expand(b"Content-Encoding: aes128gcm\0", &mut cek).map_err(|_| anyhow!("hkdf"))?;
    hk.expand(b"Content-Encoding: nonce\0", &mut nonce).map_err(|_| anyhow!("hkdf"))?;
    let mut record = plain.to_vec();
    record.push(2); // last record
    let ct = Aes128Gcm::new_from_slice(&cek)?.encrypt((&nonce).into(), record.as_slice()).map_err(|_| anyhow!("encrypt"))?;
    let mut out = salt.to_vec();
    out.extend_from_slice(&4096u32.to_be_bytes());
    out.push(as_public.as_bytes().len() as u8);
    out.extend_from_slice(as_public.as_bytes());
    out.extend_from_slice(&ct);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Decrypts like a browser would (RFC 8291 receiver side) to check the sender.
    fn decrypt(body: &[u8], ua_secret: &SecretKey, auth: &[u8]) -> Vec<u8> {
        let salt = &body[..16];
        let idlen = body[20] as usize;
        let as_public = &body[21..21 + idlen];
        let ct = &body[21 + idlen..];
        let ua_public = ua_secret.public_key().to_encoded_point(false);
        let shared = p256::ecdh::diffie_hellman(ua_secret.to_nonzero_scalar(), PublicKey::from_sec1_bytes(as_public).unwrap().as_affine());
        let mut info = b"WebPush: info\0".to_vec();
        info.extend_from_slice(ua_public.as_bytes());
        info.extend_from_slice(as_public);
        let mut ikm = [0u8; 32];
        Hkdf::<Sha256>::new(Some(auth), shared.raw_secret_bytes()).expand(&info, &mut ikm).unwrap();
        let hk = Hkdf::<Sha256>::new(Some(salt), &ikm);
        let (mut cek, mut nonce) = ([0u8; 16], [0u8; 12]);
        hk.expand(b"Content-Encoding: aes128gcm\0", &mut cek).unwrap();
        hk.expand(b"Content-Encoding: nonce\0", &mut nonce).unwrap();
        let mut pt = Aes128Gcm::new_from_slice(&cek).unwrap().decrypt((&nonce).into(), ct).unwrap();
        assert_eq!(pt.pop(), Some(2));
        pt
    }

    #[test]
    fn web_push_round_trip() {
        let ua = random_secret();
        let auth = [7u8; 16];
        let body = encrypt(b"{\"t\":\"attention\"}", ua.public_key().to_encoded_point(false).as_bytes(), &auth).unwrap();
        assert_eq!(&body[16..20], &4096u32.to_be_bytes());
        assert_eq!(decrypt(&body, &ua, &auth), b"{\"t\":\"attention\"}");
    }

    #[test]
    fn targets_and_notices_are_checked() {
        let key = B64.encode(random_secret().public_key().to_encoded_point(false).as_bytes());
        let web = |endpoint: &str| Target::Web { endpoint: endpoint.into(), p256dh: key.clone(), auth: B64.encode([1u8; 16]) };
        assert!(web("https://web.push.apple.com/abc").check().is_ok());
        assert!(web("https://fcm.googleapis.com/fcm/send/abc").check().is_ok());
        assert!(web("https://evil.example/abc").check().is_err());
        assert!(web("http://fcm.googleapis.com/abc").check().is_err());
        let n = |kind: &str, sid: &str| Notice { kind: kind.into(), sid: sid.into(), host: String::new() };
        assert!(n("waiting", "s-1").valid());
        assert!(!n("hello", "s-1").valid());
        assert!(!n("done", "../x").valid());
    }
}
