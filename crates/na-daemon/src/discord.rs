//! Discord Rich Presence (Settings → Discord, D72). `discord_presence` is a privacy preset (Off,
//! General, Detailed, Stats) or `custom`, where `Settings.discord` picks what each part of the card
//! shows: the two text lines, the tooltip of the big image, party size, timer and button. Workspace
//! names appear only with `project_names`. Nothing shows while no agent runs.
//!
//! The card is computed here from the daemon state (`card`), sent to Discord at most every 15 s
//! (Discord itself allows 5 updates per 20 s) and exposed to Settings through `discord_preview`, so
//! the preview there is exactly what Discord gets. Discord not running is normal: the thread retries
//! quietly.

use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, TryRecvError, channel};
use std::time::{Duration, Instant};

use chrono::{Local, NaiveDate};
use discord_rich_presence::activity::{Activity, Assets, Button, Party, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use na_protocol::{
    AgentStatus, DiscordCard, DiscordOptions, DiscordPresence, DiscordPreview, DiscordStat, Id, Session, SessionUsage, State, TokenCounts,
};

use crate::core::{Core, now_ms};

const APP_ID: &str = "1563621751861153933";
const RETRY: Duration = Duration::from_secs(20);
/// At most one update this often.
const MIN_GAP: Duration = Duration::from_secs(15);
/// Images come from the website (Discord fetches external URLs), so no dev-portal assets are needed.
const IMAGES: &str = "https://agent.neuralhub.dev/discord";
const BUTTON: (&str, &str) = ("Get NeuralAgent", "https://agent.neuralhub.dev");
/// Discord rejects longer lines.
const MAX_LINE: usize = 128;

// ───────────── what the card says ─────────────

/// Numbers that are not in `State`: running subagents, today's usage, agent time per day.
#[derive(Clone, Debug, Default)]
pub struct Extra {
    pub subagents: HashMap<Id, u32>,
    pub tokens_today: u64,
    pub cost_today: Option<f64>,
    /// `YYYY-MM-DD` → ms agents spent working (finished stretches).
    pub busy_days: BTreeMap<String, i64>,
    pub today: Option<NaiveDate>,
    pub now_ms: i64,
}

/// Reads the numbers the card may need. Cheap: no transcript is read here.
pub fn gather(core: &Core) -> Extra {
    // Called on the daemon's 333 ms tick: today's usage is summed at most every 10 s, and never
    // waits for the usage scan (the first one after start holds the rows for a while).
    static USAGE: Mutex<Option<(Instant, u64, Option<f64>)>> = Mutex::new(None);
    let (rows, busy_days) = match USAGE.lock().ok().and_then(|g| *g) {
        Some((at, ..)) if at.elapsed() < Duration::from_secs(10) => (None, core.busy_days()),
        _ => core.usage_today(),
    };
    let mut cache = USAGE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(rows) = rows {
        let tokens = rows.iter().map(|r| total(&r.tokens)).sum();
        let costs: Vec<f64> = rows.iter().filter_map(|r| r.cost_usd).collect();
        *cache = Some((Instant::now(), tokens, (!costs.is_empty()).then(|| costs.iter().sum())));
    }
    let (tokens_today, cost_today) = cache.map(|(_, t, c)| (t, c)).unwrap_or((0, None));
    drop(cache);
    Extra {
        subagents: core.cv.subagents_running(),
        tokens_today,
        cost_today,
        busy_days,
        today: Some(Local::now().date_naive()),
        now_ms: now_ms(),
    }
}

/// The options a preset stands for; `None` for Off.
pub fn resolve(level: DiscordPresence, custom: &DiscordOptions) -> Option<DiscordOptions> {
    let base = DiscordOptions { party: false, timer: true, button: true, project_names: false, ..DiscordOptions::default() };
    Some(match level {
        DiscordPresence::Off => return None,
        DiscordPresence::General => {
            DiscordOptions { details: DiscordStat::Activity, state: DiscordStat::None, hover: DiscordStat::None, ..base }
        }
        DiscordPresence::Detailed => DiscordOptions {
            details: DiscordStat::Project,
            state: DiscordStat::Agents,
            hover: DiscordStat::Model,
            project_names: true,
            ..base
        },
        DiscordPresence::Stats => {
            DiscordOptions { details: DiscordStat::Agents, state: DiscordStat::TokensToday, hover: DiscordStat::Streak, ..base }
        }
        DiscordPresence::Custom => custom.clone(),
    })
}

/// The card for the saved settings, `None` when off or no agent runs.
pub fn presence(s: &State, x: &Extra) -> Option<DiscordCard> {
    card(s, x, &resolve(s.settings.discord_presence, &s.settings.discord)?)
}

/// The card these options give for this state; `None` while no agent runs.
pub fn card(s: &State, x: &Extra, o: &DiscordOptions) -> Option<DiscordCard> {
    let running: Vec<&Session> = s.sessions.values().filter(|x| x.alive && is_agent(&x.profile_id)).collect();
    let since = running.iter().map(|x| x.started_at).min()? / 1000;
    let working = running.iter().filter(|x| x.status == AgentStatus::Working).count() as u32;
    let waiting = running.iter().any(|x| x.status == AgentStatus::Waiting);
    let badge = if waiting {
        "waiting"
    } else if working > 0 {
        "working"
    } else {
        "idle"
    };
    let ctx = Ctx { s, x, o, running: &running, working, badge };
    let details = ctx.line(o.details).unwrap_or_else(|| ctx.line(DiscordStat::Activity).unwrap_or_default());
    let mut state = ctx.line(o.state).filter(|l| *l != details);
    let party = (o.party && working > 0).then_some([working, running.len() as u32]);
    // Discord shows the party size only after a second line.
    if party.is_some() && state.is_none() {
        state = Some(if working == 1 { "Agent working".into() } else { "Agents working".into() });
    }
    let small_text = match badge {
        "waiting" => "An agent needs input".to_string(),
        "working" => format!("{working} working"),
        _ => "Agents idle".to_string(),
    };
    Some(DiscordCard {
        details: clip(&details),
        state: state.map(|l| clip(&l)),
        large_text: ctx.line(o.hover).map_or_else(|| "NeuralAgent".to_string(), |l| clip(&l)),
        badge: badge.into(),
        small_text,
        start: o.timer.then_some(since),
        party,
        buttons: if o.button { vec![BUTTON.0.into()] } else { vec![] },
    })
}

struct Ctx<'a> {
    s: &'a State,
    x: &'a Extra,
    o: &'a DiscordOptions,
    running: &'a [&'a Session],
    working: u32,
    badge: &'static str,
}

