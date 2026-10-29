//! Passkeys (WebAuthn) as the second factor for the admin area. Only ES256 (P-256) keys, which
//! every platform authenticator (iCloud Keychain, Google Password Manager, Windows Hello) uses.
//! Attestation is not checked: any passkey the admin registers is trusted.

use anyhow::{Context, Result, anyhow, bail, ensure};
use ciborium::Value as Cbor;
use p256::ecdsa::signature::Verifier;
use p256::ecdsa::{Signature, VerifyingKey};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::Relay;
use crate::util::{b64u, token, unb64u};

const UP: u8 = 0x01;
const UV: u8 = 0x04;
const AT: u8 = 0x40;

#[derive(Clone)]
pub struct Challenge {
    pub user_id: String,
    pub register: bool,
}

pub fn challenge(r: &Relay, user_id: &str, register: bool) -> String {
    let c = token();
    r.challenges.insert(c.clone(), Challenge { user_id: user_id.into(), register }, 300);
    c
}

/// Checks `clientDataJSON` (type, our origin, a challenge we issued for this user) and
/// returns its raw bytes.
fn client_data(r: &Relay, b64: &str, register: bool, user_id: &str) -> Result<Vec<u8>> {
    let raw = unb64u(b64).context("clientDataJSON")?;
    let v: Value = serde_json::from_slice(&raw)?;
    let want = if register { "webauthn.create" } else { "webauthn.get" };
    ensure!(v["type"].as_str() == Some(want), "type");
    ensure!(v["origin"].as_str() == Some(r.cfg.public_url.as_str()), "origin");
    let c = v["challenge"].as_str().and_then(|c| r.challenges.take(&c.to_string())).ok_or_else(|| anyhow!("challenge"))?;
    ensure!(c.user_id == user_id && c.register == register, "challenge");
    Ok(raw)
}

struct AuthData {
    flags: u8,
    sign_count: u32,
    /// Registration only: credential id and the key's x, y.
    cred: Option<(Vec<u8>, Vec<u8>, Vec<u8>)>,
}

fn auth_data(r: &Relay, b: &[u8]) -> Result<AuthData> {
    ensure!(b.len() >= 37, "authData too short");
    ensure!(b[..32] == Sha256::digest(r.cfg.rp_id().as_bytes())[..], "rpIdHash");
    let flags = b[32];
    ensure!(flags & UP != 0 && flags & UV != 0, "user presence and verification required");
    let sign_count = u32::from_be_bytes(b[33..37].try_into()?);
    let mut cred = None;
    if flags & AT != 0 {
        ensure!(b.len() >= 55, "attested data too short");
        let len = u16::from_be_bytes([b[53], b[54]]) as usize;
        ensure!(b.len() >= 55 + len, "credential id");
        let id = b[55..55 + len].to_vec();
        let key: Cbor = ciborium::from_reader(&b[55 + len..])?;
        let map = key.as_map().ok_or_else(|| anyhow!("COSE key"))?;
        let get = |k: i64| map.iter().find(|(kk, _)| kk.as_integer().is_some_and(|i| i128::from(i) == k as i128)).map(|(_, v)| v);
        let int = |k: i64| get(k).and_then(|v| v.as_integer()).map(i128::from);
        ensure!(int(1) == Some(2) && int(3) == Some(-7) && int(-1) == Some(1), "only ES256 passkeys are supported");
        let bytes = |k: i64| get(k).and_then(|v| v.as_bytes()).filter(|b| b.len() == 32).cloned().ok_or_else(|| anyhow!("key coordinate"));
        cred = Some((id, bytes(-2)?, bytes(-3)?));
    }
    Ok(AuthData { flags, sign_count, cred })
}

fn key(x: &[u8], y: &[u8]) -> Result<VerifyingKey> {
    let point = p256::EncodedPoint::from_affine_coordinates(p256::FieldBytes::from_slice(x), p256::FieldBytes::from_slice(y), false);
    VerifyingKey::from_encoded_point(&point).map_err(|_| anyhow!("invalid key"))
}

