//! Windows: the own volume of every other app's audio session on the default output (WASAPI
//! `ISimpleAudioVolume`, what the Volume Mixer shows). This app and its WebView2 processes are
//! left alone, so Neural's voice in a call stays loud.

use std::collections::{HashMap, HashSet};

use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Media::Audio::{
    AudioSessionStateActive, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
    eMultimedia, eRender,
};
use windows::Win32::System::Com::{CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::core::Interface;

use super::{Backend, Target};

/// One session: its id, owning process, volume control and whether it plays.
struct Session {
    id: String,
    pid: u32,
    volume: ISimpleAudioVolume,
    playing: bool,
}

/// Every audio session on the default output device.
fn sessions() -> windows::core::Result<Vec<Session>> {
    // SAFETY: plain COM calls on this (the duck worker's) thread; every pointer is checked by the
    // windows crate and released when the wrappers drop.
    unsafe {
        let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = devices.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
        let list = manager.GetSessionEnumerator()?;
        let mut out = Vec::new();
        for i in 0..list.GetCount()? {
            let Ok(control) = list.GetSession(i) else { continue };
            let Ok(control2) = control.cast::<IAudioSessionControl2>() else { continue };
            // S_OK means "this is the system sounds session": leave notification sounds alone.
            if control2.IsSystemSoundsSession().0 == 0 {
                continue;
            }
            let Ok(volume) = control.cast::<ISimpleAudioVolume>() else { continue };
            let pid = control2.GetProcessId().unwrap_or(0);
            let Ok(raw) = control2.GetSessionInstanceIdentifier() else { continue };
            let id = raw.to_string().unwrap_or_default();
            CoTaskMemFree(Some(raw.0 as *const _));
            let playing = control.GetState().is_ok_and(|s| s == AudioSessionStateActive) && !volume.GetMute().is_ok_and(|m| m.as_bool());
            out.push(Session { id, pid, volume, playing });
        }
        Ok(out)
    }
}

/// This process and every process it started (WebView2 runs as child processes).
fn ours() -> HashSet<u32> {
    let me = std::process::id();
    let mut parents: HashMap<u32, u32> = HashMap::new();
    // SAFETY: a process snapshot read with a correctly sized entry, closed at the end.
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return HashSet::from([me]) };
        let mut e = PROCESSENTRY32W { dwSize: size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        if Process32FirstW(snap, &mut e).is_ok() {
            loop {
                parents.insert(e.th32ProcessID, e.th32ParentProcessID);
                if Process32NextW(snap, &mut e).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    parents
        .keys()
        .copied()
        .filter(|&p| {
            let mut q = p;
            for _ in 0..32 {
                if q == me {
                    return true;
                }
                match parents.get(&q) {
                    Some(&pp) if pp != 0 && pp != q => q = pp,
                    _ => return false,
                }
            }
            false
        })
        .chain([me])
        .collect()
}

#[derive(Default)]
pub struct Sessions {
    com: bool,
}

impl Sessions {
    fn init(&mut self) {
        if !self.com {
            // SAFETY: initialises COM for the duck worker thread (the only caller).
            let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            self.com = true;
        }
    }

    fn find(&mut self, id: &str) -> Option<Session> {
        self.init();
        sessions().ok()?.into_iter().find(|s| s.id == id)
    }

    fn others(&mut self) -> Vec<Session> {
        self.init();
        let mine = ours();
        sessions().unwrap_or_default().into_iter().filter(|s| s.pid != 0 && !mine.contains(&s.pid)).collect()
    }
}

impl Backend for Sessions {
    fn scan(&mut self) -> Vec<Target> {
        self.others()
            .into_iter()
            .filter_map(|s| {
                // SAFETY: a live COM interface from `sessions`.
                let volume = unsafe { s.volume.GetMasterVolume() }.ok()?;
                Some(Target { id: s.id, volume, playing: s.playing })
            })
            .collect()
    }

    fn get(&mut self, id: &str) -> Option<f32> {
        let s = self.find(id)?;
        // SAFETY: a live COM interface.
        unsafe { s.volume.GetMasterVolume() }.ok()
    }

    fn set(&mut self, id: &str, v: f32) -> Option<f32> {
        let s = self.find(id)?;
        // SAFETY: a live COM interface; a null event context is allowed.
        unsafe {
            s.volume.SetMasterVolume(v.clamp(0.0, 1.0), std::ptr::null()).ok()?;
            s.volume.GetMasterVolume().ok()
        }
    }
}
