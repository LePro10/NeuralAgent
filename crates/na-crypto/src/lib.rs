//! NeuralAgent E2E encryption v1. The TS twin lives in `packages/crypto`.

use aes_gcm::aead::{Aead, KeyInit, OsRng, Payload, rand_core::RngCore};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroize;

const LABEL: &[u8] = b"NA-E2E-v1";
const INFO: &[u8] = b"NA-E2E-v1 keys";

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("degenerate Diffie-Hellman output (low-order public key)")]
    ZeroDh,
    #[error("frame too short")]
    ShortFrame,
    #[error("unexpected frame counter")]
    Counter,
    #[error("authentication failed")]
    Auth,
    #[error("invalid base64")]
    Base64,
}
pub type Result<T> = std::result::Result<T, Error>;

pub fn b64(data: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(data)
}
pub fn unb64(s: &str) -> Result<Vec<u8>> {
    URL_SAFE_NO_PAD.decode(s).map_err(|_| Error::Base64)
}
/// Lowercase hex of the first 16 bytes of SHA-256(pub).
pub fn fingerprint(public: &[u8; 32]) -> String {
    Sha256::digest(public)[..16].iter().map(|b| format!("{b:02x}")).collect()
}

/// X25519 key (static or ephemeral).
pub struct StaticKey(StaticSecret);

impl StaticKey {
    pub fn generate() -> Self {
        let mut b = [0u8; 32];
        OsRng.fill_bytes(&mut b);
        let k = Self::from_bytes(b);
        b.zeroize();
        k
    }
    pub fn from_bytes(b: [u8; 32]) -> Self {
        Self(StaticSecret::from(b))
    }
    pub fn to_bytes(&self) -> [u8; 32] {
        self.0.to_bytes()
    }
    pub fn public(&self) -> [u8; 32] {
        PublicKey::from(&self.0).to_bytes()
    }
    fn dh(&self, peer: &[u8; 32]) -> Result<[u8; 32]> {
        let out = self.0.diffie_hellman(&PublicKey::from(*peer)).to_bytes();
        if out.iter().all(|&b| b == 0) { Err(Error::ZeroDh) } else { Ok(out) }
    }
}

fn transcript(e: &[u8; 32], c: &[u8; 32], h: &[u8; 32], f: &[u8; 32]) -> [u8; 32] {
    let mut s = Sha256::new();
    s.update(LABEL);
    for p in [e, c, h, f] {
        s.update(p);
    }
    s.finalize().into()
}

fn derive(th: [u8; 32], dhs: [[u8; 32]; 4], client: bool) -> Session {
    let mut ikm = [0u8; 128];
    for (i, d) in dhs.iter().enumerate() {
        ikm[i * 32..(i + 1) * 32].copy_from_slice(d);
    }
    let mut okm = [0u8; 64];
    Hkdf::<Sha256>::new(Some(&th), &ikm).expand(INFO, &mut okm).expect("64 bytes is valid");
    ikm.zeroize();
    let (c2h, h2c) = okm.split_at(32);
    let (s, r) = if client { (c2h, h2c) } else { (h2c, c2h) };
    let session = Session {
        send: Aes256Gcm::new_from_slice(s).expect("32-byte key"),
        recv: Aes256Gcm::new_from_slice(r).expect("32-byte key"),
        th,
        send_ctr: 0,
        recv_ctr: 0,
    };
    okm.zeroize();
    session
}

pub struct ClientHandshake {
    c: StaticKey,
    e: StaticKey,
    host_pub: [u8; 32],
}

impl ClientHandshake {
    /// Returns the handshake state and the ephemeral public key to send (msg1: e_pub, c_pub).
    pub fn start(c: &StaticKey, host_pub: [u8; 32]) -> (Self, [u8; 32]) {
        Self::start_with(c, host_pub, StaticKey::generate())
    }
    pub fn start_with(c: &StaticKey, host_pub: [u8; 32], e: StaticKey) -> (Self, [u8; 32]) {
        let e_pub = e.public();
        (Self { c: StaticKey::from_bytes(c.to_bytes()), e, host_pub }, e_pub)
    }
    pub fn finish(self, f_pub: [u8; 32]) -> Result<Session> {
        let th = transcript(&self.e.public(), &self.c.public(), &self.host_pub, &f_pub);
        let dhs = [self.e.dh(&self.host_pub)?, self.c.dh(&self.host_pub)?, self.e.dh(&f_pub)?, self.c.dh(&f_pub)?];
        Ok(derive(th, dhs, true))
    }
}

pub fn host_accept(h: &StaticKey, e_pub: [u8; 32], c_pub: [u8; 32]) -> Result<([u8; 32], Session)> {
    host_accept_with(h, e_pub, c_pub, StaticKey::generate())
}

pub fn host_accept_with(h: &StaticKey, e_pub: [u8; 32], c_pub: [u8; 32], f: StaticKey) -> Result<([u8; 32], Session)> {
    let f_pub = f.public();
    let th = transcript(&e_pub, &c_pub, &h.public(), &f_pub);
    let dhs = [h.dh(&e_pub)?, h.dh(&c_pub)?, f.dh(&e_pub)?, f.dh(&c_pub)?];
    Ok((f_pub, derive(th, dhs, false)))
}

pub struct Session {
    send: Aes256Gcm,
    recv: Aes256Gcm,
    th: [u8; 32],
    send_ctr: u64,
    recv_ctr: u64,
}

fn nonce(counter: u64) -> [u8; 12] {
    let mut n = [0u8; 12];
    n[4..].copy_from_slice(&counter.to_be_bytes());
    n
}

impl Session {
    pub fn th(&self) -> &[u8; 32] {
        &self.th
    }
    pub fn seal(&mut self, pt: &[u8]) -> Vec<u8> {
        let ctr = self.send_ctr;
        let ct = self.send.encrypt(Nonce::from_slice(&nonce(ctr)), Payload { msg: pt, aad: &self.th }).expect("AES-GCM encrypt");
        self.send_ctr += 1;
        let mut frame = Vec::with_capacity(8 + ct.len());
        frame.extend_from_slice(&ctr.to_be_bytes());
        frame.extend_from_slice(&ct);
        frame
    }
    pub fn open(&mut self, frame: &[u8]) -> Result<Vec<u8>> {
        if frame.len() < 24 {
            return Err(Error::ShortFrame);
        }
        let ctr = u64::from_be_bytes(frame[..8].try_into().expect("8 bytes"));
        if ctr != self.recv_ctr {
            return Err(Error::Counter);
        }
        let pt = self.recv.decrypt(Nonce::from_slice(&nonce(ctr)), Payload { msg: &frame[8..], aad: &self.th }).map_err(|_| Error::Auth)?;
        self.recv_ctr += 1;
        Ok(pt)
    }
}
