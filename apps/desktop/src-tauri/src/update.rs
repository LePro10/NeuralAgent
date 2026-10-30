//! App updates from agent.neuralhub.dev (Tauri updater, signed with the release key). Installing
//! replaces the app and restarts it; the service and its agents keep running (see daemon.rs).
//! `NEURALAGENT_UPDATE_URL` points the check at another server (tests); signatures still count.
//!
//! macOS: the plugin swaps the whole `NeuralAgent.app` folder, which gives it a new file identity,
//! and the Dock (which pins apps by that identity) then shows the updated app as a second icon.
//! So the new `Contents` is swapped into the existing folder instead; the plugin's install stays
//! the fallback (e.g. when the folder needs an admin password).

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Updater, UpdaterExt};

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    pub version: String,
    pub current: String,
    pub notes: Option<String>,
}

#[derive(Serialize, Clone)]
struct Progress {
    done: u64,
    total: Option<u64>,
}

/// The relay the app updates from (also serves `/changelog.json` for the update dialog).
fn server() -> String {
    std::env::var("NEURALAGENT_UPDATE_URL")
        .ok()
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| "https://agent.neuralhub.dev".into())
        .trim_end_matches('/')
        .to_string()
}

/// Base URL of the update server; the page fetches `<server>/changelog.json` itself (CSP allows it).
#[tauri::command]
pub fn update_server() -> String {
    server()
}

fn updater(app: &AppHandle) -> Result<Updater, String> {
    let mut b = app.updater_builder();
    if let Some(url) = std::env::var("NEURALAGENT_UPDATE_URL").ok().filter(|u| !u.is_empty()) {
        let url = format!("{}/api/update/{{{{target}}}}/{{{{arch}}}}/{{{{current_version}}}}", url.trim_end_matches('/'));
        b = b.endpoints(vec![url.parse().map_err(|e| format!("{e}"))?]).map_err(|e| e.to_string())?;
    }
    b.build().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let found = updater(&app)?.check().await.map_err(|e| e.to_string())?;
    Ok(found.map(|u| UpdateInfo { version: u.version.clone(), current: u.current_version.clone(), notes: u.body.clone() }))
}

/// Downloads, verifies and installs the update, then restarts the app.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    let Some(update) = updater(&app)?.check().await.map_err(|e| e.to_string())? else {
        return Err("already up to date".into());
    };
    tracing::info!(from = %update.current_version, to = %update.version, "installing update");
    let mut done = 0u64;
    let events = app.clone();
    let bytes = update
        .download(
            move |chunk, total| {
                done += chunk as u64;
                let _ = events.emit("update-progress", Progress { done, total });
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let installed = match macos::install_in_place(&bytes) {
        Ok(()) => Ok(()),
        Err(e) => {
            tracing::warn!("in-place install failed ({e}), replacing the whole app");
            update.install(&bytes)
        }
    };
    #[cfg(not(target_os = "macos"))]
    let installed = update.install(&bytes);
    installed.map_err(|e| e.to_string())?;
    app.restart();
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::CString;
    use std::io::{Error, ErrorKind, Result};
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::MetadataExt;
    use std::path::{Path, PathBuf};

    /// The running app's bundle: `<x>.app` from `<x>.app/Contents/MacOS/<binary>`.
    fn bundle() -> Result<PathBuf> {
        let exe = std::env::current_exe()?;
        let b = exe.parent().and_then(Path::parent).and_then(Path::parent).ok_or_else(|| Error::other("no bundle"))?;
        if b.extension().is_some_and(|e| e == "app") { Ok(b.to_path_buf()) } else { Err(Error::other("not inside an .app")) }
    }

    /// Unpacks the verified `.app.tar.gz` next to the app (same volume) and swaps its `Contents`
    /// with the installed one in one step, so the `.app` folder itself keeps its identity.
    pub fn install_in_place(bytes: &[u8]) -> Result<()> {
        install_into(&bundle()?, bytes)
    }

    fn install_into(app: &Path, bytes: &[u8]) -> Result<()> {
        let parent = app.parent().ok_or_else(|| Error::other("no parent"))?;
        let dev = std::fs::metadata(app)?.dev();
        let tmp_root = [std::env::temp_dir(), parent.to_path_buf()]
            .into_iter()
            .find(|d| d.metadata().is_ok_and(|m| m.dev() == dev))
            .ok_or_else(|| Error::other("no temp dir on the app's volume"))?;
        let tmp = tmp_root.join(format!(".neuralagent-update-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir(&tmp)?;
        let result = (|| {
            tar::Archive::new(flate2::read::GzDecoder::new(bytes)).unpack(&tmp)?;
            let new_app = std::fs::read_dir(&tmp)?
                .filter_map(|e| e.ok().map(|e| e.path()))
                .find(|p| p.extension().is_some_and(|e| e == "app"))
                .ok_or_else(|| Error::new(ErrorKind::InvalidData, "no .app in the update"))?;
            let from = CString::new(new_app.join("Contents").as_os_str().as_bytes())?;
            let to = CString::new(app.join("Contents").as_os_str().as_bytes())?;
            // SAFETY: both are valid NUL-terminated paths that outlive the call.
            if unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_SWAP) } != 0 {
                return Err(Error::last_os_error());
            }
            // A fresh modification date makes Launch Services read the new Info.plist.
            let _ = std::fs::File::open(app).and_then(|f| f.set_modified(std::time::SystemTime::now()));
            Ok(())
        })();
        // Holds the previous `Contents` after a successful swap, the unpacked update otherwise.
        let _ = std::fs::remove_dir_all(&tmp);
        result
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn swaps_contents_and_keeps_the_app_folder() {
            let root = std::env::temp_dir().join(format!("na-update-test-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            let app = root.join("NeuralAgent.app");
            std::fs::create_dir_all(app.join("Contents")).unwrap();
            std::fs::write(app.join("Contents/v"), "old").unwrap();
            let ino = std::fs::metadata(&app).unwrap().ino();

            let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
            {
                let mut tar = tar::Builder::new(&mut gz);
                let mut h = tar::Header::new_gnu();
                h.set_size(3);
                h.set_mode(0o644);
                h.set_cksum();
                tar.append_data(&mut h, "NeuralAgent.app/Contents/v", &b"new"[..]).unwrap();
                tar.finish().unwrap();
            }
            install_into(&app, &gz.finish().unwrap()).unwrap();

            assert_eq!(std::fs::read_to_string(app.join("Contents/v")).unwrap(), "new");
            assert_eq!(std::fs::metadata(&app).unwrap().ino(), ino);
            assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1, "temp dir left behind");
            std::fs::remove_dir_all(&root).unwrap();
        }
    }
}