impl Ctx<'_> {
    /// The agent with the most recent activity.
    fn latest(&self) -> Option<&Session> {
        self.running.iter().max_by_key(|x| x.status_since).copied()
    }

    /// One line, or `None` when the stat has nothing to say right now.
    fn line(&self, stat: DiscordStat) -> Option<String> {
        let n = self.running.len();
        match stat {
            DiscordStat::None => None,
            DiscordStat::Activity => Some(
                match self.badge {
                    "working" => "Working with AI agents",
                    "waiting" => "An agent needs input",
                    _ => "Agents standing by",
                }
                .into(),
            ),
            DiscordStat::Agents => {
                let agents = plural(n as u64, "agent", "agents");
                Some(if self.working > 0 { format!("{agents} · {} working", self.working) } else { agents })
            }
            DiscordStat::Subagents => {
                let k: u32 = self.running.iter().filter_map(|x| self.x.subagents.get(&x.id)).sum();
                (k > 0).then(|| format!("{} running", plural(u64::from(k), "subagent", "subagents")))
            }
            DiscordStat::Project => Some(match self.project() {
                Some(name) => format!("In {name}"),
                None => "In a project".into(),
            }),
            DiscordStat::Model => {
                let mut labels: Vec<String> = Vec::new();
                let mut by_recent: Vec<&&Session> = self.running.iter().collect();
                by_recent.sort_by_key(|x| std::cmp::Reverse(x.status_since));
                for m in by_recent.iter().filter_map(|x| x.usage.as_ref()?.model.as_deref()).map(model_label) {
                    if !labels.contains(&m) {
                        labels.push(m);
                    }
                }
                join_some(labels, 2)
            }
            DiscordStat::Engine => {
                let mut names: Vec<String> = Vec::new();
                for x in self.running {
                    let name = self.engine_name(&x.profile_id);
                    if !names.contains(&name) {
                        names.push(name);
                    }
                }
                join_some(names, 3)
            }
            DiscordStat::TokensSession => {
                let t: u64 = self.running.iter().filter_map(|x| x.usage.as_ref()).map(|u| total(&u.tokens)).sum();
                (t > 0).then(|| format!("{} tokens this session", compact(t)))
            }
            DiscordStat::TokensToday => (self.x.tokens_today > 0).then(|| format!("{} tokens today", compact(self.x.tokens_today))),
            DiscordStat::CostToday => self.x.cost_today.filter(|c| *c >= 0.01).map(|c| format!("${c:.2} at API prices today")),
            DiscordStat::AgentTime => {
                let live: i64 =
                    self.running.iter().filter(|x| x.status == AgentStatus::Working).map(|x| (self.x.now_ms - x.status_since).max(0)).sum();
                let today =
                    self.x.today.map(|d| d.format("%Y-%m-%d").to_string()).and_then(|d| self.x.busy_days.get(&d).copied()).unwrap_or(0);
                let ms = today + live;
                (ms >= 60_000).then(|| format!("{} of agent work today", duration(ms)))
            }
            DiscordStat::Streak => {
                let d = streak(&self.x.busy_days, self.x.today?, self.working > 0);
                (d > 0).then(|| if d == 1 { "Day 1 of a streak".into() } else { format!("{d}-day streak") })
            }
            DiscordStat::Files => {
                let latest = self.latest()?;
                let ws = self.s.workspaces.iter().find(|w| w.id == latest.workspace_id)?;
                let changed = ws.git.as_ref()?.changed;
                (changed > 0).then(|| {
                    let files = format!("{} changed", plural(u64::from(changed), "file", "files"));
                    match self.project() {
                        Some(name) => format!("{files} in {name}"),
                        None => files,
                    }
                })
            }
        }
    }

    /// The workspace of the most recent agent, if names may show.
    fn project(&self) -> Option<&str> {
        if !self.o.project_names {
            return None;
        }
        let latest = self.latest()?;
        self.s.workspaces.iter().find(|w| w.id == latest.workspace_id).map(|w| w.name.as_str())
    }

    fn engine_name(&self, profile_id: &str) -> String {
        let profile = self.s.profiles.iter().find(|p| p.id == profile_id);
        let engine = profile.map_or(profile_id, |p| p.engine.as_str());
        self.s
            .catalog
            .iter()
            .find(|c| c.id == engine)
            .map(|c| c.name.clone())
            .or_else(|| profile.map(|p| p.name.clone()))
            .unwrap_or_else(|| engine.to_string())
    }
}

