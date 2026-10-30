//! Discord Rich Presence (setting `discord_presence`). General shows only that NeuralAgent is in
//! use; Detailed adds the workspace and how many agents run. Nothing shows while no agent runs.
//! Discord not running is normal: the thread retries quietly.

use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::time::{Duration, Instant};

use discord_rich_presence::activity::{Activity, Assets, Button, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use na_protocol::{AgentStatus, DiscordPresence, State};

const APP_ID: &str = "1563621751861153933";
const RETRY: Duration = Duration::from_secs(20);
/// Images come from the website (Discord fetches external URLs), so no dev-portal assets are needed.
const IMAGES: &str = "https://agent.neuralhub.dev/discord";

/// What Discord should show; `None` clears it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Presence {
    pub details: String,
    pub state: Option<String>,
    /// Unix seconds when the first of the running agents started.
    pub since: i64,
    /// The small badge: "waiting" if any agent needs input, else "working" or "idle".
    pub badge: &'static str,
}

/// Derives the presence from the daemon state.
pub fn presence(s: &State) -> Option<Presence> {
    let running: Vec<_> = s.sessions.values().filter(|x| x.alive && is_agent(&x.profile_id)).collect();
    let since = running.iter().map(|x| x.started_at).min()? / 1000;
    let badge = if running.iter().any(|x| x.status == AgentStatus::Waiting) {
        "waiting"
    } else if running.iter().any(|x| x.status == AgentStatus::Working) {
        "working"
    } else {
        "idle"
    };
    match s.settings.discord_presence {
        DiscordPresence::Off => None,
        DiscordPresence::General => Some(Presence { details: "Working with AI agents".into(), state: None, since, badge }),
        DiscordPresence::Detailed => {
            // The workspace with the most recent activity.
            let latest = running.iter().max_by_key(|x| x.status_since)?;
            let workspace = s.workspaces.iter().find(|w| w.id == latest.workspace_id).map_or("a project", |w| w.name.as_str());
            let working = running.iter().filter(|x| x.status == AgentStatus::Working).count();
            let n = running.len();
            let agents = if n == 1 { "1 agent".to_string() } else { format!("{n} agents") };
            Some(Presence {
                details: format!("In {workspace}"),
                state: Some(if working > 0 { format!("{agents} · {working} working") } else { agents }),
                since,
                badge,
            })
        }
    }
}

fn is_agent(profile: &str) -> bool {
    profile != "shell" && !profile.starts_with(crate::profiles::INSTALL_PREFIX)
}

pub struct Discord {
    tx: Sender<Option<Presence>>,
}

impl Discord {
    pub fn start() -> Self {
        let (tx, rx) = channel();
        std::thread::Builder::new().name("discord".into()).spawn(move || run(rx)).expect("spawn discord thread");
        Self { tx }
    }

    pub fn update(&self, p: Option<Presence>) {
        let _ = self.tx.send(p);
    }
}

fn run(rx: Receiver<Option<Presence>>) {
    let mut client: Option<DiscordIpcClient> = None;
    let mut want: Option<Presence> = None;
    let mut shown: Option<Presence> = None;
    let mut last_try: Option<Instant> = None;
    loop {
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(p) => want = p,
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        if want == shown {
            continue;
        }
        if client.is_none() {
            if want.is_none() || last_try.is_some_and(|t| t.elapsed() < RETRY) {
                continue;
            }
            last_try = Some(Instant::now());
            let mut c = DiscordIpcClient::new(APP_ID);
            if c.connect().is_err() {
                continue; // Discord is not running.
            }
            tracing::info!("connected to Discord");
            client = Some(c);
        }
        let Some(c) = client.as_mut() else { continue };
        let result = match &want {
            Some(p) => c.set_activity(activity(p)),
            None => c.clear_activity(),
        };
        match result {
            Ok(()) => shown = want.clone(),
            Err(e) => {
                tracing::info!("Discord went away: {e}");
                let _ = c.close();
                client = None;
                shown = None;
            }
        }
    }
    if let Some(mut c) = client {
        let _ = c.clear_activity();
        let _ = c.close();
    }
}

fn activity(p: &Presence) -> Activity<'_> {
    let (large, small) = (format!("{IMAGES}/logo-512.png"), format!("{IMAGES}/small-{}.png", p.badge));
    let small_text = match p.badge {
        "waiting" => "An agent needs input",
        "working" => "Agents working",
        _ => "Agents idle",
    };
    let mut a = Activity::new()
        .details(p.details.as_str())
        .timestamps(Timestamps::new().start(p.since))
        .assets(Assets::new().large_image(large).large_text("NeuralAgent").small_image(small).small_text(small_text))
        .buttons(vec![Button::new("Get NeuralAgent", "https://agent.neuralhub.dev")]);
    if let Some(s) = &p.state {
        a = a.state(s.as_str());
    }
    a
}

#[cfg(test)]
mod tests {
    use na_protocol::{Session, Settings, Workspace};

    use super::*;

    fn session(id: &str, profile: &str, status: AgentStatus, started: i64) -> Session {
        let mut s: Session = serde_json::from_value(serde_json::json!({
            "id": id, "workspace_id": "w", "profile_id": profile, "title": "", "cwd": "/",
            "status": "idle", "status_source": "output", "status_since": started, "started_at": started,
            "busy_ms": 0, "cols": 80, "rows": 24, "alive": true
        }))
        .unwrap();
        s.status = status;
        s
    }

    /// Needs a running Discord: `cargo test -p na-daemon shows_in_discord -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn shows_in_discord() {
        let mut c = DiscordIpcClient::new(APP_ID);
        c.connect().expect("Discord running");
        let p = Presence { details: "In website".into(), state: Some("2 agents · 1 working".into()), since: now(), badge: "working" };
        c.set_activity(activity(&p)).unwrap();
        let (_, reply) = c.recv().unwrap();
        println!("{reply}");
        assert_eq!(reply["evt"], serde_json::Value::Null, "Discord rejected it: {reply}");
        assert_eq!(reply["data"]["details"], "In website");
        std::thread::sleep(Duration::from_secs(std::env::var("HOLD").ok().and_then(|s| s.parse().ok()).unwrap_or(0)));
        c.clear_activity().unwrap();
    }

    fn now() -> i64 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64
    }

    #[test]
    fn general_hides_details_and_detailed_counts() {
        let mut st = State { settings: Settings::default(), ..Default::default() };
        st.workspaces.push(serde_json::from_value::<Workspace>(serde_json::json!({"id": "w", "name": "website", "path": "/w", "approved": false, "pinned": false, "order": 0, "created_at": 0})).unwrap());
        assert_eq!(presence(&st), None, "nothing running");
        st.sessions.insert("s".into(), session("s", "shell", AgentStatus::Working, 5000));
        assert_eq!(presence(&st), None, "a plain shell is not an agent");
        st.sessions.insert("a".into(), session("a", "claude", AgentStatus::Working, 9000));
        st.sessions.insert("b".into(), session("b", "codex", AgentStatus::Idle, 7000));
        let general = presence(&st).unwrap();
        assert_eq!((general.details.as_str(), general.state, general.since), ("Working with AI agents", None, 7));
        st.settings.discord_presence = DiscordPresence::Detailed;
        let detailed = presence(&st).unwrap();
        assert_eq!(detailed.details, "In website");
        assert_eq!(detailed.state.as_deref(), Some("2 agents · 1 working"));
        st.settings.discord_presence = DiscordPresence::Off;
        assert_eq!(presence(&st), None);
    }
}
