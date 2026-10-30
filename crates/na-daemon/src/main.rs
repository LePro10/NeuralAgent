//! neuralagentd — the NeuralAgent host daemon.
//!
//! `neuralagentd`            run the daemon (started detached by the desktop app)
//! `neuralagentd hook <ev>`  forward an agent hook event (used inside agent processes)
//! `neuralagentd info`       print where the daemon listens (no secrets)

mod audit;
mod awake;
mod call;
mod claude_view;
mod catalog;
mod core;
mod discord;
mod env;
mod fsbrowse;
mod git;
mod history;
mod host;
mod hooks;
mod layout;
mod llm;
mod mcp;
mod orch;
mod paths;
mod policy;
mod preview;
mod profiles;
mod pty;
mod remote;
mod secrets;
mod server;
mod swarm;
mod usage;

use std::time::Duration;

use anyhow::{Context, Result};
use tracing_subscriber::EnvFilter;

use crate::paths::{DaemonInfo, Paths, write_private};

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("statusline") => {
            hooks::statusline_main();
            Ok(())
        }
        Some("hook") => {
            hooks::client_main(args.get(1).map(String::as_str).unwrap_or(""), args.get(2).map(String::as_str));
            Ok(())
        }
        Some("swarm-mcp") => {
            swarm::bridge_main();
            Ok(())
        }
        Some("info") => {
            let paths = Paths::resolve()?;
            let info = DaemonInfo::read(&paths).context("daemon has not run yet")?;
            println!("data: {}\nport: {}\npid: {}\nversion: {}", paths.root.display(), info.port, info.pid, info.version);
            Ok(())
        }
        Some("--version") | Some("-V") => {
            println!("neuralagentd {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        None | Some("serve") => serve(),
        Some(other) => anyhow::bail!("unknown command {other}"),
    }
}

fn serve() -> Result<()> {
    let paths = Paths::resolve()?;
    init_logging(&paths);

    // One daemon per data dir. The lock is held for the lifetime of the process.
    let lock = std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(paths.lock())?;
    if lock.try_lock().is_err() {
        eprintln!("neuralagentd is already running");
        std::process::exit(3);
    }

    let env = env::LoginEnv::capture();
    tracing::info!(shell = %env.shell, "login environment captured ({} vars)", env.vars.len());

    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build()?;
    rt.block_on(async move {
        let core = core::Core::load(paths.clone(), env);
        let port: u16 = std::env::var("NEURALAGENT_DAEMON_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(0);
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
        let port = listener.local_addr()?.port();
        *core.port.lock() = port;
        core.resume_after_restart();
        remote::start(&core);
        core.orch_status();
        tokio::spawn(orch::watch(core.clone()));
        {
            let core = core.clone();
            std::thread::spawn(move || core.refresh_catalog());
        }
        let token = server::random_token();
        let info = DaemonInfo {
            port,
            token: token.clone(),
            pid: std::process::id(),
            version: env!("CARGO_PKG_VERSION").into(),
            protocol: na_protocol::PROTOCOL_VERSION,
        };
        write_private(&paths.daemon_json(), &serde_json::to_vec_pretty(&info)?)?;
        tracing::info!(port, "listening");

        {
            let core = core.clone();
            let awake = awake::Awake::start();
            let discord = discord::Discord::start();
            tokio::spawn(async move {
                let mut tick = tokio::time::interval(Duration::from_millis(333));
                let mut n = 0u32;
                loop {
                    tick.tick().await;
                    core.tick();
                    core.swarm_tick();
                    n += 1;
                    if n.is_multiple_of(3) {
                        let (setting, working) = core
                            .read(|s| (s.settings.keep_awake, s.sessions.values().any(|x| x.status == na_protocol::AgentStatus::Working)));
                        awake.update(setting, working);
                        discord.update(core.read(discord::presence));
                    }
                    if n.is_multiple_of(30) {
                        core.call_tick();
                    }
                    if n.is_multiple_of(15) {
                        let core = core.clone();
                        tokio::task::spawn_blocking(move || core.refresh_git());
                    }
                    if n % 30 == 1 {
                        let core = core.clone();
                        tokio::task::spawn_blocking(move || core.refresh_usage());
                    }
                    if n.is_multiple_of(3)
                        && let Err(e) = core.save_if_dirty()
                    {
                        tracing::error!("saving state: {e:#}");
                    }
                }
            });
        }

        let app = server::App { core: core.clone(), token: std::sync::Arc::new(token) };
        let shutdown_core = core.clone();
        axum::serve(listener, server::router(app))
            .with_graceful_shutdown(async move {
                shutdown_signal().await;
                tracing::info!("shutting down");
                shutdown_core.shutdown();
            })
            .await?;
        let _ = std::fs::remove_file(paths.daemon_json());
        anyhow::Ok(())
    })?;
    drop(lock);
    Ok(())
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        let mut term = signal(SignalKind::terminate()).expect("sigterm handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = term.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

fn init_logging(paths: &Paths) {
    let filter = EnvFilter::try_from_env("NEURALAGENT_LOG").unwrap_or_else(|_| EnvFilter::new("info"));
    let log = paths.log();
    let _ = std::fs::create_dir_all(log.parent().unwrap());
    // Keep one previous log.
    if std::fs::metadata(&log).map(|m| m.len() > 5 << 20).unwrap_or(false) {
        let _ = std::fs::rename(&log, log.with_extension("old.log"));
    }
    match std::fs::OpenOptions::new().create(true).append(true).open(&log) {
        Ok(file) => tracing_subscriber::fmt().with_env_filter(filter).with_ansi(false).with_writer(std::sync::Mutex::new(file)).init(),
        Err(_) => tracing_subscriber::fmt().with_env_filter(filter).init(),
    }
}