fn is_agent(profile: &str) -> bool {
    profile != "shell" && !profile.starts_with(crate::profiles::INSTALL_PREFIX)
}

fn total(t: &TokenCounts) -> u64 {
    t.input + t.output + t.cache_read + t.cache_write
}

fn plural(n: u64, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

/// "A + B", or "A + B +2" when there are more.
fn join_some(items: Vec<String>, keep: usize) -> Option<String> {
    if items.is_empty() {
        return None;
    }
    let more = items.len().saturating_sub(keep);
    let head = items.into_iter().take(keep).collect::<Vec<_>>().join(" + ");
    Some(if more > 0 { format!("{head} +{more}") } else { head })
}

/// 950, 12.4k, 1.2M, 3.4B.
pub fn compact(n: u64) -> String {
    let f = n as f64;
    let (v, unit) = match n {
        0..1_000 => return n.to_string(),
        1_000..1_000_000 => (f / 1e3, "k"),
        1_000_000..1_000_000_000 => (f / 1e6, "M"),
        _ => (f / 1e9, "B"),
    };
    let s = if v >= 100.0 { format!("{v:.0}") } else { format!("{v:.1}") };
    format!("{}{unit}", s.strip_suffix(".0").unwrap_or(&s))
}

/// "45m", "3h 20m".
pub fn duration(ms: i64) -> String {
    let m = ms / 60_000;
    if m < 60 { format!("{m}m") } else { format!("{}h {:02}m", m / 60, m % 60) }
}

/// "claude-opus-5-5" → "Opus 5.5", "claude-sonnet-4-5-20250929" → "Sonnet 4.5", "gpt-5-codex" → "GPT-5 Codex".
pub fn model_label(id: &str) -> String {
    let id = id.rsplit('/').next().unwrap_or(id);
    let mut parts: Vec<&str> = id.split(['-', '_']).filter(|p| !p.is_empty()).collect();
    if parts.last().is_some_and(|p| p.len() == 8 && p.chars().all(|c| c.is_ascii_digit())) {
        parts.pop();
    }
    if parts.first() == Some(&"claude") && parts.len() > 1 {
        parts.remove(0);
    }
    let mut out: Vec<String> = Vec::new();
    for p in parts {
        let numeric = p.chars().all(|c| c.is_ascii_digit() || c == '.');
        match out.last_mut() {
            // Version digits join with dots: 5-5 → 5.5.
            Some(last) if numeric && last.chars().last().is_some_and(|c| c.is_ascii_digit()) && !last.starts_with("GPT") => {
                last.push('.');
                last.push_str(p);
            }
            Some(last) if numeric && last == "GPT" => {
                last.push('-');
                last.push_str(p);
            }
            _ if p.eq_ignore_ascii_case("gpt") => out.push("GPT".into()),
            _ => {
                let mut c = p.chars();
                out.push(c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default());
            }
        }
    }
    out.join(" ")
}

/// Days in a row with agent work, ending today (or yesterday while today has none yet).
pub fn streak(days: &BTreeMap<String, i64>, today: NaiveDate, working_now: bool) -> u32 {
    let busy = |d: NaiveDate| days.get(&d.format("%Y-%m-%d").to_string()).is_some_and(|ms| *ms > 0);
    let mut d = today;
    let mut n = 0;
    if busy(d) || working_now {
        n = 1;
    }
    d = d.pred_opt().unwrap_or(d);
    while busy(d) && n < 3650 {
        n += 1;
        d = match d.pred_opt() {
            Some(p) => p,
            None => break,
        };
    }
    n
}

fn clip(s: &str) -> String {
    let s = s.trim();
    let mut out: String = if s.chars().count() > MAX_LINE { s.chars().take(MAX_LINE - 1).chain(['…']).collect() } else { s.to_string() };
    // Discord also wants at least two characters.
    while out.chars().count() < 2 {
        out.push(' ');
    }
    out
}

// ───────────── the preview in Settings ─────────────

/// What the Discord thread last did, for `discord_preview`.
#[derive(Default)]
struct Status {
    connected: bool,
    shown: Option<DiscordCard>,
    sent: Option<Instant>,
}
static STATUS: Mutex<Status> = Mutex::new(Status { connected: false, shown: None, sent: None });

/// The card for these settings (the saved ones when left out). While no agent runs it is an
/// example with two made-up agents in the most recent workspace.
pub fn preview(core: &Core, presence: Option<DiscordPresence>, options: Option<DiscordOptions>) -> DiscordPreview {
    let x = gather(core);
    let (card, sample) = core.read(|s| {
        let level = presence.unwrap_or(s.settings.discord_presence);
        let Some(o) = resolve(level, options.as_ref().unwrap_or(&s.settings.discord)) else { return (None, false) };
        match card(s, &x, &o) {
            Some(c) => (Some(c), false),
            None => {
                let (st, sx) = sample(s, &x);
                (card(&st, &sx, &o), true)
            }
        }
    });
    let st = STATUS.lock().unwrap_or_else(|e| e.into_inner());
    let next_in_ms = st.sent.map(|t| MIN_GAP.saturating_sub(t.elapsed()).as_millis() as u64).filter(|ms| *ms > 0);
    DiscordPreview { card, sample, connected: st.connected, shown: st.shown.clone(), next_in_ms }
}

/// Two agents in the most recent workspace: one working for 42 minutes with two subagents, one idle.
fn sample(s: &State, x: &Extra) -> (State, Extra) {
    let now = x.now_ms;
    let ws = s.workspaces.iter().max_by_key(|w| w.order).map_or("my-project".to_string(), |w| w.name.clone());
    let mut st = State { profiles: s.profiles.clone(), catalog: s.catalog.clone(), settings: s.settings.clone(), ..Default::default() };
    let mut w: na_protocol::Workspace = serde_json::from_value(
        serde_json::json!({"id": "sample", "name": ws, "path": "/", "approved": false, "pinned": false, "order": 0, "created_at": 0}),
    )
    .expect("sample workspace");
    w.git = Some(na_protocol::GitSummary { branch: "main".into(), changed: 7, ahead: 0, behind: 0 });
    st.workspaces.push(w);
    let usage = |model: &str, t: u64| SessionUsage {
        tokens: TokenCounts { input: t / 10, output: t / 10, cache_read: t * 8 / 10, cache_write: 0 },
        cost_usd: None,
        model: Some(model.into()),
    };
    for (id, profile, status, ago, model, tokens) in [
        ("sample-a", "claude", AgentStatus::Working, 42, "claude-opus-5-5", 184_000),
        ("sample-b", "codex", AgentStatus::Idle, 18, "gpt-5-codex", 61_000),
    ] {
        let mut x: Session = serde_json::from_value(serde_json::json!({
            "id": id, "workspace_id": "sample", "profile_id": profile, "title": "", "cwd": "/",
            "status": "idle", "status_source": "output", "status_since": now - ago * 30_000, "started_at": now - ago * 60_000,
            "busy_ms": 0, "cols": 80, "rows": 24, "alive": true
        }))
        .expect("sample session");
        x.status = status;
        x.usage = Some(usage(model, tokens));
        st.sessions.insert(id.into(), x);
    }
    let mut sx = x.clone();
    sx.subagents = HashMap::from([("sample-a".to_string(), 2)]);
    if sx.tokens_today == 0 {
        sx.tokens_today = 2_400_000;
    }
    if let Some(today) = sx.today
        && streak(&sx.busy_days, today, true) < 2
    {
        for i in 0..4 {
            let d = today - chrono::Duration::days(i);
            sx.busy_days.entry(d.format("%Y-%m-%d").to_string()).or_insert(45 * 60_000);
        }
    }
    (st, sx)
}

// ───────────── talking to Discord ─────────────

/// What the main loop sends: whether presence is on at all, and the card (`None` clears it).
#[derive(Clone, Debug, PartialEq)]
struct Want {
    enabled: bool,
    card: Option<DiscordCard>,
}

pub struct Discord {
    tx: Sender<Want>,
}

impl Discord {
    pub fn start() -> Self {
        let (tx, rx) = channel();
        std::thread::Builder::new().name("discord".into()).spawn(move || run(rx)).expect("spawn discord thread");
        Self { tx }
    }

    /// Called about once a second from the main loop.
    pub fn update(&self, core: &Core) {
        let level = core.read(|s| s.settings.discord_presence);
        let want = if level == DiscordPresence::Off {
            Want { enabled: false, card: None }
        } else {
            let x = gather(core);
            Want { enabled: true, card: core.read(|s| presence(s, &x)) }
        };
        let _ = self.tx.send(want);
    }
}

/// A new card may go out: clearing always, anything else 15 s after the last update.
fn may_send(card: &Option<DiscordCard>, sent: Option<Instant>, now: Instant) -> bool {
    card.is_none() || sent.is_none_or(|t| now.duration_since(t) >= MIN_GAP)
}

fn set_status(f: impl FnOnce(&mut Status)) {
    f(&mut STATUS.lock().unwrap_or_else(|e| e.into_inner()));
}

/// One Discord command (connect, send, close) may take this long. Discord's IPC socket has no
/// timeout of its own: a hung Discord would otherwise stall this thread forever.
const IO_TIMEOUT: Duration = Duration::from_secs(5);
/// While connected, the card is sent again this often even when it did not change. Discord answers
/// every command, so this notices a Discord that quit (the socket only errors when used).
const HEARTBEAT: Duration = Duration::from_secs(60);

/// What the Discord thread needs from an IPC client: the real one, or a fake in tests.
trait Ipc: Send + 'static {
    /// Open the socket, shake hands and wait for Discord's READY.
    fn open(&mut self) -> Result<(), String>;
    /// Show this card (`None` clears it) and read Discord's answer.
    fn show(&mut self, card: Option<&DiscordCard>) -> Result<serde_json::Value, String>;
    /// Clear the card and let go of Discord.
    fn close(&mut self);
}

