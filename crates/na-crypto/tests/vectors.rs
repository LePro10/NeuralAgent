//! Cross-implementation vectors. Regenerate with NA_WRITE_VECTORS=1 (only when the spec changes).
use na_crypto::*;
use serde_json::{Value, json};

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
fn key(fill: u8) -> StaticKey {
    StaticKey::from_bytes(std::array::from_fn(|i| fill.wrapping_add(i as u8)))
}

fn compute() -> Value {
    let (c, h, e, f) = (key(0x10), key(0x40), key(0x70), key(0xa0));
    let (hs, e_pub) = ClientHandshake::start_with(&c, h.public(), key(0x70));
    let (f_pub, mut host) = host_accept_with(&h, e_pub, c.public(), key(0xa0)).unwrap();
    let mut client = hs.finish(f_pub).unwrap();
    // Independently derive the traffic keys for the vectors.
    let dh = |a: &StaticKey, p: [u8; 32]| {
        x25519_dalek::StaticSecret::from(a.to_bytes()).diffie_hellman(&x25519_dalek::PublicKey::from(p)).to_bytes()
    };
    let mut ikm = Vec::new();
    for d in [dh(&e, h.public()), dh(&c, h.public()), dh(&e, f.public()), dh(&c, f.public())] {
        ikm.extend_from_slice(&d);
    }
    let mut okm = [0u8; 64];
    hkdf::Hkdf::<sha2::Sha256>::new(Some(client.th()), &ikm).expand(b"NA-E2E-v1 keys", &mut okm).unwrap();
    let msgs_c: [&[u8]; 2] = ["hello host".as_bytes(), &[0, 1, 2, 255]];
    let mut c2h = vec![];
    for m in msgs_c {
        let fr = client.seal(m);
        assert_eq!(host.open(&fr).unwrap(), m);
        c2h.push(json!({"plaintext": hex(m), "frame": hex(&fr)}));
    }
    let m = "hello client".as_bytes();
    let fr = host.seal(m);
    assert_eq!(client.open(&fr).unwrap(), m);
    json!({
        "c_priv": hex(&c.to_bytes()), "h_priv": hex(&h.to_bytes()),
        "e_priv": hex(&e.to_bytes()), "f_priv": hex(&f.to_bytes()),
        "c_pub": hex(&c.public()), "h_pub": hex(&h.public()),
        "e_pub": hex(&e_pub), "f_pub": hex(&f_pub),
        "fingerprint_h": fingerprint(&h.public()),
        "th": hex(client.th()),
        "k_c2h": hex(&okm[..32]), "k_h2c": hex(&okm[32..]),
        "c2h": c2h,
        "h2c": [{"plaintext": hex(m), "frame": hex(&fr)}],
    })
}

#[test]
fn vectors_match_file() {
    let got = compute();
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/vectors.json");
    if std::env::var("NA_WRITE_VECTORS").is_ok() {
        std::fs::write(path, serde_json::to_string_pretty(&got).unwrap() + "\n").unwrap();
    }
    let want: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(got, want);
}
