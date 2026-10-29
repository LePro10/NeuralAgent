use std::io::{Read, Write};
use std::time::Duration;

use tracing_subscriber::EnvFilter;

/// `neuralagent-relay health`: exit 0 if the local relay answers (container health check).
fn health() -> ! {
    let port = std::env::var("NA_RELAY_BIND").ok().and_then(|b| b.rsplit(':').next().map(str::to_string)).unwrap_or_else(|| "8080".into());
    let ok = (|| -> std::io::Result<bool> {
        let mut s = std::net::TcpStream::connect_timeout(&format!("127.0.0.1:{port}").parse().expect("addr"), Duration::from_secs(3))?;
        s.set_read_timeout(Some(Duration::from_secs(3)))?;
        s.write_all(b"GET /api/health HTTP/1.0\r\nHost: localhost\r\n\r\n")?;
        let mut buf = String::new();
        s.read_to_string(&mut buf)?;
        Ok(buf.starts_with("HTTP/1.0 200") || buf.starts_with("HTTP/1.1 200"))
    })()
    .unwrap_or(false);
    std::process::exit(if ok { 0 } else { 1 })
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if std::env::args().nth(1).as_deref() == Some("health") {
        health();
    }
    tracing_subscriber::fmt().with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"))).init();
    let cfg = na_relay::config::Config::from_env()?;
    if cfg.test_login {
        tracing::warn!("TEST LOGIN IS ON: anyone can sign in. Development only.");
    }
    na_relay::serve(cfg).await
}