impl Ipc for DiscordIpcClient {
    fn open(&mut self) -> Result<(), String> {
        // Also reads the handshake's answer (READY), so a Discord that hangs is caught here.
        self.connect().map_err(|e| e.to_string())
    }

    fn show(&mut self, card: Option<&DiscordCard>) -> Result<serde_json::Value, String> {
        match card {
            Some(p) => self.set_activity(activity(p)),
            None => self.clear_activity(),
        }
        .and_then(|()| self.recv())
        .map(|(_, reply)| reply)
        .map_err(|e| e.to_string())
    }

    fn close(&mut self) {
        let _ = self.clear_activity();
        let _ = DiscordIpc::close(self);
    }
}

/// Why a link ended.
enum Gone {
    /// Discord answered with an error, or the socket broke.
    Failed(String),
    /// No answer within `IO_TIMEOUT`. Its worker is left behind and ends once the socket does.
    Stuck(std::thread::JoinHandle<()>),
}

/// A connection to Discord. The blocking IPC calls run on their own worker thread; this side waits
/// for each answer at most `timeout`.
struct Link {
    tx: Sender<Option<DiscordCard>>,
    rx: Receiver<Result<serde_json::Value, String>>,
    worker: Option<std::thread::JoinHandle<()>>,
    timeout: Duration,
}