/// Stores a new passkey after `navigator.credentials.create`.
pub fn register(r: &Relay, user_id: &str, id: &str, client_data_b64: &str, attestation_b64: &str) -> Result<()> {
    client_data(r, client_data_b64, true, user_id)?;
    let att: Cbor = ciborium::from_reader(&unb64u(attestation_b64).context("attestationObject")?[..])?;
    let ad = att
        .as_map()
        .and_then(|m| m.iter().find(|(k, _)| k.as_text() == Some("authData")))
        .and_then(|(_, v)| v.as_bytes())
        .ok_or_else(|| anyhow!("authData"))?;
    let ad = auth_data(r, ad)?;
    let (cred_id, x, y) = ad.cred.ok_or_else(|| anyhow!("no credential"))?;
    ensure!(b64u(&cred_id) == id, "credential id");
    key(&x, &y)?;
    r.db.add_passkey(user_id, id, &x, &y, ad.sign_count)
}

/// Checks a `navigator.credentials.get` assertion against the user's passkeys.
pub fn verify(r: &Relay, user_id: &str, id: &str, client_data_b64: &str, auth_data_b64: &str, signature_b64: &str) -> Result<()> {
    let (_, x, y, count) = r.db.passkeys(user_id)?.into_iter().find(|p| p.0 == id).ok_or_else(|| anyhow!("unknown passkey"))?;
    let cd = client_data(r, client_data_b64, false, user_id)?;
    let raw_ad = unb64u(auth_data_b64).context("authenticatorData")?;
    let ad = auth_data(r, &raw_ad)?;
    let _ = ad.flags;
    let sig = Signature::from_der(&unb64u(signature_b64).context("signature")?).map_err(|_| anyhow!("signature format"))?;
    let sig = sig.normalize_s().unwrap_or(sig);
    let mut msg = raw_ad.clone();
    msg.extend_from_slice(&Sha256::digest(&cd));
    key(&x, &y)?.verify(&msg, &sig).map_err(|_| anyhow!("bad signature"))?;
    if (ad.sign_count != 0 || count != 0) && ad.sign_count <= count {
        bail!("passkey counter went backwards (cloned key?)");
    }
    r.db.set_sign_count(id, ad.sign_count)
}

#[cfg(test)]
pub mod testkit {
    //! A software authenticator for tests.
    use super::*;
    use p256::ecdsa::SigningKey;
    use p256::ecdsa::signature::Signer;

    pub struct Authenticator {
        pub key: SigningKey,
        pub id: Vec<u8>,
        pub count: u32,
    }

    impl Default for Authenticator {
        fn default() -> Self {
            Self::new()
        }
    }

    impl Authenticator {
        pub fn new() -> Self {
            Authenticator { key: SigningKey::from_bytes(&[7u8; 32].into()).unwrap(), id: vec![1, 2, 3, 4], count: 0 }
        }

        fn client_data(origin: &str, typ: &str, challenge: &str) -> String {
            b64u(serde_json::json!({ "type": typ, "challenge": challenge, "origin": origin }).to_string().as_bytes())
        }

        fn auth_data(&self, rp_id: &str, flags: u8, attested: bool) -> Vec<u8> {
            let mut b = Sha256::digest(rp_id.as_bytes()).to_vec();
            b.push(flags);
            b.extend_from_slice(&self.count.to_be_bytes());
            if attested {
                b.extend_from_slice(&[0u8; 16]);
                b.extend_from_slice(&(self.id.len() as u16).to_be_bytes());
                b.extend_from_slice(&self.id);
                let p = self.key.verifying_key().to_encoded_point(false);
                let cose = Cbor::Map(vec![
                    (Cbor::Integer(1.into()), Cbor::Integer(2.into())),
                    (Cbor::Integer(3.into()), Cbor::Integer((-7).into())),
                    (Cbor::Integer((-1).into()), Cbor::Integer(1.into())),
                    (Cbor::Integer((-2).into()), Cbor::Bytes(p.x().unwrap().to_vec())),
                    (Cbor::Integer((-3).into()), Cbor::Bytes(p.y().unwrap().to_vec())),
                ]);
                ciborium::into_writer(&cose, &mut b).unwrap();
            }
            b
        }

