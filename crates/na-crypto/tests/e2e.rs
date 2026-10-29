use na_crypto::*;

fn pair() -> (Session, Session) {
    let c = StaticKey::generate();
    let h = StaticKey::generate();
    let (hs, e) = ClientHandshake::start(&c, h.public());
    let (f, host) = host_accept(&h, e, c.public()).unwrap();
    (hs.finish(f).unwrap(), host)
}

#[test]
fn roundtrip_both_directions() {
    let (mut c, mut h) = pair();
    assert_eq!(c.th(), h.th());
    for i in 0..3u8 {
        assert_eq!(h.open(&c.seal(&[i; 5])).unwrap(), vec![i; 5]);
        assert_eq!(c.open(&h.seal(b"back")).unwrap(), b"back");
    }
    assert_eq!(h.open(&c.seal(b"")).unwrap(), b"");
}

#[test]
fn replay_and_out_of_order_rejected() {
    let (mut c, mut h) = pair();
    let f0 = c.seal(b"a");
    let f1 = c.seal(b"b");
    assert!(matches!(h.open(&f1), Err(Error::Counter)));
    h.open(&f0).unwrap();
    assert!(matches!(h.open(&f0), Err(Error::Counter)));
    h.open(&f1).unwrap();
}

#[test]
fn tamper_rejected_and_counter_kept() {
    let (mut c, mut h) = pair();
    let f = c.seal(b"hello");
    for i in 8..f.len() {
        let mut t = f.clone();
        t[i] ^= 1;
        assert!(matches!(h.open(&t), Err(Error::Auth)));
    }
    assert!(matches!(h.open(&f[..23]), Err(Error::ShortFrame)));
    assert_eq!(h.open(&f).unwrap(), b"hello");
}

#[test]
fn wrong_direction_rejected() {
    let (mut c, _h) = pair();
    let f = c.seal(b"x");
    assert!(c.open(&f).is_err());
}

#[test]
fn zero_dh_rejected() {
    let c = StaticKey::generate();
    let h = StaticKey::generate();
    let (hs, _e) = ClientHandshake::start(&c, h.public());
    assert!(matches!(hs.finish([0u8; 32]), Err(Error::ZeroDh)));
    assert!(matches!(host_accept(&h, [0u8; 32], c.public()), Err(Error::ZeroDh)));
    let (_, e) = ClientHandshake::start(&c, h.public());
    assert!(matches!(host_accept(&h, e, [0u8; 32]), Err(Error::ZeroDh)));
}

#[test]
fn helpers() {
    assert_eq!(unb64(&b64(&[251, 255, 0])).unwrap(), vec![251, 255, 0]);
    assert_eq!(fingerprint(&[0u8; 32]).len(), 32);
    assert!(unb64("a=b!").is_err());
}