impl Link {
    fn open<I: Ipc>(mut ipc: I, timeout: Duration) -> Result<Self, Gone> {
        let (tx, cmds) = channel::<Option<DiscordCard>>();
        let (answers, rx) = channel();
        let worker = std::thread::Builder::new()
            .name("discord-ipc".into())
            .spawn(move || {
                let opened = ipc.open();
                let ok = opened.is_ok();
                if answers.send(opened.map(|()| serde_json::Value::Null)).is_ok() && ok {
                    while let Ok(card) = cmds.recv() {
                        if answers.send(ipc.show(card.as_ref())).is_err() {
                            break;
                        }
                    }
                }
                if ok {
                    ipc.close();
                }
            })
            .map_err(|e| Gone::Failed(e.to_string()))?;
        let mut link = Self { tx, rx, worker: Some(worker), timeout };
        link.answer()?;
        Ok(link)
    }

    fn show(&mut self, card: Option<DiscordCard>) -> Result<serde_json::Value, Gone> {
        if self.tx.send(card).is_err() {
            return Err(Gone::Failed("the Discord worker ended".into()));
        }
        self.answer()
    }

    fn answer(&mut self) -> Result<serde_json::Value, Gone> {
        match self.rx.recv_timeout(self.timeout) {
            Ok(Ok(v)) => Ok(v),
            Ok(Err(e)) => Err(Gone::Failed(e)),
            Err(RecvTimeoutError::Disconnected) => Err(Gone::Failed("the Discord worker ended".into())),
            Err(RecvTimeoutError::Timeout) => match self.worker.take() {
                Some(w) => Err(Gone::Stuck(w)),
                None => Err(Gone::Failed("no answer".into())),
            },
        }
    }

    /// Let go: the worker clears the card and closes the socket on its own. Returns the worker so a
    /// new link waits until it is done.
    fn close(mut self) -> Option<std::thread::JoinHandle<()>> {
        self.worker.take()
    }
}

/// Whether a quiet, connected link should be checked by sending the card again.
fn heartbeat_due(last_io: Instant, now: Instant) -> bool {
    now.duration_since(last_io) >= HEARTBEAT
}

fn run(rx: Receiver<Want>) {
    run_with(rx, || DiscordIpcClient::new(APP_ID), IO_TIMEOUT);
}

fn run_with<I: Ipc>(rx: Receiver<Want>, new_ipc: impl Fn() -> I, timeout: Duration) {
    let mut link: Option<Link> = None;
    // The worker of the last link: no new link while it still hangs (at most one stuck thread).
    let mut previous: Option<std::thread::JoinHandle<()>> = None;
    let mut want = Want { enabled: false, card: None };
    let mut shown: Option<DiscordCard> = None;
    let mut sent: Option<Instant> = None;
    let mut last_io = Instant::now();
    let mut last_try: Option<Instant> = None;
    loop {
        // Wake up when a held-back update may go out (and at least every 5 s for the heartbeat).
        let wait = match sent {
            Some(t) if want.card != shown => MIN_GAP.saturating_sub(t.elapsed()).clamp(Duration::from_millis(200), Duration::from_secs(5)),
            _ => Duration::from_secs(5),
        };
        match rx.recv_timeout(wait) {
            Ok(w) => want = w,
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        // Only the newest wish counts.
        let mut gone = false;
        loop {
            match rx.try_recv() {
                Ok(w) => want = w,
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    gone = true;
                    break;
                }
            }
        }
        if gone {
            break;
        }
        if !want.enabled {
            // Off: clear and let go of Discord.
            if let Some(l) = link.take() {
                previous = l.close();
            }
            shown = None;
            set_status(|s| *s = Status::default());
            continue;
        }
        if link.is_none() {
            if last_try.is_some_and(|t| t.elapsed() < RETRY) || previous.as_ref().is_some_and(|w| !w.is_finished()) {
                continue;
            }
            last_try = Some(Instant::now());
            match Link::open(new_ipc(), timeout) {
                Ok(l) => {
                    tracing::info!("connected to Discord");
                    link = Some(l);
                    last_io = Instant::now();
                    shown = None;
                    set_status(|s| {
                        s.connected = true;
                        s.shown = None;
                    });
                }
                Err(Gone::Stuck(w)) => {
                    tracing::info!("Discord does not answer; trying again later");
                    previous = Some(w);
                    continue;
                }
                Err(Gone::Failed(_)) => continue, // Discord is not running.
            }
        }
        let now = Instant::now();
        let changed = want.card != shown;
        if changed && !may_send(&want.card, sent, now) {
            continue;
        }
        if !changed && !heartbeat_due(last_io, now) {
            continue;
        }
        let Some(l) = link.as_mut() else { continue };
        match l.show(want.card.clone()) {
            Ok(reply) => {
                if reply["evt"] == "ERROR" {
                    tracing::warn!("Discord rejected the card: {}", reply["data"]["message"]);
                }
                last_io = Instant::now();
                if changed {
                    shown = want.card.clone();
                    sent = Some(last_io);
                    set_status(|s| {
                        s.shown = shown.clone();
                        s.sent = sent;
                    });
                }
            }
            Err(e) => {
                match e {
                    Gone::Failed(e) => tracing::info!("Discord went away: {e}"),
                    Gone::Stuck(w) => {
                        tracing::info!("Discord stopped answering");
                        previous = Some(w);
                    }
                }
                if let Some(l) = link.take()
                    && let Some(w) = l.close()
                {
                    previous = Some(w);
                }
                shown = None;
                last_try = Some(Instant::now());
                set_status(|s| *s = Status { sent, ..Status::default() });
            }
        }
    }
    if let Some(l) = link {
        l.close();
    }
}

