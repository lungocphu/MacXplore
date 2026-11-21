use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

pub const BUNDLE_ID: &str = "com.mxplore.explorer";
const SERVICE_WORKFLOW_NAME: &str = "Show in MXplore.workflow";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacOsIntegrationStatus {
    pub is_default_file_viewer: bool,
    pub quick_action_installed: bool,
    pub quick_action_path: String,
    pub bundle_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RevealTarget {
    pub directory: String,
    pub select_path: Option<String>,
    pub name: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadCompletedEvent {
    pub name: String,
    pub path: String,
    pub directory: String,
    pub size: u64,
    pub is_dir: bool,
    pub completed_at: i64,
}

fn expand_tilde(raw: &str) -> PathBuf {
    let trimmed = raw.trim();
    if trimmed == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

fn clean_path_string(path: &Path) -> String {
    let s = path.to_string_lossy().to_string();
    if s.len() > 1 && s.ends_with('/') {
        s.trim_end_matches('/').to_string()
    } else {
        s
    }
}

/// Checks if a filename represents a hidden file or an in-progress browser download.
pub fn is_incomplete_download_name(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.starts_with('.') {
        return true;
    }

    let lower = trimmed.to_ascii_lowercase();
    const PARTIAL_SUFFIXES: &[&str] = &[
        ".crdownload",
        ".download",
        ".part",
        ".partial",
        ".tmp",
        ".temp",
        ".opdownload",
        ".filepart",
        ".!qb",
        ".aria2",
        ".bc!",
        ".unconfirmed",
    ];

    if PARTIAL_SUFFIXES.iter().any(|suffix| lower.ends_with(suffix)) {
        return true;
    }

    // Chrome sometimes uses "Unconfirmed 12345.crdownload" or similar transient names
    if lower.starts_with("unconfirmed ") && lower.contains("crdownload") {
        return true;
    }

    false
}

/// Parses an incoming macOS `RunEvent::Opened` URL (`file://` or `mxplore://reveal?path=...`)
/// into `(filesystem_path, prefer_select_dir)`.
pub fn parse_incoming_url(url: &tauri::Url) -> Option<(String, bool)> {
    match url.scheme() {
        "file" => {
            let path = url.to_file_path().ok()?;
            Some((clean_path_string(&path), false))
        }
        "mxplore" => {
            let mut path_param: Option<String> = None;
            for (k, v) in url.query_pairs() {
                if k == "path" && !v.trim().is_empty() {
                    path_param = Some(v.into_owned());
                    break;
                }
            }
            let raw_path = path_param?;
            let host = url.host_str().unwrap_or("reveal");
            let prefer_select_dir = !host.eq_ignore_ascii_case("open");
            Some((raw_path, prefer_select_dir))
        }
        _ => None,
    }
}

/// Resolves any file or folder path into the target directory to open and the optional item path to select.
pub fn resolve_reveal_target(
    raw_path: &str,
    prefer_select_dir: bool,
) -> Result<RevealTarget, String> {
    let target = expand_tilde(raw_path);
    let meta = fs::symlink_metadata(&target)
        .map_err(|_| format!("Item does not exist: {}", target.display()))?;

    let is_dir = if meta.file_type().is_symlink() {
        fs::metadata(&target).map(|m| m.is_dir()).unwrap_or(false)
    } else {
        meta.is_dir()
    };

    let target_str = clean_path_string(&target);
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| target_str.clone());

    let lower_name = name.to_ascii_lowercase();
    let is_package_bundle =
        is_dir && (lower_name.ends_with(".app") || lower_name.ends_with(".pkg"));

    if !is_dir || is_package_bundle {
        let parent = target
            .parent()
            .map(clean_path_string)
            .filter(|p| !p.is_empty())
            .unwrap_or_else(|| "/".to_string());

        return Ok(RevealTarget {
            directory: parent,
            select_path: Some(target_str),
            name,
            is_dir,
        });
    }

    if prefer_select_dir {
        if let Some(parent) = target.parent() {
            let parent_str = clean_path_string(parent);
            if !parent_str.is_empty() && parent_str != target_str {
                return Ok(RevealTarget {
                    directory: parent_str,
                    select_path: Some(target_str),
                    name,
                    is_dir: true,
                });
            }
        }
    }

    Ok(RevealTarget {
        directory: target_str,
        select_path: None,
        name,
        is_dir: true,
    })
}

pub fn quick_action_workflow_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    home.join("Library")
        .join("Services")
        .join(SERVICE_WORKFLOW_NAME)
}

/// Returns true if macOS global `NSFileViewer` is currently pointing to MXplore.
pub fn is_mxplore_default_file_viewer() -> bool {
    #[cfg(target_os = "macos")]
    {
        let Ok(output) = Command::new("defaults")
            .args(["read", "-g", "NSFileViewer"])
            .output()
        else {
            return false;
        };
        if !output.status.success() {
            return false;
        }
        String::from_utf8_lossy(&output.stdout).trim() == BUNDLE_ID
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

pub fn get_status() -> MacOsIntegrationStatus {
    let workflow_path = quick_action_workflow_path();
    let plist_path = workflow_path.join("Contents").join("Info.plist");
    let quick_action_installed = plist_path.is_file();

    MacOsIntegrationStatus {
        is_default_file_viewer: is_mxplore_default_file_viewer(),
        quick_action_installed,
        quick_action_path: clean_path_string(&workflow_path),
        bundle_id: BUNDLE_ID.to_string(),
    }
}

#[tauri::command]
pub fn get_macos_integration_status() -> MacOsIntegrationStatus {
    get_status()
}

#[tauri::command]
pub fn set_default_file_viewer(enabled: bool) -> Result<MacOsIntegrationStatus, String> {
    #[cfg(target_os = "macos")]
    {
        if enabled {
            let output = Command::new("defaults")
                .args(["write", "-g", "NSFileViewer", "-string", BUNDLE_ID])
                .output()
                .map_err(|e| format!("Failed to update NSFileViewer: {}", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("defaults write failed: {}", stderr.trim()));
            }
        } else {
            let output = Command::new("defaults")
                .args(["delete", "-g", "NSFileViewer"])
                .output()
                .map_err(|e| format!("Failed to reset NSFileViewer: {}", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                // Ignore if key was already absent
                if !stderr.contains("does not exist") {
                    return Err(format!("defaults delete failed: {}", stderr.trim()));
                }
            }
        }
        Ok(get_status())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = enabled;
        Err("macOS integration is only available on macOS.".to_string())
    }
}

const QUICK_ACTION_INFO_PLIST: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSBackgroundColorName</key>
			<string>background</string>
			<key>NSIconName</key>
			<string>NSActionTemplate</string>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>Show in MXplore</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSRequiredContext</key>
			<dict/>
			<key>NSSendFileTypes</key>
			<array>
				<string>public.item</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
"#;

const QUICK_ACTION_DOCUMENT_WFLOW: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key>
	<string>523</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<true/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMParameterProperties</key>
				<dict>
					<key>COMMAND_STRING</key>
					<dict/>
					<key>CheckedForUserDefaultShell</key>
					<dict/>
					<key>inputMethod</key>
					<dict/>
					<key>shell</key>
					<dict/>
					<key>source</key>
					<dict/>
				</dict>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>if [ $# -gt 0 ]; then
  /usr/bin/open -b com.mxplore.explorer "$1" 2&gt;/dev/null || /usr/bin/open -a "MXplore" "$1"
fi</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>1</integer>
					<key>shell</key>
					<string>/bin/zsh</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>8C4C5B6E-4D13-4E0F-9D7A-10C65A1A0001</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
					<string>Command</string>
					<string>Run</string>
					<string>Unix</string>
				</array>
				<key>OutputUUID</key>
				<string>8C4C5B6E-4D13-4E0F-9D7A-10C65A1A0002</string>
				<key>UUID</key>
				<string>8C4C5B6E-4D13-4E0F-9D7A-10C65A1A0003</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
				<key>arguments</key>
				<dict>
					<key>0</key>
					<dict>
						<key>default value</key>
						<integer>0</integer>
						<key>name</key>
						<string>inputMethod</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>0</string>
					</dict>
					<key>1</key>
					<dict>
						<key>default value</key>
						<string></string>
						<key>name</key>
						<string>source</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>1</string>
					</dict>
					<key>2</key>
					<dict>
						<key>default value</key>
						<false/>
						<key>name</key>
						<string>CheckedForUserDefaultShell</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>2</string>
					</dict>
					<key>3</key>
					<dict>
						<key>default value</key>
						<string></string>
						<key>name</key>
						<string>COMMAND_STRING</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>3</string>
					</dict>
					<key>4</key>
					<dict>
						<key>default value</key>
						<string>/bin/sh</string>
						<key>name</key>
						<string>shell</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>4</string>
					</dict>
				</dict>
				<key>isViewVisible</key>
				<integer>1</integer>
				<key>location</key>
				<string>309.000000:305.000000</string>
				<key>nibPath</key>
				<string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib</string>
			</dict>
			<key>isViewVisible</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>applicationBundleIDsByPath</key>
		<dict/>
		<key>applicationPaths</key>
		<array/>
		<key>inputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject</string>
		<key>outputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>presentationMode</key>
		<integer>15</integer>
		<key>processesInput</key>
		<false/>
		<key>serviceInputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<false/>
		<key>systemImageName</key>
		<string>NSActionTemplate</string>
		<key>useAutomaticInputType</key>
		<false/>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>
"#;

fn refresh_macos_services_cache() {
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("/System/Library/CoreServices/pbs")
            .arg("-update")
            .output();
    }
}

#[tauri::command]
pub fn install_show_in_mxplore_service() -> Result<MacOsIntegrationStatus, String> {
    #[cfg(target_os = "macos")]
    {
        let workflow_dir = quick_action_workflow_path();
        let contents_dir = workflow_dir.join("Contents");
        fs::create_dir_all(&contents_dir)
            .map_err(|e| format!("Failed to create Quick Action folder: {}", e))?;

        fs::write(contents_dir.join("Info.plist"), QUICK_ACTION_INFO_PLIST)
            .map_err(|e| format!("Failed to write Quick Action Info.plist: {}", e))?;
        fs::write(
            contents_dir.join("document.wflow"),
            QUICK_ACTION_DOCUMENT_WFLOW,
        )
        .map_err(|e| format!("Failed to write Quick Action workflow: {}", e))?;

        refresh_macos_services_cache();
        Ok(get_status())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Quick Actions are only available on macOS.".to_string())
    }
}

#[tauri::command]
pub fn uninstall_show_in_mxplore_service() -> Result<MacOsIntegrationStatus, String> {
    #[cfg(target_os = "macos")]
    {
        let workflow_dir = quick_action_workflow_path();
        if workflow_dir.exists() {
            fs::remove_dir_all(&workflow_dir)
                .map_err(|e| format!("Failed to remove Quick Action: {}", e))?;
        }
        refresh_macos_services_cache();
        Ok(get_status())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Quick Actions are only available on macOS.".to_string())
    }
}

#[tauri::command]
pub fn resolve_reveal_path(
    path: String,
    prefer_select_dir: Option<bool>,
) -> Result<RevealTarget, String> {
    resolve_reveal_target(&path, prefer_select_dir.unwrap_or(true))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct EntryFingerprint {
    size: u64,
    modified_secs: u64,
    is_dir: bool,
}

fn scan_downloads_dir(dir: &Path) -> HashMap<String, (PathBuf, EntryFingerprint)> {
    let mut map = HashMap::new();
    let Ok(read_dir) = fs::read_dir(dir) else {
        return map;
    };

    for item in read_dir.flatten() {
        let name = item.file_name().to_string_lossy().to_string();
        if is_incomplete_download_name(&name) {
            continue;
        }
        let path = item.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        let is_dir = meta.is_dir();
        let size = if is_dir { 0 } else { meta.len() };
        let modified_secs = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        map.insert(
            name,
            (
                path,
                EntryFingerprint {
                    size,
                    modified_secs,
                    is_dir,
                },
            ),
        );
    }

    map
}

/// Starts a lightweight background watcher on `~/Downloads`.
/// When a newly downloaded file finishes writing and stabilizes, emits `"mxplore:download-completed"`
/// so the UI offers both "Show in MXplore" and "Show in Finder".
pub fn start_downloads_watcher(app: AppHandle) {
    let Some(downloads_dir) = dirs::download_dir() else {
        return;
    };

    std::thread::spawn(move || {
        let mut known_names: HashSet<String> = scan_downloads_dir(&downloads_dir)
            .into_keys()
            .collect();
        let mut pending: HashMap<String, EntryFingerprint> = HashMap::new();
        let dir_str = clean_path_string(&downloads_dir);

        loop {
            std::thread::sleep(Duration::from_millis(1500));

            let current = scan_downloads_dir(&downloads_dir);

            // Drop names that were removed/moved out so future re-downloads trigger cleanly
            known_names.retain(|name| current.contains_key(name));
            pending.retain(|name, _| current.contains_key(name));

            for (name, (path, fp)) in &current {
                if known_names.contains(name) {
                    continue;
                }

                match pending.get(name) {
                    Some(prev_fp) if prev_fp == fp => {
                        // File size & modified timestamp stabilized across 2 ticks -> download completed!
                        pending.remove(name);
                        known_names.insert(name.clone());

                        let completed_at = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .map(|d| d.as_millis() as i64)
                            .unwrap_or(0);

                        let payload = DownloadCompletedEvent {
                            name: name.clone(),
                            path: clean_path_string(path),
                            directory: dir_str.clone(),
                            size: fp.size,
                            is_dir: fp.is_dir,
                            completed_at,
                        };
                        let _ = app.emit("mxplore:download-completed", payload);
                    }
                    _ => {
                        // First sight or still growing -> wait for next tick to confirm completion
                        pending.insert(name.clone(), *fp);
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_incomplete_browser_downloads() {
        assert!(is_incomplete_download_name("file.zip.crdownload"));
        assert!(is_incomplete_download_name("archive.dmg.download"));
        assert!(is_incomplete_download_name("video.mp4.part"));
        assert!(is_incomplete_download_name("temp.tmp"));
        assert!(is_incomplete_download_name(".DS_Store"));
        assert!(is_incomplete_download_name("Unconfirmed 4812.crdownload"));

        assert!(!is_incomplete_download_name("report.pdf"));
        assert!(!is_incomplete_download_name("MXplore_0.1.0_aarch64.dmg"));
        assert!(!is_incomplete_download_name("slides.pptx"));
        assert!(!is_incomplete_download_name("download_guide.zip"));
    }

    #[test]
    fn parses_file_and_mxplore_urls() {
        let file_url = tauri::Url::parse("file:///Users/test/Downloads/My%20Report.pdf").unwrap();
        assert_eq!(
            parse_incoming_url(&file_url),
            Some(("/Users/test/Downloads/My Report.pdf".to_string(), false))
        );

        let reveal_url =
            tauri::Url::parse("mxplore://reveal?path=%2FUsers%2Ftest%2FDownloads%2Fa%20b.zip")
                .unwrap();
        assert_eq!(
            parse_incoming_url(&reveal_url),
            Some(("/Users/test/Downloads/a b.zip".to_string(), true))
        );

        let open_url =
            tauri::Url::parse("mxplore://open?path=%2FUsers%2Ftest%2FDownloads").unwrap();
        assert_eq!(
            parse_incoming_url(&open_url),
            Some(("/Users/test/Downloads".to_string(), false))
        );
    }

    #[test]
    fn resolves_reveal_targets_for_files_apps_and_folders() {
        let base = std::env::temp_dir().join(format!(
            "mxplore_reveal_test_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let sub_dir = base.join("FolderA");
        let app_dir = base.join("Demo.app");
        let file_path = base.join("sample.pdf");

        fs::create_dir_all(&sub_dir).unwrap();
        fs::create_dir_all(&app_dir).unwrap();
        fs::write(&file_path, b"hello").unwrap();

        // Regular file -> open parent, select file
        let file_res = resolve_reveal_target(&file_path.to_string_lossy(), false).unwrap();
        assert_eq!(file_res.directory, clean_path_string(&base));
        assert_eq!(file_res.select_path, Some(clean_path_string(&file_path)));
        assert!(!file_res.is_dir);

        // .app bundle -> open parent, select .app (never dive into bundle)
        let app_res = resolve_reveal_target(&app_dir.to_string_lossy(), false).unwrap();
        assert_eq!(app_res.directory, clean_path_string(&base));
        assert_eq!(app_res.select_path, Some(clean_path_string(&app_dir)));

        // Folder with prefer_select_dir = false -> open folder directly
        let dir_open = resolve_reveal_target(&sub_dir.to_string_lossy(), false).unwrap();
        assert_eq!(dir_open.directory, clean_path_string(&sub_dir));
        assert_eq!(dir_open.select_path, None);

        // Folder with prefer_select_dir = true -> open parent, select folder
        let dir_select = resolve_reveal_target(&sub_dir.to_string_lossy(), true).unwrap();
        assert_eq!(dir_select.directory, clean_path_string(&base));
        assert_eq!(dir_select.select_path, Some(clean_path_string(&sub_dir)));

        let _ = fs::remove_dir_all(&base);
    }
}
