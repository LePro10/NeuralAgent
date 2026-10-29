//! Keeps the computer from sleeping while agents work (setting `keep_awake`). The display may
//! still turn off; only idle sleep is blocked.

use std::sync::mpsc::{Receiver, Sender, channel};
use std::time::{Duration, Instant};

use na_protocol::KeepAwake;

/// Handle to the thread that owns the OS assertion (Windows ties it to the calling thread).
pub struct Awake {
    tx: Sender<(KeepAwake, bool)>,
}

impl Awake {
    pub fn start() -> Self {
        let (tx, rx) = channel();
        std::thread::Builder::new().name("keep-awake".into()).spawn(move || run(rx)).expect("spawn keep-awake thread");
        Self { tx }
    }

    /// Call regularly with the setting and whether any agent is working.
    pub fn update(&self, setting: KeepAwake, working: bool) {
        let _ = self.tx.send((setting, working));
    }
}

fn run(rx: Receiver<(KeepAwake, bool)>) {
    let mut guard: Option<keepawake::KeepAwake> = None;
    // Asking the OS about the power source is not free; once a minute is plenty.
    let mut power: Option<(Instant, bool)> = None;
    while let Ok((setting, working)) = rx.recv() {
        let want = match setting {
            KeepAwake::Off => false,
            KeepAwake::WhileWorking => working,
            KeepAwake::WhileWorkingOnPower => {
                working && {
                    let fresh = power.filter(|(at, _)| at.elapsed() < Duration::from_secs(60));
                    let on = fresh.map_or_else(on_power, |(_, on)| on);
                    if fresh.is_none() {
                        power = Some((Instant::now(), on));
                    }
                    on
                }
            }
        };
        if want == guard.is_some() {
            continue;
        }
        guard = if want {
            match keepawake::Builder::default()
                .idle(true)
                .reason("Agents are working")
                .app_name("NeuralAgent")
                .app_reverse_domain("dev.neuralhub.neuralagent")
                .create()
            {
                Ok(g) => {
                    tracing::info!("keeping the computer awake while agents work");
                    Some(g)
                }
                Err(e) => {
                    tracing::warn!("keep awake: {e}");
                    None
                }
            }
        } else {
            tracing::info!("agents idle, the computer may sleep again");
            None
        };
    }
}

/// Whether the computer runs on mains power (true when it cannot tell, e.g. a desktop).
fn on_power() -> bool {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("pmset")
            .args(["-g", "ps"])
            .output()
            .map(|o| !String::from_utf8_lossy(&o.stdout).contains("'Battery Power'"))
            .unwrap_or(true)
    }
    #[cfg(target_os = "linux")]
    {
        let read = |p: std::path::PathBuf| std::fs::read_to_string(p).unwrap_or_default().trim().to_string();
        let supplies: Vec<_> = std::fs::read_dir("/sys/class/power_supply").into_iter().flatten().flatten().map(|e| e.path()).collect();
        let mains: Vec<_> = supplies.iter().filter(|p| read(p.join("type")) == "Mains").collect();
        mains.is_empty() || mains.iter().any(|p| read(p.join("online")) == "1")
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
        let mut s: SYSTEM_POWER_STATUS = unsafe { std::mem::zeroed() };
        // ACLineStatus: 0 offline, 1 online, 255 unknown.
        unsafe { GetSystemPowerStatus(&mut s) == 0 || s.ACLineStatus != 0 }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    true
}

#[cfg(test)]
mod tests {
    #[test]
    fn power_source_is_readable() {
        // Only checks that asking does not panic; the answer depends on the machine.
        let _ = super::on_power();
    }
}