        /// (id, clientDataJSON, attestationObject)
        pub fn create(&self, origin: &str, rp_id: &str, challenge: &str) -> (String, String, String) {
            let att = Cbor::Map(vec![
                (Cbor::Text("fmt".into()), Cbor::Text("none".into())),
                (Cbor::Text("attStmt".into()), Cbor::Map(vec![])),
                (Cbor::Text("authData".into()), Cbor::Bytes(self.auth_data(rp_id, UP | UV | AT, true))),
            ]);
            let mut a = vec![];
            ciborium::into_writer(&att, &mut a).unwrap();
            (b64u(&self.id), Self::client_data(origin, "webauthn.create", challenge), b64u(&a))
        }

        /// (id, clientDataJSON, authenticatorData, signature)
        pub fn get(&mut self, origin: &str, rp_id: &str, challenge: &str) -> (String, String, String, String) {
            self.count += 1;
            let cd = Self::client_data(origin, "webauthn.get", challenge);
            let ad = self.auth_data(rp_id, UP | UV, false);
            let mut msg = ad.clone();
            msg.extend_from_slice(&Sha256::digest(unb64u(&cd).unwrap()));
            let sig: Signature = self.key.sign(&msg);
            (b64u(&self.id), cd, b64u(&ad), b64u(sig.to_der().as_bytes()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testkit::Authenticator;
    use super::*;
    use crate::config::Config;
    use crate::db::{Db, Identity};

    #[test]
    fn register_then_sign_in_with_a_passkey() {
        let r = Relay::new(Config::local("https://agent.example"), Db::memory().unwrap());
        let (u, _) = r.db.login(&Identity { provider: "test", subject: "a", email: "a@x.y", name: "A", avatar: None }, &[]).unwrap();
        let mut auth = Authenticator::new();
        let (id, cd, att) = auth.create("https://agent.example", "agent.example", &challenge(&r, &u.id, true));
        register(&r, &u.id, &id, &cd, &att).unwrap();

        let (id, cd, ad, sig) = auth.get("https://agent.example", "agent.example", &challenge(&r, &u.id, false));
        verify(&r, &u.id, &id, &cd, &ad, &sig).unwrap();
        // The same challenge cannot be used twice.
        assert!(verify(&r, &u.id, &id, &cd, &ad, &sig).is_err());
        // Wrong origin, wrong rp id, or a challenge for someone else fail.
        let (id, cd, ad, sig) = auth.get("https://evil.example", "agent.example", &challenge(&r, &u.id, false));
        assert!(verify(&r, &u.id, &id, &cd, &ad, &sig).is_err());
        let (id, cd, ad, sig) = auth.get("https://agent.example", "evil.example", &challenge(&r, &u.id, false));
        assert!(verify(&r, &u.id, &id, &cd, &ad, &sig).is_err());
        let (id, cd, ad, sig) = auth.get("https://agent.example", "agent.example", &challenge(&r, "someone-else", false));
        assert!(verify(&r, &u.id, &id, &cd, &ad, &sig).is_err());
        // A tampered signature fails.
        let (id, cd, ad, _) = auth.get("https://agent.example", "agent.example", &challenge(&r, &u.id, false));
        let (_, _, _, other) = auth.get("https://agent.example", "agent.example", "x");
        assert!(verify(&r, &u.id, &id, &cd, &ad, &other).is_err());
    }
}
