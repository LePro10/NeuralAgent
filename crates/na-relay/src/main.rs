use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"))).init();
    let cfg = na_relay::config::Config::from_env()?;
    if cfg.test_login {
        tracing::warn!("TEST LOGIN IS ON: anyone can sign in. Development only.");
    }
    na_relay::serve(cfg).await
}