fn activity(p: &DiscordCard) -> Activity<'_> {
    let (large, small) = (format!("{IMAGES}/logo-512.png"), format!("{IMAGES}/small-{}.png", p.badge));
    let mut a = Activity::new()
        .details(p.details.as_str())
        .assets(Assets::new().large_image(large).large_text(p.large_text.as_str()).small_image(small).small_text(p.small_text.as_str()));
    if let Some(start) = p.start {
        a = a.timestamps(Timestamps::new().start(start));
    }
    if let Some(s) = &p.state {
        a = a.state(s.as_str());
    }
    if let Some([n, of]) = p.party {
        a = a.party(Party::new().size([n as i32, of as i32]));
    }
    if !p.buttons.is_empty() {
        a = a.buttons(vec![Button::new(BUTTON.0, BUTTON.1)]);
    }
    a
}

#[cfg(test)]
mod tests {
    use na_protocol::{Settings, Workspace};

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
        let p = DiscordCard {
            details: "In website".into(),
            state: Some("2 agents · 1 working".into()),
            large_text: "Opus 5.5".into(),
            badge: "working".into(),
            small_text: "1 working".into(),
            start: Some(now()),
            party: Some([1, 2]),
            buttons: vec![BUTTON.0.into()],
        };
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

    fn day(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    /// Two agents in "website" (claude working with a model and tokens, codex idle) plus a shell.
    fn busy_state() -> (State, Extra) {
        let mut st = State { settings: Settings::default(), ..Default::default() };
        let mut w = serde_json::from_value::<Workspace>(
            serde_json::json!({"id": "w", "name": "website", "path": "/w", "approved": false, "pinned": false, "order": 0, "created_at": 0}),
        )
        .unwrap();
        w.git = Some(na_protocol::GitSummary { branch: "main".into(), changed: 3, ahead: 0, behind: 0 });
        st.workspaces.push(w);
        st.sessions.insert("s".into(), session("s", "shell", AgentStatus::Working, 5000));
        let mut a = session("a", "claude", AgentStatus::Working, 9000);
        a.usage = Some(SessionUsage {
            tokens: TokenCounts { input: 1000, output: 2000, cache_read: 150_000, cache_write: 0 },
            cost_usd: Some(1.0),
            model: Some("claude-opus-5-5".into()),
        });
        a.status_since = 20_000;
        st.sessions.insert("a".into(), a);
        st.sessions.insert("b".into(), session("b", "codex", AgentStatus::Idle, 7000));
        for (id, name) in [("claude", "Claude Code"), ("codex", "Codex")] {
            st.catalog.push(
                serde_json::from_value(serde_json::json!({"id": id, "name": name, "vendor": "", "command": id, "installed": true, "docs_url": "", "hooks": true}))
                    .unwrap(),
            );
        }
        let x = Extra {
            subagents: HashMap::from([("a".to_string(), 3)]),
            tokens_today: 2_450_000,
            cost_today: Some(12.4),
            busy_days: BTreeMap::from([("2026-10-30".to_string(), 3_600_000), ("2026-10-31".to_string(), 5_400_000)]),
            today: Some(day("2026-10-31")),
            now_ms: 20_000 + 600_000,
        };
        (st, x)
    }

    #[test]
    fn presets_general_detailed_stats() {
        let (mut st, x) = busy_state();
        let mut idle = st.clone();
        idle.sessions.retain(|k, _| k == "s");
        assert_eq!(presence(&idle, &x), None, "a plain shell is not an agent");

        let general = presence(&st, &x).unwrap();
        assert_eq!((general.details.as_str(), general.state.as_deref(), general.start), ("Working with AI agents", None, Some(7)));
        assert_eq!(general.large_text, "NeuralAgent");
        assert_eq!(general.buttons, vec!["Get NeuralAgent".to_string()]);

        st.settings.discord_presence = DiscordPresence::Detailed;
        let detailed = presence(&st, &x).unwrap();
        assert_eq!(detailed.details, "In website");
        assert_eq!(detailed.state.as_deref(), Some("2 agents · 1 working"));
        assert_eq!(detailed.large_text, "Opus 5.5");

        st.settings.discord_presence = DiscordPresence::Stats;
        let stats = presence(&st, &x).unwrap();
        assert_eq!(stats.details, "2 agents · 1 working");
        assert_eq!(stats.state.as_deref(), Some("2.5M tokens today"));
        assert_eq!(stats.large_text, "2-day streak");
        assert!(!format!("{stats:?}").contains("website"), "Stats never names the project");

        st.settings.discord_presence = DiscordPresence::Off;
        assert_eq!(presence(&st, &x), None);
    }

    #[test]
    fn custom_lines_cover_every_stat() {
        let (mut st, x) = busy_state();
        st.settings.discord_presence = DiscordPresence::Custom;
        let line = |st: &State, stat: DiscordStat| {
            let o = DiscordOptions { details: DiscordStat::Activity, state: stat, ..DiscordOptions::default() };
            card(st, &x, &o).unwrap().state
        };
        assert_eq!(line(&st, DiscordStat::None), None);
        assert_eq!(line(&st, DiscordStat::Agents).as_deref(), Some("2 agents · 1 working"));
        assert_eq!(line(&st, DiscordStat::Subagents).as_deref(), Some("3 subagents running"));
        assert_eq!(line(&st, DiscordStat::Project).as_deref(), Some("In a project"), "names are private by default");
        assert_eq!(line(&st, DiscordStat::Model).as_deref(), Some("Opus 5.5"));
        assert_eq!(line(&st, DiscordStat::Engine).as_deref(), Some("Claude Code + Codex"));
        assert_eq!(line(&st, DiscordStat::TokensSession).as_deref(), Some("153k tokens this session"));
        assert_eq!(line(&st, DiscordStat::TokensToday).as_deref(), Some("2.5M tokens today"));
        assert_eq!(line(&st, DiscordStat::CostToday).as_deref(), Some("$12.40 at API prices today"));
        // 1.5 h finished today + 10 min of the agent working right now.
        assert_eq!(line(&st, DiscordStat::AgentTime).as_deref(), Some("1h 40m of agent work today"));
        assert_eq!(line(&st, DiscordStat::Streak).as_deref(), Some("2-day streak"));
        assert_eq!(line(&st, DiscordStat::Files).as_deref(), Some("3 files changed"));
        // A line equal to the first one is dropped.
        assert_eq!(line(&st, DiscordStat::Activity), None);

        st.settings.discord.project_names = true;
        let named =
            DiscordOptions { details: DiscordStat::Project, state: DiscordStat::Files, project_names: true, ..DiscordOptions::default() };
        let c = card(&st, &x, &named).unwrap();
        assert_eq!((c.details.as_str(), c.state.as_deref()), ("In website", Some("3 files changed in website")));
    }

    #[test]
    fn empty_stats_fall_back_and_parts_switch_off() {
        let (st, mut x) = busy_state();
        x.subagents.clear();
        x.tokens_today = 0;
        // No subagents: the first line falls back to the activity, the second is left out.
        let o = DiscordOptions {
            details: DiscordStat::Subagents,
            state: DiscordStat::TokensToday,
            hover: DiscordStat::None,
            party: false,
            timer: false,
            button: false,
            project_names: false,
        };
        let c = card(&st, &x, &o).unwrap();
        assert_eq!((c.details.as_str(), c.state.as_deref()), ("Working with AI agents", None));
        assert_eq!((c.start, c.party, c.buttons.len(), c.large_text.as_str()), (None, None, 0, "NeuralAgent"));
        // Party size needs a second line: Discord would hide it otherwise.
        let c = card(&st, &x, &DiscordOptions { party: true, ..o }).unwrap();
        assert_eq!((c.party, c.state.as_deref()), (Some([1, 2]), Some("Agent working")));
        assert_eq!((c.badge.as_str(), c.small_text.as_str()), ("working", "1 working"));
    }

    #[test]
    fn waiting_badge_wins() {
        let (mut st, x) = busy_state();
        st.sessions.get_mut("b").unwrap().status = AgentStatus::Waiting;
        let c = presence(&st, &x).unwrap();
        assert_eq!((c.badge.as_str(), c.small_text.as_str()), ("waiting", "An agent needs input"));
    }

    #[test]
    fn sample_card_when_nothing_runs() {
        let (mut st, x) = busy_state();
        st.sessions.clear();
        let o = resolve(DiscordPresence::Detailed, &DiscordOptions::default()).unwrap();
        assert_eq!(card(&st, &x, &o), None);
        let (ss, sx) = sample(&st, &x);
        let c = card(&ss, &sx, &o).unwrap();
        assert_eq!(c.details, "In website");
        assert_eq!(c.state.as_deref(), Some("2 agents · 1 working"));
    }

    #[test]
    fn formatting() {
        assert_eq!(
            [0, 950, 1000, 12_400, 153_000, 999_999, 1_200_000, 3_400_000_000].map(compact),
            ["0", "950", "1k", "12.4k", "153k", "1000k", "1.2M", "3.4B"]
        );
        assert_eq!([0, 59_999, 60_000, 45 * 60_000, 200 * 60_000].map(duration), ["0m", "0m", "1m", "45m", "3h 20m"]);
        assert_eq!(model_label("claude-opus-5-5"), "Opus 5.5");
        assert_eq!(model_label("claude-sonnet-4-5-20250929"), "Sonnet 4.5");
        assert_eq!(model_label("claude/claude-haiku-5-5"), "Haiku 5.5");
        assert_eq!(model_label("gpt-5-codex"), "GPT-5 Codex");
        assert_eq!(model_label("gemini-2.5-pro"), "Gemini 2.5 Pro");
        assert_eq!(clip(&"x".repeat(200)).chars().count(), 128);
        assert_eq!(clip("a"), "a ");
    }

    #[test]
    fn streak_counts_days_in_a_row() {
        let days = |list: &[&str]| list.iter().map(|d| (d.to_string(), 1)).collect::<BTreeMap<_, _>>();
        let today = day("2026-10-31");
        assert_eq!(streak(&days(&[]), today, false), 0);
        assert_eq!(streak(&days(&[]), today, true), 1, "working right now counts for today");
        assert_eq!(streak(&days(&["2026-10-29", "2026-10-30", "2026-10-31"]), today, false), 3);
        assert_eq!(streak(&days(&["2026-10-29", "2026-10-30"]), today, false), 2, "today is not over yet");
        assert_eq!(streak(&days(&["2026-10-28", "2026-10-30", "2026-10-31"]), today, false), 2);
        assert_eq!(streak(&days(&["2026-09-30", "2026-10-01"]), day("2026-10-01"), false), 2, "across months");
    }

    #[test]
    fn rate_limit() {
        let t = Instant::now();
        let some = Some(presence_for_test());
        assert!(may_send(&some, None, t), "the first update goes out at once");
        assert!(!may_send(&some, Some(t), t + Duration::from_secs(14)));
        assert!(may_send(&some, Some(t), t + Duration::from_secs(15)));
        assert!(may_send(&None, Some(t), t + Duration::from_secs(1)), "clearing is never held back");
    }

    fn presence_for_test() -> DiscordCard {
        let (st, x) = busy_state();
        presence(&st, &x).unwrap()
    }

    /// A fake Discord: `hang` makes `show` block forever, `quit` makes it fail like a closed socket.
    #[derive(Clone, Default)]
    struct Fake {
        log: std::sync::Arc<Mutex<Vec<&'static str>>>,
        hang: bool,
        quit: bool,
    }

    impl Ipc for Fake {
        fn open(&mut self) -> Result<(), String> {
            self.log.lock().unwrap().push("open");
            Ok(())
        }
        fn show(&mut self, _: Option<&DiscordCard>) -> Result<serde_json::Value, String> {
            self.log.lock().unwrap().push("show");
            if self.hang {
                loop {
                    std::thread::park();
                }
            }
            if self.quit { Err("broken pipe".into()) } else { Ok(serde_json::json!({ "evt": null })) }
        }
        fn close(&mut self) {
            self.log.lock().unwrap().push("close");
        }
    }

    fn eventually(what: &str, f: impl Fn() -> bool) {
        let start = Instant::now();
        while !f() {
            assert!(start.elapsed() < Duration::from_secs(8), "timed out waiting for: {what}");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn heartbeat_checks_a_quiet_link() {
        let t = Instant::now();
        assert!(!heartbeat_due(t, t + Duration::from_secs(59)));
        assert!(heartbeat_due(t, t + HEARTBEAT));
    }

    #[test]
    fn link_has_a_deadline() {
        let short = Duration::from_millis(100);
        let mut l = Link::open(Fake { hang: true, ..Fake::default() }, short).ok().expect("opens");
        let start = Instant::now();
        assert!(matches!(l.show(Some(presence_for_test())), Err(Gone::Stuck(_))), "a hung Discord times out");
        assert!(start.elapsed() < Duration::from_secs(2));

        let f = Fake { quit: true, ..Fake::default() };
        let log = f.log.clone();
        let mut l = Link::open(f, short).ok().expect("opens");
        assert!(matches!(l.show(None), Err(Gone::Failed(_))), "a closed Discord is an error");
        let w = l.close().expect("worker");
        eventually("worker ends", || w.is_finished());
        assert_eq!(*log.lock().unwrap(), ["open", "show", "close"]);
    }

    /// The Discord thread survives a Discord that stops answering: it marks itself disconnected,
    /// keeps taking updates, and ends when asked (no thread blocked forever on the socket).
    #[test]
    fn run_survives_a_hung_discord() {
        let (tx, rx) = channel();
        let f = Fake { hang: true, ..Fake::default() };
        let log = f.log.clone();
        let h = std::thread::spawn(move || run_with(rx, move || f.clone(), Duration::from_millis(100)));
        tx.send(Want { enabled: true, card: Some(presence_for_test()) }).unwrap();
        eventually("card sent", || log.lock().unwrap().contains(&"show"));
        eventually("marked disconnected", || !STATUS.lock().unwrap().connected);
        for _ in 0..3 {
            tx.send(Want { enabled: true, card: None }).unwrap();
        }
        drop(tx);
        eventually("thread ends", || h.is_finished());
        assert_eq!(log.lock().unwrap().iter().filter(|x| **x == "open").count(), 1, "no second link while the first hangs");
    }
}
