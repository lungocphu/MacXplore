use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, Metadata, OpenOptions};
use std::io;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use zip::ZipArchive;

#[cfg(target_os = "macos")]
use std::os::macos::fs::MetadataExt;

#[cfg(unix)]
use std::os::unix::fs::symlink;

#[cfg(target_os = "macos")]
const UF_HIDDEN: u32 = 0x8000;

static QUICKLOOK_PROCESS: Mutex<Option<(String, Child)>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_timestamp: i64,
    pub extension: String,
    pub is_hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CloudDrive {
    pub name: String,
    pub path: String,
    pub provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NetworkDrive {
    pub name: String,
    pub path: String,
    pub protocol: String,
    pub remote_url: String,
    pub host: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LanServer {
    pub name: String,
    pub host: String,
    pub address: String,
    pub protocol: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NetworkShareInfo {
    pub name: String,
    pub share_type: String,
    pub comment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConnectNetworkResult {
    pub status: String,
    pub url: String,
    pub mounted_drive: Option<NetworkDrive>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SpecialPaths {
    pub home: Option<String>,
    pub inbox: Option<String>,
    pub desktop: Option<String>,
    pub documents: Option<String>,
    pub downloads: Option<String>,
    pub pictures: Option<String>,
    pub music: Option<String>,
    pub videos: Option<String>,
    pub applications: Option<String>,
    pub cloud_drives: Vec<CloudDrive>,
    pub network_drives: Vec<NetworkDrive>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TrashedItem {
    pub original_path: String,
    pub trashed_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PathPair {
    pub from_path: String,
    pub to_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FolderStats {
    pub path: String,
    pub total_size: u64,
    pub file_count: u64,
    pub folder_count: u64,
    pub truncated: bool,
}

fn expand_path(raw: &str) -> PathBuf {
    if raw == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from(raw));
    }
    if let Some(rest) = raw.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(raw)
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn is_entry_hidden(name: &str, link_meta: Option<&Metadata>) -> bool {
    if name.starts_with('.') {
        return true;
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(meta) = link_meta {
            if (meta.st_flags() & UF_HIDDEN) != 0 {
                return true;
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = link_meta;

    false
}

fn build_file_entry(path: &Path) -> Result<FileEntry, String> {
    let link_meta = fs::symlink_metadata(path)
        .map_err(|e| format!("Failed to inspect '{}': {}", path.display(), e))?;
    // Only follow symlinks with an extra stat call; avoids doubling stat round-trips on LAN/SMB drives.
    let effective_meta = if link_meta.file_type().is_symlink() {
        fs::metadata(path).unwrap_or_else(|_| link_meta.clone())
    } else {
        link_meta.clone()
    };

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path_to_string(path));

    let is_dir = effective_meta.is_dir();
    let size = if is_dir { 0 } else { effective_meta.len() };
    let modified_timestamp = effective_meta
        .modified()
        .ok()
        .map(|mtime| DateTime::<Utc>::from(mtime).timestamp_millis())
        .unwrap_or(0);

    let extension = if is_dir {
        String::new()
    } else {
        path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("")
            .to_lowercase()
    };

    let is_hidden = is_entry_hidden(&name, Some(&link_meta));

    Ok(FileEntry {
        name,
        path: path_to_string(path),
        is_dir,
        size,
        modified_timestamp,
        extension,
        is_hidden,
    })
}

fn sort_entries(entries: &mut [FileEntry]) {
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });
}

fn path_occupied(path: &Path) -> bool {
    path.exists() || fs::symlink_metadata(path).is_ok()
}

fn split_stem_and_ext(name: &str, is_dir: bool) -> (String, Option<String>) {
    if is_dir {
        return (name.to_string(), None);
    }

    if let Some(dot_idx) = name.rfind('.') {
        // Treat dotfiles without another extension (e.g. ".gitignore") as stem-only.
        if dot_idx > 0 && dot_idx < name.len() - 1 {
            let stem = &name[..dot_idx];
            let ext = &name[dot_idx + 1..];
            return (stem.to_string(), Some(ext.to_string()));
        }
    }

    (name.to_string(), None)
}

fn resolve_unique_dest_path(dest_dir: &Path, original_name: &str, is_dir: bool) -> PathBuf {
    let initial = dest_dir.join(original_name);
    if !path_occupied(&initial) {
        return initial;
    }

    let (stem, ext) = split_stem_and_ext(original_name, is_dir);

    let first_copy_name = match &ext {
        Some(ext) => format!("{} - Copy.{}", stem, ext),
        None => format!("{} - Copy", stem),
    };
    let first_copy = dest_dir.join(first_copy_name);
    if !path_occupied(&first_copy) {
        return first_copy;
    }

    let mut counter: usize = 2;
    loop {
        let candidate_name = match &ext {
            Some(ext) => format!("{} - Copy ({}).{}", stem, counter, ext),
            None => format!("{} - Copy ({})", stem, counter),
        };
        let candidate = dest_dir.join(candidate_name);
        if !path_occupied(&candidate) {
            return candidate;
        }
        counter += 1;
    }
}

fn is_same_or_descendant(candidate: &Path, potential_ancestor: &Path) -> bool {
    match (fs::canonicalize(candidate), fs::canonicalize(potential_ancestor)) {
        (Ok(cand), Ok(anc)) => cand == anc || cand.starts_with(&anc),
        _ => candidate == potential_ancestor || candidate.starts_with(potential_ancestor),
    }
}

fn copy_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    let link_meta = fs::symlink_metadata(src)
        .map_err(|e| format!("Failed to read metadata for '{}': {}", src.display(), e))?;

    if link_meta.file_type().is_symlink() {
        #[cfg(unix)]
        {
            let link_target = fs::read_link(src)
                .map_err(|e| format!("Failed to read symlink '{}': {}", src.display(), e))?;
            symlink(&link_target, dst).map_err(|e| {
                format!(
                    "Failed to create symlink '{}' -> '{}': {}",
                    dst.display(),
                    link_target.display(),
                    e
                )
            })?;
            return Ok(());
        }
    }

    if link_meta.is_dir() {
        fs::create_dir(dst)
            .map_err(|e| format!("Failed to create directory '{}': {}", dst.display(), e))?;

        let read_dir = fs::read_dir(src)
            .map_err(|e| format!("Failed to read directory '{}': {}", src.display(), e))?;

        for entry_res in read_dir {
            let entry = entry_res
                .map_err(|e| format!("Failed to read entry inside '{}': {}", src.display(), e))?;
            let child_src = entry.path();
            let child_dst = dst.join(entry.file_name());
            copy_recursive(&child_src, &child_dst)?;
        }
    } else {
        fs::copy(src, dst).map_err(|e| {
            format!(
                "Failed to copy '{}' to '{}': {}",
                src.display(),
                dst.display(),
                e
            )
        })?;
    }

    Ok(())
}

fn infer_cloud_drive_info(folder_name: &str) -> (String, String) {
    let lower = folder_name.to_lowercase();
    if lower.starts_with("googledrive") {
        let suffix = folder_name
            .split_once('-')
            .map(|(_, s)| s.trim())
            .filter(|s| !s.is_empty());
        let name = match suffix {
            Some(account) => format!("Google Drive ({})", account),
            None => "Google Drive".to_string(),
        };
        (name, "Google Drive".to_string())
    } else if lower.starts_with("onedrive") {
        let suffix = folder_name
            .split_once('-')
            .map(|(_, s)| s.trim())
            .filter(|s| !s.is_empty());
        let name = match suffix {
            Some(account) => format!("OneDrive ({})", account),
            None => "OneDrive".to_string(),
        };
        (name, "OneDrive".to_string())
    } else if lower.starts_with("dropbox") {
        (folder_name.replace('-', " "), "Dropbox".to_string())
    } else if lower.starts_with("box") {
        ("Box".to_string(), "Box".to_string())
    } else if lower.contains("icloud") {
        ("iCloud Drive".to_string(), "iCloud".to_string())
    } else if lower.contains("proton") {
        ("Proton Drive".to_string(), "Proton Drive".to_string())
    } else if lower.contains("nextcloud") {
        ("Nextcloud".to_string(), "Nextcloud".to_string())
    } else {
        (folder_name.to_string(), "Cloud".to_string())
    }
}

fn scan_cloud_drives(home: Option<&Path>) -> Vec<CloudDrive> {
    let Some(home_dir) = home else {
        return Vec::new();
    };

    let mut drives = Vec::new();

    // Scan ~/Library/CloudStorage (macOS FileProvider cloud mounts: Google Drive, OneDrive, Dropbox, Box, etc.)
    let cloud_storage_dir = home_dir.join("Library").join("CloudStorage");
    if let Ok(entries) = fs::read_dir(&cloud_storage_dir) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            let raw_name = entry.file_name().to_string_lossy().into_owned();
            if raw_name.starts_with('.') {
                continue;
            }
            if fs::metadata(&entry_path).map(|m| m.is_dir()).unwrap_or(false) {
                let (display_name, provider) = infer_cloud_drive_info(&raw_name);
                drives.push(CloudDrive {
                    name: display_name,
                    path: path_to_string(&entry_path),
                    provider,
                });
            }
        }
    }

    // Also detect native macOS iCloud Drive if present and not already included.
    let icloud_docs = home_dir
        .join("Library")
        .join("Mobile Documents")
        .join("com~apple~CloudDocs");
    if icloud_docs.is_dir() && !drives.iter().any(|d| d.provider == "iCloud") {
        drives.push(CloudDrive {
            name: "iCloud Drive".to_string(),
            path: path_to_string(&icloud_docs),
            provider: "iCloud".to_string(),
        });
    }

    drives.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| Ordering::Equal)
    });

    drives
}

fn read_dir_entries_sync(path: &str, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
    // Support browsing directly inside `.zip` files via virtual path `/path/to/archive.zip::inner/folder`
    if let Some((zip_file_path, inner_dir)) = parse_zip_virtual_path(path) {
        return read_zip_dir_entries(&zip_file_path, &inner_dir, show_hidden);
    }

    let dir_path = expand_path(path);
    if !dir_path.exists() {
        return Err(format!("Directory does not exist: {}", dir_path.display()));
    }
    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", dir_path.display()));
    }

    let read_dir = fs::read_dir(&dir_path)
        .map_err(|e| format!("Failed to read directory '{}': {}", dir_path.display(), e))?;

    let mut entries = Vec::new();
    for entry_res in read_dir {
        let Ok(entry) = entry_res else {
            continue;
        };
        let entry_path = entry.path();
        let Ok(file_entry) = build_file_entry(&entry_path) else {
            continue;
        };

        if !show_hidden && file_entry.is_hidden {
            continue;
        }
        entries.push(file_entry);
    }

    sort_entries(&mut entries);
    Ok(entries)
}

#[tauri::command]
pub async fn read_dir_entries(path: String, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || read_dir_entries_sync(&path, show_hidden))
        .await
        .map_err(|e| format!("Failed to read directory: {}", e))?
}

fn get_subfolders_sync(path: &str) -> Result<Vec<FileEntry>, String> {
    let dir_path = expand_path(path);
    if !dir_path.exists() {
        return Err(format!("Directory does not exist: {}", dir_path.display()));
    }
    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", dir_path.display()));
    }

    let read_dir = fs::read_dir(&dir_path)
        .map_err(|e| format!("Failed to read directory '{}': {}", dir_path.display(), e))?;

    let mut folders = Vec::new();
    for entry_res in read_dir {
        let Ok(entry) = entry_res else {
            continue;
        };
        let entry_path = entry.path();
        let Ok(file_entry) = build_file_entry(&entry_path) else {
            continue;
        };

        if file_entry.is_dir && !file_entry.is_hidden {
            folders.push(file_entry);
        }
    }

    sort_entries(&mut folders);
    Ok(folders)
}

#[tauri::command]
pub async fn get_subfolders(path: String) -> Result<Vec<FileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || get_subfolders_sync(&path))
        .await
        .map_err(|e| format!("Failed to read subfolders: {}", e))?
}

fn default_inbox_dir(home: Option<&Path>) -> Option<PathBuf> {
    home.map(|h| h.join("MXplore Inbox"))
}

#[tauri::command]
pub fn get_or_create_inbox_dir(custom_path: Option<String>) -> Result<String, String> {
    let target = match custom_path.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => expand_path(raw),
        None => default_inbox_dir(dirs::home_dir().as_deref())
            .ok_or_else(|| "Unable to determine user home directory".to_string())?,
    };

    if !target.exists() {
        fs::create_dir_all(&target).map_err(|e| {
            format!(
                "Failed to create Inbox directory '{}': {}",
                target.display(),
                e
            )
        })?;
    } else if !target.is_dir() {
        return Err(format!(
            "Inbox path exists but is not a directory: {}",
            target.display()
        ));
    }

    Ok(path_to_string(&target))
}

#[tauri::command]
pub fn create_quick_note(
    dir: String,
    title: Option<String>,
    content: String,
) -> Result<FileEntry, String> {
    let dir_path = expand_path(&dir);
    if !dir_path.exists() {
        fs::create_dir_all(&dir_path).map_err(|e| {
            format!(
                "Failed to create target directory '{}': {}",
                dir_path.display(),
                e
            )
        })?;
    }
    if !dir_path.is_dir() {
        return Err(format!(
            "Target path is not a directory: {}",
            dir_path.display()
        ));
    }

    let raw_title = title
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.replace(['/', '\\', ':', '\0'], "-"))
        .unwrap_or_else(|| {
            let now = chrono::Local::now();
            format!("Quick Note {}", now.format("%Y-%m-%d %H-%M"))
        });

    let file_name = if raw_title.to_lowercase().ends_with(".md")
        || raw_title.to_lowercase().ends_with(".txt")
    {
        raw_title
    } else {
        format!("{}.md", raw_title)
    };

    let target = resolve_unique_dest_path(&dir_path, &file_name, false);
    fs::write(&target, content.as_bytes())
        .map_err(|e| format!("Failed to save quick note '{}': {}", target.display(), e))?;

    build_file_entry(&target)
}

#[tauri::command]
pub fn get_special_paths() -> SpecialPaths {
    let home = dirs::home_dir();
    let applications_path = PathBuf::from("/Applications");
    let inbox_path = default_inbox_dir(home.as_deref()).map(|p| {
        if !p.exists() {
            let _ = fs::create_dir_all(&p);
        }
        path_to_string(&p)
    });

    SpecialPaths {
        home: home.as_ref().map(|p| path_to_string(p)),
        inbox: inbox_path,
        desktop: dirs::desktop_dir().map(|p| path_to_string(&p)),
        documents: dirs::document_dir().map(|p| path_to_string(&p)),
        downloads: dirs::download_dir().map(|p| path_to_string(&p)),
        pictures: dirs::picture_dir().map(|p| path_to_string(&p)),
        music: dirs::audio_dir().map(|p| path_to_string(&p)),
        videos: dirs::video_dir().map(|p| path_to_string(&p)),
        applications: applications_path
            .is_dir()
            .then(|| path_to_string(&applications_path)),
        cloud_drives: scan_cloud_drives(home.as_deref()),
        network_drives: scan_network_drives(),
    }
}

#[tauri::command]
pub fn create_directory(path: String) -> Result<FileEntry, String> {
    let target = expand_path(&path);
    if path_occupied(&target) {
        return Err(format!("Target already exists: {}", target.display()));
    }
    fs::create_dir(&target)
        .map_err(|e| format!("Failed to create directory '{}': {}", target.display(), e))?;

    build_file_entry(&target)
}

#[tauri::command]
pub fn create_empty_file(path: String) -> Result<FileEntry, String> {
    let target = expand_path(&path);
    if path_occupied(&target) {
        return Err(format!("Target already exists: {}", target.display()));
    }
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|e| format!("Failed to create file '{}': {}", target.display(), e))?;

    build_file_entry(&target)
}

#[tauri::command]
pub fn rename_item(old_path: String, new_path: String) -> Result<FileEntry, String> {
    let old = expand_path(&old_path);
    let new = expand_path(&new_path);

    if !path_occupied(&old) {
        return Err(format!("Source does not exist: {}", old.display()));
    }

    if old == new {
        return build_file_entry(&new);
    }

    // Allow case-only renames on case-insensitive macOS APFS volumes.
    let is_case_only_rename = old.parent() == new.parent()
        && old
            .file_name()
            .zip(new.file_name())
            .map(|(a, b)| a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase())
            .unwrap_or(false);

    if path_occupied(&new) && !is_case_only_rename {
        return Err(format!("Destination already exists: {}", new.display()));
    }

    fs::rename(&old, &new).map_err(|e| {
        format!(
            "Failed to rename '{}' to '{}': {}",
            old.display(),
            new.display(),
            e
        )
    })?;

    build_file_entry(&new)
}

fn read_trash_entry_names(trash_dir: &Path) -> Option<HashSet<String>> {
    let read_dir = fs::read_dir(trash_dir).ok()?;
    let mut names = HashSet::new();
    for entry in read_dir.flatten() {
        names.insert(entry.file_name().to_string_lossy().into_owned());
    }
    Some(names)
}

fn find_newly_trashed_path(
    trash_dir: &Path,
    before_names: &HashSet<String>,
    original_path: &Path,
) -> Option<String> {
    let read_dir = fs::read_dir(trash_dir).ok()?;
    let orig_name = original_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let orig_stem = original_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let mut new_candidates: Vec<(PathBuf, String)> = Vec::new();
    for entry in read_dir.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !before_names.contains(&name) {
            new_candidates.push((entry.path(), name));
        }
    }

    if new_candidates.len() == 1 {
        return Some(path_to_string(&new_candidates[0].0));
    }

    // Exact filename match first
    if let Some((path, _)) = new_candidates.iter().find(|(_, name)| name == &orig_name) {
        return Some(path_to_string(path));
    }

    // Stem prefix match (macOS appends timestamp like "file 21.55.01.txt" on Trash name collision)
    if !orig_stem.is_empty() {
        if let Some((path, _)) = new_candidates
            .iter()
            .find(|(_, name)| name.to_lowercase().starts_with(&orig_stem))
        {
            return Some(path_to_string(path));
        }
    }

    new_candidates.first().map(|(p, _)| path_to_string(p))
}

#[tauri::command]
pub fn delete_items(paths: Vec<String>) -> Result<Vec<TrashedItem>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }

    let expanded: Vec<PathBuf> = paths.iter().map(|p| expand_path(p)).collect();
    for path in &expanded {
        if !path_occupied(path) {
            return Err(format!("Item does not exist: {}", path.display()));
        }
    }

    let user_trash_dir = dirs::home_dir().map(|h| h.join(".Trash"));
    let mut results = Vec::with_capacity(expanded.len());

    for path in &expanded {
        let before_names = user_trash_dir
            .as_deref()
            .and_then(read_trash_entry_names);

        trash::delete(path).map_err(|e| {
            format!("Failed to move '{}' to Trash: {}", path.display(), e)
        })?;

        let trashed_path = match (&user_trash_dir, &before_names) {
            (Some(trash_dir), Some(before)) => {
                find_newly_trashed_path(trash_dir, before, path)
            }
            _ => None,
        };

        results.push(TrashedItem {
            original_path: path_to_string(path),
            trashed_path,
        });
    }

    Ok(results)
}

#[tauri::command]
pub fn restore_paths(pairs: Vec<PathPair>) -> Result<Vec<FileEntry>, String> {
    if pairs.is_empty() {
        return Ok(Vec::new());
    }

    let mut restored = Vec::with_capacity(pairs.len());

    for pair in pairs {
        let src = expand_path(&pair.from_path);
        let desired_dest = expand_path(&pair.to_path);

        if !path_occupied(&src) {
            return Err(format!("Source item no longer exists: {}", src.display()));
        }

        if src == desired_dest {
            restored.push(build_file_entry(&desired_dest)?);
            continue;
        }

        let src_meta = fs::symlink_metadata(&src)
            .map_err(|e| format!("Failed to inspect '{}': {}", src.display(), e))?;
        let is_dir = src_meta.is_dir();

        let dest_parent = desired_dest
            .parent()
            .ok_or_else(|| format!("Invalid destination path: {}", desired_dest.display()))?;
        if !dest_parent.exists() {
            fs::create_dir_all(dest_parent).map_err(|e| {
                format!(
                    "Failed to recreate parent directory '{}': {}",
                    dest_parent.display(),
                    e
                )
            })?;
        }

        if is_dir && is_same_or_descendant(dest_parent, &src) {
            return Err(format!(
                "Cannot move directory '{}' into itself or one of its subdirectories",
                src.display()
            ));
        }

        let is_case_only_rename = src.parent() == desired_dest.parent()
            && src
                .file_name()
                .zip(desired_dest.file_name())
                .map(|(a, b)| {
                    a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
                })
                .unwrap_or(false);

        let final_dest = if path_occupied(&desired_dest) && !is_case_only_rename {
            let desired_name = desired_dest
                .file_name()
                .ok_or_else(|| format!("Invalid destination path: {}", desired_dest.display()))?
                .to_string_lossy()
                .into_owned();
            resolve_unique_dest_path(dest_parent, &desired_name, is_dir)
        } else {
            desired_dest
        };

        match fs::rename(&src, &final_dest) {
            Ok(()) => {}
            Err(_) => {
                copy_recursive(&src, &final_dest)?;
                if is_dir && !src_meta.file_type().is_symlink() {
                    fs::remove_dir_all(&src).map_err(|e| {
                        format!(
                            "Restored '{}' to '{}', but failed to remove source directory: {}",
                            src.display(),
                            final_dest.display(),
                            e
                        )
                    })?;
                } else {
                    fs::remove_file(&src).map_err(|e| {
                        format!(
                            "Restored '{}' to '{}', but failed to remove source file: {}",
                            src.display(),
                            final_dest.display(),
                            e
                        )
                    })?;
                }
            }
        }

        restored.push(build_file_entry(&final_dest)?);
    }

    Ok(restored)
}

#[tauri::command]
pub fn copy_items(sources: Vec<String>, dest_dir: String) -> Result<Vec<FileEntry>, String> {
    let dest = expand_path(&dest_dir);
    if !dest.is_dir() {
        return Err(format!(
            "Destination directory does not exist or is not a directory: {}",
            dest.display()
        ));
    }

    let mut created = Vec::with_capacity(sources.len());

    for raw_src in sources {
        if let Some((zip_file, inner_path)) = parse_zip_virtual_path(&raw_src) {
            let extracted = extract_zip_entry_sync(&zip_file, &inner_path, &dest)?;
            created.extend(extracted);
            continue;
        }

        let src = expand_path(&raw_src);
        if !path_occupied(&src) {
            return Err(format!("Source does not exist: {}", src.display()));
        }

        let src_meta = fs::symlink_metadata(&src)
            .map_err(|e| format!("Failed to inspect '{}': {}", src.display(), e))?;
        let is_dir = src_meta.is_dir();

        if is_dir && is_same_or_descendant(&dest, &src) {
            return Err(format!(
                "Cannot copy directory '{}' into itself or one of its subdirectories",
                src.display()
            ));
        }

        let file_name = src
            .file_name()
            .ok_or_else(|| format!("Invalid source path: {}", src.display()))?
            .to_string_lossy()
            .into_owned();

        let target = resolve_unique_dest_path(&dest, &file_name, is_dir);
        copy_recursive(&src, &target)?;
        created.push(build_file_entry(&target)?);
    }

    Ok(created)
}

#[tauri::command]
pub fn move_items(sources: Vec<String>, dest_dir: String) -> Result<Vec<FileEntry>, String> {
    let dest = expand_path(&dest_dir);
    if !dest.is_dir() {
        return Err(format!(
            "Destination directory does not exist or is not a directory: {}",
            dest.display()
        ));
    }

    let dest_canon = fs::canonicalize(&dest).unwrap_or_else(|_| dest.clone());
    let mut moved = Vec::with_capacity(sources.len());

    for raw_src in sources {
        if let Some((zip_file, inner_path)) = parse_zip_virtual_path(&raw_src) {
            let extracted = extract_zip_entry_sync(&zip_file, &inner_path, &dest)?;
            moved.extend(extracted);
            continue;
        }

        let src = expand_path(&raw_src);
        if !path_occupied(&src) {
            return Err(format!("Source does not exist: {}", src.display()));
        }

        let src_meta = fs::symlink_metadata(&src)
            .map_err(|e| format!("Failed to inspect '{}': {}", src.display(), e))?;
        let is_dir = src_meta.is_dir();

        if is_dir && is_same_or_descendant(&dest, &src) {
            return Err(format!(
                "Cannot move directory '{}' into itself or one of its subdirectories",
                src.display()
            ));
        }

        // Moving an item into the same directory it already resides in is a no-op.
        if let Some(parent) = src.parent() {
            let parent_canon = fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
            if parent_canon == dest_canon {
                moved.push(build_file_entry(&src)?);
                continue;
            }
        }

        let file_name = src
            .file_name()
            .ok_or_else(|| format!("Invalid source path: {}", src.display()))?
            .to_string_lossy()
            .into_owned();

        let target = resolve_unique_dest_path(&dest, &file_name, is_dir);

        match fs::rename(&src, &target) {
            Ok(()) => {}
            Err(_) => {
                // Fallback for cross-device moves (e.g. Mac HD <-> external drive / CloudStorage).
                copy_recursive(&src, &target)?;
                if is_dir && !src_meta.file_type().is_symlink() {
                    fs::remove_dir_all(&src).map_err(|e| {
                        format!(
                            "Copied '{}' to '{}', but failed to remove original directory: {}",
                            src.display(),
                            target.display(),
                            e
                        )
                    })?;
                } else {
                    fs::remove_file(&src).map_err(|e| {
                        format!(
                            "Copied '{}' to '{}', but failed to remove original file: {}",
                            src.display(),
                            target.display(),
                            e
                        )
                    })?;
                }
            }
        }

        moved.push(build_file_entry(&target)?);
    }

    Ok(moved)
}

#[tauri::command]
pub fn open_item(path: String) -> Result<(), String> {
    let target = expand_path(&path);
    if !path_occupied(&target) {
        return Err(format!("Item does not exist: {}", target.display()));
    }
    open::that(&target).map_err(|e| format!("Failed to open '{}': {}", target.display(), e))
}

#[tauri::command]
pub fn quicklook_item(path: String) -> Result<(), String> {
    let target = expand_path(&path);
    if !path_occupied(&target) {
        return Err(format!("Item does not exist: {}", target.display()));
    }

    let target_str = path_to_string(&target);

    if let Ok(mut guard) = QUICKLOOK_PROCESS.lock() {
        if let Some((prev_path, mut child)) = guard.take() {
            // If an existing QuickLook preview window is still running, close it first.
            let still_running = matches!(child.try_wait(), Ok(None));
            if still_running {
                let _ = child.kill();
                let _ = child.wait();
                // Pressing Space again on the same file toggles QuickLook closed like Finder.
                if prev_path == target_str {
                    return Ok(());
                }
            }
        }

        let child = Command::new("qlmanage")
            .args(["-p", &target_str])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to launch QuickLook for '{}': {}", target.display(), e))?;

        *guard = Some((target_str, child));
        return Ok(());
    }

    Command::new("qlmanage")
        .args(["-p", &target_str])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to launch QuickLook for '{}': {}", target.display(), e))?;

    Ok(())
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    let target = expand_path(&path);
    if !path_occupied(&target) {
        return Err(format!("Item does not exist: {}", target.display()));
    }

    let target_str = path_to_string(&target);

    // If MXplore is configured as macOS's global NSFileViewer, `open -R` would loop back into MXplore.
    // Explicitly ask Apple Finder to reveal the item instead.
    if crate::macos_integration::is_mxplore_default_file_viewer() {
        let osa_status = Command::new("osascript")
            .args([
                "-e",
                "on run argv",
                "-e",
                "tell application \"Finder\"",
                "-e",
                "reveal (POSIX file (item 1 of argv))",
                "-e",
                "activate",
                "-e",
                "end tell",
                "-e",
                "end run",
                &target_str,
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        if matches!(osa_status, Ok(s) if s.success()) {
            return Ok(());
        }

        // Fallback if Finder Automation permission is not granted: open parent folder directly in Apple Finder
        let folder_to_open = if target.is_dir() {
            target.clone()
        } else {
            target
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| target.clone())
        };
        let fallback_status = Command::new("open")
            .args(["-b", "com.apple.finder", &path_to_string(&folder_to_open)])
            .status()
            .map_err(|e| format!("Failed to open Finder for '{}': {}", target.display(), e))?;

        if !fallback_status.success() {
            return Err(format!(
                "Apple Finder returned non-zero exit status while opening '{}'",
                target.display()
            ));
        }
        return Ok(());
    }

    let status = Command::new("open")
        .args(["-R", &target_str])
        .status()
        .map_err(|e| format!("Failed to reveal '{}' in Finder: {}", target.display(), e))?;

    if !status.success() {
        return Err(format!(
            "Finder returned non-zero exit status while revealing '{}'",
            target.display()
        ));
    }

    Ok(())
}

#[tauri::command]
pub fn open_in_terminal(path: String) -> Result<(), String> {
    let target = expand_path(&path);
    if !path_occupied(&target) {
        return Err(format!("Path does not exist: {}", target.display()));
    }

    let dir_target = if target.is_dir() {
        target
    } else {
        target
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| format!("Cannot resolve parent directory for '{}'", target.display()))?
    };

    let status = Command::new("open")
        .args(["-a", "Terminal", &path_to_string(&dir_target)])
        .status()
        .map_err(|e| {
            format!(
                "Failed to open Terminal at '{}': {}",
                dir_target.display(),
                e
            )
        })?;

    if !status.success() {
        return Err(format!(
            "Terminal returned non-zero exit status for '{}'",
            dir_target.display()
        ));
    }

    Ok(())
}

#[tauri::command]
pub async fn spotlight_search(
    dir: String,
    query: String,
    show_hidden: Option<bool>,
) -> Result<Vec<FileEntry>, String> {
    let trimmed_query = query.trim().to_string();
    if trimmed_query.is_empty() {
        return Ok(Vec::new());
    }

    let search_dir = expand_path(&dir);
    if !search_dir.is_dir() {
        return Err(format!(
            "Search directory does not exist or is not a directory: {}",
            search_dir.display()
        ));
    }

    let include_hidden = show_hidden.unwrap_or(false);

    tauri::async_runtime::spawn_blocking(move || {
        let dir_str = path_to_string(&search_dir);
        let output = Command::new("mdfind")
            .args(["-onlyin", &dir_str, "-name", &trimmed_query])
            .output()
            .map_err(|e| format!("Failed to run Spotlight search (mdfind): {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "Spotlight search failed".to_string()
            } else {
                format!("Spotlight search failed: {}", stderr)
            });
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut results = Vec::new();
        const MAX_RESULTS: usize = 2000;

        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed == dir_str {
                continue;
            }
            let entry_path = Path::new(trimmed);
            let Ok(entry) = build_file_entry(entry_path) else {
                continue;
            };
            if !include_hidden && entry.is_hidden {
                continue;
            }
            results.push(entry);
            if results.len() >= MAX_RESULTS {
                break;
            }
        }

        sort_entries(&mut results);
        Ok(results)
    })
    .await
    .map_err(|e| format!("Spotlight search task failed: {}", e))?
}

fn compute_folder_stats_sync(dir: &Path) -> Result<FolderStats, String> {
    if !dir.exists() {
        return Err(format!("Folder does not exist: {}", dir.display()));
    }
    if !dir.is_dir() {
        return Err(format!("Path is not a directory: {}", dir.display()));
    }

    const MAX_SCANNED_ITEMS: u64 = 30_000;
    const MAX_SCAN_DURATION: Duration = Duration::from_millis(1800);

    let start = Instant::now();
    let mut stack = vec![dir.to_path_buf()];
    let mut total_size: u64 = 0;
    let mut file_count: u64 = 0;
    let mut folder_count: u64 = 0;
    let mut scanned_items: u64 = 0;
    let mut truncated = false;

    while let Some(current_dir) = stack.pop() {
        if scanned_items >= MAX_SCANNED_ITEMS || start.elapsed() >= MAX_SCAN_DURATION {
            truncated = true;
            break;
        }

        let Ok(read_dir) = fs::read_dir(&current_dir) else {
            continue;
        };

        for entry_res in read_dir {
            let Ok(entry) = entry_res else {
                continue;
            };
            let entry_path = entry.path();
            let Ok(meta) = fs::symlink_metadata(&entry_path) else {
                continue;
            };

            scanned_items += 1;

            if meta.file_type().is_symlink() {
                file_count += 1;
                total_size = total_size.saturating_add(meta.len());
            } else if meta.is_dir() {
                folder_count += 1;
                stack.push(entry_path);
            } else {
                file_count += 1;
                total_size = total_size.saturating_add(meta.len());
            }

            if scanned_items >= MAX_SCANNED_ITEMS || start.elapsed() >= MAX_SCAN_DURATION {
                truncated = true;
                break;
            }
        }
    }

    Ok(FolderStats {
        path: path_to_string(dir),
        total_size,
        file_count,
        folder_count,
        truncated,
    })
}

#[tauri::command]
pub async fn get_folder_stats(path: String) -> Result<FolderStats, String> {
    let dir_path = expand_path(&path);
    tauri::async_runtime::spawn_blocking(move || compute_folder_stats_sync(&dir_path))
        .await
        .map_err(|e| format!("Failed to calculate folder size: {}", e))?
}

fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(((bytes.len() + 2) / 3) * 4);
    let mut chunks = bytes.chunks_exact(3);
    for chunk in &mut chunks {
        let n = ((chunk[0] as u32) << 16) | ((chunk[1] as u32) << 8) | (chunk[2] as u32);
        out.push(TABLE[((n >> 18) & 0x3f) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3f) as usize] as char);
        out.push(TABLE[((n >> 6) & 0x3f) as usize] as char);
        out.push(TABLE[(n & 0x3f) as usize] as char);
    }
    let rem = chunks.remainder();
    match rem.len() {
        1 => {
            let n = (rem[0] as u32) << 16;
            out.push(TABLE[((n >> 18) & 0x3f) as usize] as char);
            out.push(TABLE[((n >> 12) & 0x3f) as usize] as char);
            out.push('=');
            out.push('=');
        }
        2 => {
            let n = ((rem[0] as u32) << 16) | ((rem[1] as u32) << 8);
            out.push(TABLE[((n >> 18) & 0x3f) as usize] as char);
            out.push(TABLE[((n >> 12) & 0x3f) as usize] as char);
            out.push(TABLE[((n >> 6) & 0x3f) as usize] as char);
            out.push('=');
        }
        _ => {}
    }
    out
}

fn image_mime_for_ext(ext: &str) -> Option<&'static str> {
    match ext {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        "avif" => Some("image/avif"),
        _ => None,
    }
}

fn build_image_thumbnail_sync(path: &Path, max_size: u32) -> Result<String, String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static THUMB_COUNTER: AtomicU64 = AtomicU64::new(1);

    let meta = fs::metadata(path)
        .map_err(|e| format!("Failed to inspect image '{}': {}", path.display(), e))?;
    if !meta.is_file() {
        return Err("Not a regular file".to_string());
    }

    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let web_mime = image_mime_for_ext(&ext);
    let file_size = meta.len();

    // Direct fast-path for small web-native images and SVGs
    const DIRECT_LIMIT_BYTES: u64 = 512 * 1024;
    const FALLBACK_LIMIT_BYTES: u64 = 4 * 1024 * 1024;

    if let Some(mime) = web_mime {
        if ext == "svg" || ext == "gif" || ext == "ico" || file_size <= DIRECT_LIMIT_BYTES {
            if file_size > FALLBACK_LIMIT_BYTES {
                return Err("Image too large for direct thumbnail".to_string());
            }
            let data = fs::read(path)
                .map_err(|e| format!("Failed to read image '{}': {}", path.display(), e))?;
            return Ok(format!("data:{};base64,{}", mime, encode_base64(&data)));
        }
    }

    // Use macOS built-in sips for fast resized JPEG thumbnails (supports HEIC, TIFF, large PNG/JPEG)
    #[cfg(target_os = "macos")]
    {
        let clamped_size = max_size.clamp(64, 512);
        let id = THUMB_COUNTER.fetch_add(1, Ordering::Relaxed);
        let tmp_out = std::env::temp_dir().join(format!(
            "mxplore_thumb_{}_{}.jpg",
            std::process::id(),
            id
        ));

        let status = Command::new("/usr/bin/sips")
            .args([
                "-Z",
                &clamped_size.to_string(),
                "-s",
                "format",
                "jpeg",
                "-s",
                "formatOptions",
                "75",
            ])
            .arg(path)
            .arg("--out")
            .arg(&tmp_out)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();

        if let Ok(exit) = status {
            if exit.success() {
                if let Ok(bytes) = fs::read(&tmp_out) {
                    let _ = fs::remove_file(&tmp_out);
                    if !bytes.is_empty() {
                        return Ok(format!("data:image/jpeg;base64,{}", encode_base64(&bytes)));
                    }
                }
            }
        }
        let _ = fs::remove_file(&tmp_out);
    }

    // Fallback to raw bytes if web-compatible and reasonably sized
    if let Some(mime) = web_mime {
        if file_size <= FALLBACK_LIMIT_BYTES {
            let data = fs::read(path)
                .map_err(|e| format!("Failed to read image '{}': {}", path.display(), e))?;
            return Ok(format!("data:{};base64,{}", mime, encode_base64(&data)));
        }
    }

    Err("Thumbnail generation not available for this image".to_string())
}

#[tauri::command]
pub async fn get_image_thumbnail(path: String, max_size: Option<u32>) -> Result<String, String> {
    let size = max_size.unwrap_or(240);
    tauri::async_runtime::spawn_blocking(move || {
        if let Some((zip_file, inner_path)) = parse_zip_virtual_path(&path) {
            if inner_path.is_empty() {
                return Err("Not an image file inside ZIP".to_string());
            }
            let temp_file = extract_zip_entry_to_temp_sync(&zip_file, &inner_path)?;
            return build_image_thumbnail_sync(&temp_file, size);
        }
        let file_path = expand_path(&path);
        build_image_thumbnail_sync(&file_path, size)
    })
    .await
    .map_err(|e| format!("Thumbnail task failed: {}", e))?
}

// =========================== LAN Network Drives ===========================

fn percent_encode_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.as_bytes() {
        let ch = *byte as char;
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '~') {
            out.push(ch);
        } else {
            out.push_str(&format!("%{:02X}", byte));
        }
    }
    out
}

fn percent_encode_path(path: &str) -> String {
    path.split('/')
        .map(|seg| {
            if seg.is_empty() {
                String::new()
            } else {
                percent_encode_component(seg)
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn sanitize_remote_source(raw: &str) -> String {
    // Strip credentials like `//user:pass@host/share` or `smb://user:pass@host/share` -> keep user without password
    if let Some(at_idx) = raw.find('@') {
        let (prefix, rest) = raw.split_at(at_idx);
        // Find scheme separator `://` or leading `//`
        let auth_start = if let Some(scheme_idx) = prefix.find("://") {
            scheme_idx + 3
        } else if prefix.starts_with("//") {
            2
        } else {
            0
        };
        let auth_part = &prefix[auth_start..];
        if let Some(colon_idx) = auth_part.find(':') {
            let user_only = &auth_part[..colon_idx];
            return format!("{}{}{}", &prefix[..auth_start], user_only, rest);
        }
    }
    raw.to_string()
}

fn extract_host_from_source(source: &str, fs_type: &str) -> String {
    let cleaned = sanitize_remote_source(source);
    if fs_type == "nfs" {
        if let Some((host, _)) = cleaned.split_once(':') {
            return host.trim_start_matches('/').to_string();
        }
    }
    let without_scheme = if let Some((_, rest)) = cleaned.split_once("://") {
        rest
    } else {
        cleaned.trim_start_matches('/')
    };
    let after_auth = without_scheme
        .rsplit_once('@')
        .map(|(_, r)| r)
        .unwrap_or(without_scheme);
    let host_and_port = after_auth.split('/').next().unwrap_or(after_auth);
    // Strip port if not IPv6 bracketed
    if host_and_port.starts_with('[') {
        host_and_port
            .split(']')
            .next()
            .map(|h| format!("{}]", h))
            .unwrap_or_else(|| host_and_port.to_string())
    } else {
        host_and_port
            .split(':')
            .next()
            .unwrap_or(host_and_port)
            .to_string()
    }
}

fn format_network_remote_url(source: &str, fs_type: &str) -> String {
    let sanitized = sanitize_remote_source(source);
    if sanitized.contains("://") {
        return sanitized;
    }
    let trimmed = sanitized.trim_start_matches('/');
    match fs_type {
        "smbfs" | "cifs" => format!("smb://{}", trimmed),
        "afpfs" => format!("afp://{}", trimmed),
        "nfs" => format!("nfs://{}", trimmed),
        "webdav" => format!("https://{}", trimmed),
        "ftp" => format!("ftp://{}", trimmed),
        _ => sanitized,
    }
}

fn protocol_label_for_fs(fs_type: &str) -> Option<&'static str> {
    match fs_type {
        "smbfs" | "cifs" => Some("SMB"),
        "afpfs" => Some("AFP"),
        "nfs" => Some("NFS"),
        "webdav" => Some("WebDAV"),
        "ftp" => Some("FTP"),
        "sshfs" | "fuse-sshfs" | "osxfuse_sshfs" => Some("SSHFS"),
        _ => None,
    }
}

fn parse_mount_output(stdout: &str) -> Vec<NetworkDrive> {
    let mut drives = Vec::new();
    let mut seen_paths = HashSet::new();

    for raw_line in stdout.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        // Format: `<source> on <mount_point> (<fs_type>, <opt1>, ...)`
        let Some(opts_start) = line.rfind(" (") else {
            continue;
        };
        if !line.ends_with(')') {
            continue;
        }
        let opts_str = &line[opts_start + 2..line.len() - 1];
        let fs_type = opts_str
            .split(',')
            .next()
            .map(str::trim)
            .unwrap_or("")
            .to_lowercase();

        let Some(protocol) = protocol_label_for_fs(&fs_type) else {
            continue;
        };

        let before_opts = &line[..opts_start];
        let Some(on_idx) = before_opts.rfind(" on ") else {
            continue;
        };

        let source = before_opts[..on_idx].trim();
        let mount_point = before_opts[on_idx + 4..].trim();
        if mount_point.is_empty() || mount_point == "/" || seen_paths.contains(mount_point) {
            continue;
        }
        seen_paths.insert(mount_point.to_string());

        let name = Path::new(mount_point)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| mount_point.to_string());

        let host = extract_host_from_source(source, &fs_type);
        let remote_url = format_network_remote_url(source, &fs_type);

        drives.push(NetworkDrive {
            name,
            path: mount_point.to_string(),
            protocol: protocol.to_string(),
            remote_url,
            host,
        });
    }

    drives.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    drives
}

fn scan_network_drives() -> Vec<NetworkDrive> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("/sbin/mount")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output();
        if let Ok(out) = output {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout);
                return parse_mount_output(&text);
            }
        }
    }
    Vec::new()
}

fn normalize_network_url(
    raw_address: &str,
    default_protocol: &str,
    username: Option<&str>,
    password: Option<&str>,
) -> Result<(String, String), String> {
    let trimmed = raw_address.trim();
    if trimmed.is_empty() {
        return Err("Please enter a LAN server address (e.g. 192.168.1.10/Share)".to_string());
    }

    let default_scheme = match default_protocol.trim().to_lowercase().as_str() {
        "afp" => "afp",
        "nfs" => "nfs",
        "webdav" | "https" => "https",
        "http" => "http",
        "ftp" => "ftp",
        "cifs" => "smb",
        _ => "smb",
    };

    // Convert Windows UNC (`\\192.168.1.10\Shared`) into standard URL form
    let (scheme, remainder) = if trimmed.starts_with("\\\\") {
        let converted = trimmed.trim_start_matches('\\').replace('\\', "/");
        ("smb".to_string(), converted)
    } else if let Some((s, rest)) = trimmed.split_once("://") {
        let lower = s.trim().to_lowercase();
        let allowed = matches!(
            lower.as_str(),
            "smb" | "cifs" | "afp" | "nfs" | "http" | "https" | "ftp" | "dav" | "davs"
        );
        if !allowed {
            return Err(format!("Unsupported network protocol: {}", s));
        }
        let normalized_scheme = match lower.as_str() {
            "cifs" => "smb",
            "dav" => "http",
            "davs" => "https",
            other => other,
        };
        (normalized_scheme.to_string(), rest.replace('\\', "/"))
    } else {
        (
            default_scheme.to_string(),
            trimmed.trim_start_matches('/').replace('\\', "/"),
        )
    };

    let clean_rest = remainder.trim_start_matches('/').trim_end_matches('/');
    if clean_rest.is_empty() {
        return Err("Server hostname or IP address cannot be empty".to_string());
    }

    // Separate optional embedded credentials from host + path
    let (host_part, path_part) = match clean_rest.split_once('/') {
        Some((h, p)) => (h, Some(p)),
        None => (clean_rest, None),
    };

    // Strip any inline auth from host_part when explicit username is supplied
    let host_only = host_part
        .rsplit_once('@')
        .map(|(_, h)| h)
        .unwrap_or(host_part)
        .trim();

    if host_only.is_empty() {
        return Err("Invalid server hostname or IP address".to_string());
    }

    let encoded_path = match path_part {
        Some(p) if !p.is_empty() => format!("/{}", percent_encode_path(p)),
        _ => String::new(),
    };

    let user_trimmed = username.map(str::trim).filter(|u| !u.is_empty());
    let pass_val = password.filter(|p| !p.is_empty());

    let display_url = if let Some(user) = user_trimmed {
        format!("{}://{}@{}{}", scheme, user, host_only, encoded_path)
    } else {
        format!("{}://{}{}", scheme, host_only, encoded_path)
    };

    let connect_url = if let Some(user) = user_trimmed {
        let enc_user = percent_encode_component(user);
        if let Some(pass) = pass_val {
            let enc_pass = percent_encode_component(pass);
            format!(
                "{}://{}:{}@{}{}",
                scheme, enc_user, enc_pass, host_only, encoded_path
            )
        } else {
            format!("{}://{}@{}{}", scheme, enc_user, host_only, encoded_path)
        }
    } else if host_part.contains('@') {
        format!("{}://{}{}", scheme, host_part, encoded_path)
    } else {
        format!("{}://{}{}", scheme, host_only, encoded_path)
    };

    Ok((connect_url, display_url))
}

fn find_matching_mounted_drive(
    drives: &[NetworkDrive],
    display_url: &str,
) -> Option<NetworkDrive> {
    let target_host = extract_host_from_source(display_url, "").to_lowercase();
    let target_share = display_url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(display_url)
        .split_once('/')
        .map(|(_, share)| share.split('/').next().unwrap_or("").to_lowercase())
        .filter(|s| !s.is_empty());

    let share = target_share?;
    let share_decoded = share.replace("%20", " ");

    drives
        .iter()
        .find(|d| {
            d.host.to_lowercase() == target_host
                && (d.name.to_lowercase() == share_decoded
                    || d.remote_url
                        .to_lowercase()
                        .ends_with(&format!("/{}", share)))
        })
        .cloned()
}

#[tauri::command]
pub async fn get_network_drives() -> Vec<NetworkDrive> {
    tauri::async_runtime::spawn_blocking(scan_network_drives)
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn connect_network_drive(
    address: String,
    protocol: Option<String>,
    username: Option<String>,
    password: Option<String>,
) -> Result<ConnectNetworkResult, String> {
    let default_proto = protocol.unwrap_or_else(|| "smb".to_string());
    let (connect_url, display_url) = normalize_network_url(
        &address,
        &default_proto,
        username.as_deref(),
        password.as_deref(),
    )?;

    tauri::async_runtime::spawn_blocking(move || {
        let before = scan_network_drives();

        if let Some(existing) = find_matching_mounted_drive(&before, &display_url) {
            return Ok(ConnectNetworkResult {
                status: "already_mounted".to_string(),
                url: display_url,
                mounted_drive: Some(existing),
            });
        }

        let before_paths: HashSet<String> = before.iter().map(|d| d.path.clone()).collect();

        #[cfg(target_os = "macos")]
        {
            let status = Command::new("/usr/bin/open")
                .arg(&connect_url)
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .output()
                .map_err(|e| format!("Failed to initiate network connection: {}", e))?;

            if !status.status.success() {
                let stderr = String::from_utf8_lossy(&status.stderr).trim().to_string();
                return Err(if stderr.is_empty() {
                    format!("macOS could not open network address {}", display_url)
                } else {
                    stderr
                });
            }

            // Poll briefly in case macOS mounts immediately via Keychain / Guest / credentials
            for _ in 0..8 {
                std::thread::sleep(Duration::from_millis(350));
                let after = scan_network_drives();
                if let Some(newly_mounted) = after
                    .iter()
                    .find(|d| !before_paths.contains(&d.path))
                    .cloned()
                {
                    return Ok(ConnectNetworkResult {
                        status: "mounted".to_string(),
                        url: display_url,
                        mounted_drive: Some(newly_mounted),
                    });
                }
            }

            Ok(ConnectNetworkResult {
                status: "prompted".to_string(),
                url: display_url,
                mounted_drive: None,
            })
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = before_paths;
            Err("LAN network drive mounting is currently supported on macOS only".to_string())
        }
    })
    .await
    .map_err(|e| format!("Network connection task failed: {}", e))?
}

#[tauri::command]
pub async fn disconnect_network_drive(mount_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mounted = scan_network_drives();
        let target = mounted
            .iter()
            .find(|d| d.path == mount_path)
            .ok_or_else(|| format!("Network drive is not mounted: {}", mount_path))?;

        #[cfg(target_os = "macos")]
        {
            let out = Command::new("/usr/sbin/diskutil")
                .args(["unmount", &target.path])
                .output()
                .map_err(|e| format!("Failed to unmount '{}': {}", target.name, e))?;

            if out.status.success() {
                return Ok(());
            }

            // Fallback to /sbin/umount
            let fallback = Command::new("/sbin/umount")
                .arg(&target.path)
                .output()
                .map_err(|e| format!("Failed to unmount '{}': {}", target.name, e))?;

            if fallback.status.success() {
                return Ok(());
            }

            let err_msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
            Err(if err_msg.is_empty() {
                format!("Could not eject '{}' (may be in use)", target.name)
            } else {
                err_msg
            })
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = target;
            Err("Disconnecting network drives is supported on macOS only".to_string())
        }
    })
    .await
    .map_err(|e| format!("Disconnect task failed: {}", e))?
}

fn parse_smbutil_shares(stdout: &str) -> Vec<NetworkShareInfo> {
    let mut shares = Vec::new();
    let mut in_table = false;

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with("---") {
            in_table = true;
            continue;
        }
        if !in_table {
            continue;
        }
        if trimmed.ends_with("shares listed") {
            break;
        }

        // Columns in `smbutil view`: `<ShareName>   <Type>   <Comments>`
        let mut parts = trimmed.split_whitespace();
        let Some(first) = parts.next() else {
            continue;
        };

        // Find the share type token (`Disk`, `IPC`, `Printer`, `Pipe`)
        let tokens: Vec<&str> = trimmed.split_whitespace().collect();
        if let Some(type_idx) = tokens
            .iter()
            .rposition(|t| matches!(*t, "Disk" | "IPC" | "Printer" | "Pipe"))
        {
            let name = tokens[..type_idx].join(" ");
            let share_type = tokens[type_idx].to_string();
            let comment = if type_idx + 1 < tokens.len() {
                tokens[type_idx + 1..].join(" ")
            } else {
                String::new()
            };

            if share_type == "Disk" && !name.is_empty() && !name.ends_with('$') {
                shares.push(NetworkShareInfo {
                    name,
                    share_type,
                    comment,
                });
            }
        } else {
            let _ = first;
        }
    }

    shares.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    shares
}

#[tauri::command]
pub async fn list_smb_shares(
    host: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<Vec<NetworkShareInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cleaned_host = extract_host_from_source(
            &host.trim().replace('\\', "/"),
            "smbfs",
        );
        if cleaned_host.is_empty() {
            return Err("Please enter a valid server IP or hostname".to_string());
        }

        #[cfg(target_os = "macos")]
        {
            let user_trimmed = username.as_deref().map(str::trim).filter(|u| !u.is_empty());
            let pass_val = password.as_deref().filter(|p| !p.is_empty());

            let target_arg = if let Some(user) = user_trimmed {
                let enc_user = percent_encode_component(user);
                if let Some(pass) = pass_val {
                    format!("//{}:{}@{}", enc_user, percent_encode_component(pass), cleaned_host)
                } else {
                    format!("//{}@{}", enc_user, cleaned_host)
                }
            } else {
                format!("//guest@{}", cleaned_host)
            };

            let mut cmd = Command::new("/usr/bin/smbutil");
            cmd.arg("view");
            if pass_val.is_none() {
                cmd.arg("-N");
            }
            cmd.arg(&target_arg)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());

            let mut child = cmd
                .spawn()
                .map_err(|e| format!("Failed to run smbutil: {}", e))?;

            let deadline = Instant::now() + Duration::from_secs(6);
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) => {
                        if Instant::now() >= deadline {
                            let _ = child.kill();
                            let _ = child.wait();
                            return Err(format!(
                                "Timed out connecting to {} (host may be unreachable or requires authentication)",
                                cleaned_host
                            ));
                        }
                        std::thread::sleep(Duration::from_millis(80));
                    }
                    Err(e) => return Err(format!("Failed waiting for smbutil: {}", e)),
                }
            }

            let output = child
                .wait_with_output()
                .map_err(|e| format!("Failed reading smbutil output: {}", e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                return Err(if stderr.is_empty() {
                    format!("Could not list shares on {} (check credentials or SMB access)", cleaned_host)
                } else {
                    stderr
                });
            }

            let stdout = String::from_utf8_lossy(&output.stdout);
            Ok(parse_smbutil_shares(&stdout))
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = (username, password);
            Err("SMB share browsing is supported on macOS only".to_string())
        }
    })
    .await
    .map_err(|e| format!("SMB browse task failed: {}", e))?
}

fn browse_mdns_service(service_type: &str, protocol: &str, wait_ms: u64) -> Vec<LanServer> {
    #[cfg(target_os = "macos")]
    {
        let Ok(mut child) = Command::new("/usr/bin/dns-sd")
            .args(["-B", service_type, "local."])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        else {
            return Vec::new();
        };

        std::thread::sleep(Duration::from_millis(wait_ms));
        let _ = child.kill();
        let Ok(output) = child.wait_with_output() else {
            return Vec::new();
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut servers = Vec::new();
        let mut seen = HashSet::new();

        for line in stdout.lines() {
            // Typical line:
            // ` 7:48:01.123  Add        2   6 local.               _smb._tcp.           MyNAS`
            if !line.contains("Add") || !line.contains(service_type) {
                continue;
            }
            if let Some(idx) = line.find(service_type) {
                let after = line[idx + service_type.len()..].trim_start_matches('.').trim();
                if after.is_empty() {
                    continue;
                }
                let key = after.to_lowercase();
                if seen.insert(key) {
                    let host_slug = after.replace(' ', "-");
                    let host = format!("{}.local", host_slug);
                    let scheme = if protocol == "AFP" { "afp" } else { "smb" };
                    servers.push(LanServer {
                        name: after.to_string(),
                        host: host.clone(),
                        address: format!("{}://{}", scheme, host),
                        protocol: protocol.to_string(),
                    });
                }
            }
        }
        servers
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (service_type, protocol, wait_ms);
        Vec::new()
    }
}

#[tauri::command]
pub async fn discover_lan_servers() -> Vec<LanServer> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut all = browse_mdns_service("_smb._tcp", "SMB", 1200);
        let afp = browse_mdns_service("_afpovertcp._tcp", "AFP", 600);
        let mut seen: HashSet<String> = all.iter().map(|s| s.name.to_lowercase()).collect();
        for server in afp {
            if seen.insert(server.name.to_lowercase()) {
                all.push(server);
            }
        }
        all.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        all
    })
    .await
    .unwrap_or_default()
}

// =========================== Direct ZIP Archive Browsing ===========================

fn clean_zip_inner_path(raw: &str) -> String {
    let replaced = raw.replace('\\', "/");
    let parts: Vec<&str> = replaced
        .split('/')
        .map(str::trim)
        .filter(|seg| !seg.is_empty() && *seg != ".")
        .collect();
    parts.join("/")
}

fn is_safe_zip_relative_path(inner: &str) -> bool {
    if inner.is_empty() {
        return true;
    }
    let path = Path::new(inner);
    for comp in path.components() {
        match comp {
            Component::Normal(_) => {}
            _ => return false,
        }
    }
    true
}

/// Parses a virtual path like `/path/to/archive.zip::internal/folder/path` (or a direct `.zip` file path).
fn parse_zip_virtual_path(raw: &str) -> Option<(PathBuf, String)> {
    let trimmed = raw.trim();
    if let Some((zip_part, inner_part)) = trimmed.split_once("::") {
        let zip_path = expand_path(zip_part);
        return Some((zip_path, clean_zip_inner_path(inner_part)));
    }

    let expanded = expand_path(trimmed);
    let is_zip_ext = expanded
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("zip"))
        .unwrap_or(false);

    if is_zip_ext && expanded.is_file() {
        return Some((expanded, String::new()));
    }

    None
}

fn zip_datetime_to_millis(dt: Option<zip::DateTime>) -> i64 {
    let Some(dt) = dt else {
        return 0;
    };
    let Some(date) = NaiveDate::from_ymd_opt(dt.year() as i32, dt.month() as u32, dt.day() as u32)
    else {
        return 0;
    };
    let Some(naive_dt) =
        date.and_hms_opt(dt.hour() as u32, dt.minute() as u32, dt.second() as u32)
    else {
        return 0;
    };
    DateTime::<Utc>::from_naive_utc_and_offset(naive_dt, Utc).timestamp_millis()
}

fn read_zip_dir_entries(
    zip_file_path: &Path,
    inner_dir: &str,
    show_hidden: bool,
) -> Result<Vec<FileEntry>, String> {
    if !zip_file_path.exists() {
        return Err(format!("ZIP archive does not exist: {}", zip_file_path.display()));
    }
    if !zip_file_path.is_file() {
        return Err(format!("Path is not a ZIP file: {}", zip_file_path.display()));
    }

    let file = File::open(zip_file_path)
        .map_err(|e| format!("Failed to open ZIP archive '{}': {}", zip_file_path.display(), e))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("Invalid or corrupted ZIP archive '{}': {}", zip_file_path.display(), e))?;

    let normalized_prefix = clean_zip_inner_path(inner_dir);
    let prefix_with_slash = if normalized_prefix.is_empty() {
        String::new()
    } else {
        format!("{}/", normalized_prefix)
    };
    let zip_path_str = path_to_string(zip_file_path);

    let mut direct_dirs: HashMap<String, FileEntry> = HashMap::new();
    let mut direct_files: HashMap<String, FileEntry> = HashMap::new();

    for i in 0..archive.len() {
        let Ok(entry) = archive.by_index_raw(i) else {
            continue;
        };

        let raw_name = entry.name().replace('\\', "/");
        let is_dir_entry = raw_name.ends_with('/') || entry.is_dir();
        let cleaned_name = clean_zip_inner_path(&raw_name);
        if cleaned_name.is_empty() || !is_safe_zip_relative_path(&cleaned_name) {
            continue;
        }

        let rel = if prefix_with_slash.is_empty() {
            cleaned_name.as_str()
        } else if let Some(stripped) = cleaned_name.strip_prefix(&prefix_with_slash) {
            stripped
        } else {
            continue;
        };

        if rel.is_empty() {
            continue;
        }

        let modified_ms = zip_datetime_to_millis(entry.last_modified());

        if let Some((first_seg, _rest)) = rel.split_once('/') {
            // Implied or nested directory at the current level
            let child_inner = if normalized_prefix.is_empty() {
                first_seg.to_string()
            } else {
                format!("{}/{}", normalized_prefix, first_seg)
            };
            let is_hidden = first_seg.starts_with('.') || first_seg == "__MACOSX";
            let key = first_seg.to_lowercase();
            direct_dirs
                .entry(key)
                .and_modify(|existing| {
                    if modified_ms > existing.modified_timestamp {
                        existing.modified_timestamp = modified_ms;
                    }
                })
                .or_insert_with(|| FileEntry {
                    name: first_seg.to_string(),
                    path: format!("{}::{}", zip_path_str, child_inner),
                    is_dir: true,
                    size: 0,
                    modified_timestamp: modified_ms,
                    extension: String::new(),
                    is_hidden,
                });
        } else if is_dir_entry {
            let child_inner = if normalized_prefix.is_empty() {
                rel.to_string()
            } else {
                format!("{}/{}", normalized_prefix, rel)
            };
            let is_hidden = rel.starts_with('.') || rel == "__MACOSX";
            let key = rel.to_lowercase();
            direct_dirs
                .entry(key)
                .and_modify(|existing| {
                    if modified_ms > existing.modified_timestamp {
                        existing.modified_timestamp = modified_ms;
                    }
                })
                .or_insert_with(|| FileEntry {
                    name: rel.to_string(),
                    path: format!("{}::{}", zip_path_str, child_inner),
                    is_dir: true,
                    size: 0,
                    modified_timestamp: modified_ms,
                    extension: String::new(),
                    is_hidden,
                });
        } else {
            let child_inner = if normalized_prefix.is_empty() {
                rel.to_string()
            } else {
                format!("{}/{}", normalized_prefix, rel)
            };
            let extension = Path::new(rel)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            let is_hidden = rel.starts_with('.');
            direct_files.insert(
                rel.to_lowercase(),
                FileEntry {
                    name: rel.to_string(),
                    path: format!("{}::{}", zip_path_str, child_inner),
                    is_dir: false,
                    size: entry.size(),
                    modified_timestamp: modified_ms,
                    extension,
                    is_hidden,
                },
            );
        }
    }

    // If a name exists as both dir and file (rare malformed zip), prefer dir
    for key in direct_dirs.keys() {
        direct_files.remove(key);
    }

    let mut entries: Vec<FileEntry> = direct_dirs
        .into_values()
        .chain(direct_files.into_values())
        .filter(|e| show_hidden || !e.is_hidden)
        .collect();

    sort_entries(&mut entries);
    Ok(entries)
}

fn extract_zip_entry_sync(
    zip_path: &Path,
    raw_inner_path: &str,
    dest_dir: &Path,
) -> Result<Vec<FileEntry>, String> {
    if !zip_path.is_file() {
        return Err(format!("ZIP archive does not exist: {}", zip_path.display()));
    }
    if !dest_dir.exists() {
        fs::create_dir_all(dest_dir).map_err(|e| {
            format!(
                "Failed to create destination directory '{}': {}",
                dest_dir.display(),
                e
            )
        })?;
    }
    if !dest_dir.is_dir() {
        return Err(format!(
            "Destination is not a directory: {}",
            dest_dir.display()
        ));
    }

    let file = File::open(zip_path)
        .map_err(|e| format!("Failed to open ZIP archive '{}': {}", zip_path.display(), e))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("Invalid ZIP archive '{}': {}", zip_path.display(), e))?;

    let inner = clean_zip_inner_path(raw_inner_path);
    if !is_safe_zip_relative_path(&inner) {
        return Err("Invalid path inside ZIP archive".to_string());
    }

    // Case 1: Extract entire archive into dest_dir
    if inner.is_empty() {
        let mut top_level_created = HashSet::new();

        for i in 0..archive.len() {
            let mut entry = archive
                .by_index(i)
                .map_err(|e| format!("Failed to read ZIP entry: {}", e))?;
            let raw_name = entry.name().replace('\\', "/");
            let is_dir_entry = raw_name.ends_with('/') || entry.is_dir();
            let cleaned = clean_zip_inner_path(&raw_name);
            if cleaned.is_empty() || !is_safe_zip_relative_path(&cleaned) {
                continue;
            }
            // Skip macOS Finder metadata clutter
            if cleaned == "__MACOSX" || cleaned.starts_with("__MACOSX/") {
                continue;
            }

            let out_path = dest_dir.join(&cleaned);
            if let Some(first_seg) = cleaned.split('/').next() {
                top_level_created.insert(dest_dir.join(first_seg));
            }

            if is_dir_entry {
                fs::create_dir_all(&out_path).map_err(|e| {
                    format!("Failed to create directory '{}': {}", out_path.display(), e)
                })?;
            } else {
                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent).map_err(|e| {
                        format!("Failed to create directory '{}': {}", parent.display(), e)
                    })?;
                }
                let mut out_file = File::create(&out_path).map_err(|e| {
                    format!("Failed to create file '{}': {}", out_path.display(), e)
                })?;
                io::copy(&mut entry, &mut out_file).map_err(|e| {
                    format!("Failed to extract '{}': {}", cleaned, e)
                })?;
            }
        }

        let mut results = Vec::new();
        for p in top_level_created {
            if let Ok(fe) = build_file_entry(&p) {
                results.push(fe);
            }
        }
        sort_entries(&mut results);
        return Ok(results);
    }

    // Case 2: Check if `inner` is an exact file inside the archive
    let mut exact_file_idx: Option<usize> = None;
    let folder_prefix = format!("{}/", inner);
    let mut matching_folder_indices: Vec<(usize, String, bool)> = Vec::new();

    for i in 0..archive.len() {
        let Ok(entry) = archive.by_index_raw(i) else {
            continue;
        };
        let raw_name = entry.name().replace('\\', "/");
        let is_dir_entry = raw_name.ends_with('/') || entry.is_dir();
        let cleaned = clean_zip_inner_path(&raw_name);
        if cleaned.is_empty() || !is_safe_zip_relative_path(&cleaned) {
            continue;
        }

        if cleaned == inner && !is_dir_entry {
            exact_file_idx = Some(i);
            break;
        }

        if cleaned == inner && is_dir_entry {
            matching_folder_indices.push((i, String::new(), true));
        } else if let Some(rel) = cleaned.strip_prefix(&folder_prefix) {
            if !rel.is_empty() {
                matching_folder_indices.push((i, rel.to_string(), is_dir_entry));
            }
        }
    }

    if let Some(idx) = exact_file_idx {
        let mut entry = archive
            .by_index(idx)
            .map_err(|e| format!("Failed to read '{}' from ZIP: {}", inner, e))?;
        let file_name = Path::new(&inner)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .ok_or_else(|| format!("Invalid ZIP entry name: {}", inner))?;

        let target = resolve_unique_dest_path(dest_dir, &file_name, false);
        let mut out_file = File::create(&target)
            .map_err(|e| format!("Failed to create '{}': {}", target.display(), e))?;
        io::copy(&mut entry, &mut out_file)
            .map_err(|e| format!("Failed to extract '{}': {}", file_name, e))?;

        return Ok(vec![build_file_entry(&target)?]);
    }

    // Case 3: Extract folder subtree inside ZIP
    if !matching_folder_indices.is_empty() {
        let folder_name = Path::new(&inner)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .ok_or_else(|| format!("Invalid ZIP folder name: {}", inner))?;
        let target_root = resolve_unique_dest_path(dest_dir, &folder_name, true);
        fs::create_dir_all(&target_root).map_err(|e| {
            format!(
                "Failed to create folder '{}': {}",
                target_root.display(),
                e
            )
        })?;

        for (idx, rel, is_dir_entry) in matching_folder_indices {
            if rel.is_empty() {
                continue;
            }
            if !is_safe_zip_relative_path(&rel) {
                continue;
            }
            let out_path = target_root.join(&rel);
            if is_dir_entry {
                fs::create_dir_all(&out_path).map_err(|e| {
                    format!("Failed to create directory '{}': {}", out_path.display(), e)
                })?;
            } else {
                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent).map_err(|e| {
                        format!("Failed to create directory '{}': {}", parent.display(), e)
                    })?;
                }
                let mut entry = archive
                    .by_index(idx)
                    .map_err(|e| format!("Failed to read ZIP entry '{}': {}", rel, e))?;
                let mut out_file = File::create(&out_path).map_err(|e| {
                    format!("Failed to create file '{}': {}", out_path.display(), e)
                })?;
                io::copy(&mut entry, &mut out_file)
                    .map_err(|e| format!("Failed to extract '{}': {}", rel, e))?;
            }
        }

        return Ok(vec![build_file_entry(&target_root)?]);
    }

    Err(format!(
        "Entry '{}' was not found inside ZIP archive '{}'",
        inner,
        zip_path.display()
    ))
}

fn extract_zip_entry_to_temp_sync(zip_path: &Path, raw_inner_path: &str) -> Result<PathBuf, String> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let inner = clean_zip_inner_path(raw_inner_path);
    if inner.is_empty() || !is_safe_zip_relative_path(&inner) {
        return Err("Cannot open invalid ZIP entry".to_string());
    }

    let meta = fs::metadata(zip_path)
        .map_err(|e| format!("Failed to inspect ZIP '{}': {}", zip_path.display(), e))?;
    let mtime_secs = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut hasher = DefaultHasher::new();
    zip_path.to_string_lossy().hash(&mut hasher);
    inner.hash(&mut hasher);
    mtime_secs.hash(&mut hasher);
    let key_hash = hasher.finish();

    let file_name = Path::new(&inner)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| format!("Invalid ZIP file name: {}", inner))?;

    let preview_dir = std::env::temp_dir()
        .join("mxplore_zip_preview")
        .join(format!("{:016x}", key_hash));
    let target_file = preview_dir.join(&file_name);

    // Reuse cached extracted preview if already extracted for the same archive mtime
    if target_file.is_file() {
        return Ok(target_file);
    }

    fs::create_dir_all(&preview_dir).map_err(|e| {
        format!(
            "Failed to create temp directory '{}': {}",
            preview_dir.display(),
            e
        )
    })?;

    let file = File::open(zip_path)
        .map_err(|e| format!("Failed to open ZIP archive '{}': {}", zip_path.display(), e))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("Invalid ZIP archive '{}': {}", zip_path.display(), e))?;

    let mut target_idx: Option<usize> = None;
    for i in 0..archive.len() {
        let Ok(entry) = archive.by_index_raw(i) else {
            continue;
        };
        let raw_name = entry.name().replace('\\', "/");
        if raw_name.ends_with('/') || entry.is_dir() {
            continue;
        }
        if clean_zip_inner_path(&raw_name) == inner {
            target_idx = Some(i);
            break;
        }
    }

    let idx = target_idx
        .ok_or_else(|| format!("File '{}' not found in ZIP archive", inner))?;
    let mut entry = archive
        .by_index(idx)
        .map_err(|e| format!("Failed to decompress '{}': {}", file_name, e))?;

    let mut out_file = File::create(&target_file)
        .map_err(|e| format!("Failed to write temp preview '{}': {}", target_file.display(), e))?;
    io::copy(&mut entry, &mut out_file)
        .map_err(|e| format!("Failed to extract '{}': {}", file_name, e))?;

    Ok(target_file)
}

#[tauri::command]
pub async fn extract_zip_entry(
    zip_path: String,
    inner_path: String,
    dest_dir: String,
) -> Result<Vec<FileEntry>, String> {
    let zip_file = expand_path(&zip_path);
    let dest = expand_path(&dest_dir);
    tauri::async_runtime::spawn_blocking(move || extract_zip_entry_sync(&zip_file, &inner_path, &dest))
        .await
        .map_err(|e| format!("Extract task failed: {}", e))?
}

#[tauri::command]
pub async fn extract_zip_all(
    zip_path: String,
    dest_dir: Option<String>,
) -> Result<FileEntry, String> {
    let zip_file = expand_path(&zip_path);
    let custom_dest = dest_dir.map(|d| expand_path(&d));

    tauri::async_runtime::spawn_blocking(move || {
        if !zip_file.is_file() {
            return Err(format!("ZIP archive does not exist: {}", zip_file.display()));
        }

        let target_folder = if let Some(dest) = custom_dest {
            dest
        } else {
            let parent = zip_file
                .parent()
                .ok_or_else(|| format!("Cannot determine parent folder for {}", zip_file.display()))?;
            let stem = zip_file
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "Extracted".to_string());
            resolve_unique_dest_path(parent, &stem, true)
        };

        fs::create_dir_all(&target_folder).map_err(|e| {
            format!(
                "Failed to create extraction folder '{}': {}",
                target_folder.display(),
                e
            )
        })?;

        extract_zip_entry_sync(&zip_file, "", &target_folder)?;
        build_file_entry(&target_folder)
    })
    .await
    .map_err(|e| format!("Extract all task failed: {}", e))?
}

#[tauri::command]
pub async fn open_zip_entry(zip_path: String, inner_path: String) -> Result<String, String> {
    let zip_file = expand_path(&zip_path);
    tauri::async_runtime::spawn_blocking(move || {
        let temp_file = extract_zip_entry_to_temp_sync(&zip_file, &inner_path)?;
        open::that(&temp_file)
            .map_err(|e| format!("Failed to open '{}': {}", temp_file.display(), e))?;
        Ok(path_to_string(&temp_file))
    })
    .await
    .map_err(|e| format!("Open ZIP entry task failed: {}", e))?
}

/// Resolves dragged paths into real filesystem paths on disk.
/// If any path points inside a `.zip` virtual path, extracts it into a temp folder first
/// and sets `copy_only = true` so external apps receive real files safely.
pub fn resolve_paths_for_native_drag(paths: Vec<String>) -> Result<(Vec<String>, bool), String> {
    let mut resolved = Vec::with_capacity(paths.len());
    let mut copy_only = false;

    for raw in paths {
        if let Some((zip_file, inner_path)) = parse_zip_virtual_path(&raw) {
            if inner_path.is_empty() {
                // Dragging the .zip archive itself
                let s = path_to_string(&zip_file);
                if Path::new(&s).exists() {
                    resolved.push(s);
                }
                continue;
            }
            copy_only = true;
            // Try single-file preview extraction first; if it's a folder inside zip, extract subtree into temp
            match extract_zip_entry_to_temp_sync(&zip_file, &inner_path) {
                Ok(temp_file) => {
                    resolved.push(path_to_string(&temp_file));
                }
                Err(_) => {
                    let temp_root = std::env::temp_dir().join("mxplore_zip_drag");
                    let _ = fs::create_dir_all(&temp_root);
                    let extracted = extract_zip_entry_sync(&zip_file, &inner_path, &temp_root)?;
                    for entry in extracted {
                        resolved.push(entry.path);
                    }
                }
            }
            continue;
        }

        let expanded = expand_path(&raw);
        if path_occupied(&expanded) {
            resolved.push(path_to_string(&expanded));
        }
    }

    if resolved.is_empty() {
        return Err("No valid files to drag".to_string());
    }

    Ok((resolved, copy_only))
}

#[tauri::command]
pub async fn quicklook_zip_entry(zip_path: String, inner_path: String) -> Result<String, String> {
    let zip_file = expand_path(&zip_path);
    tauri::async_runtime::spawn_blocking(move || {
        let temp_file = extract_zip_entry_to_temp_sync(&zip_file, &inner_path)?;
        let temp_str = path_to_string(&temp_file);
        quicklook_item(temp_str.clone())?;
        Ok(temp_str)
    })
    .await
    .map_err(|e| format!("QuickLook ZIP entry task failed: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("macxplore_test_{}_{}", label, nanos));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn folders_always_sort_before_files_and_hidden_filter_works() {
        let root = make_temp_dir("sort_hidden");
        fs::create_dir(root.join("zeta_folder")).unwrap();
        fs::create_dir(root.join("Alpha_folder")).unwrap();
        fs::create_dir(root.join(".hidden_dir")).unwrap();
        fs::write(root.join("a_file.txt"), b"hello").unwrap();
        fs::write(root.join(".env"), b"SECRET=1").unwrap();

        let visible = read_dir_entries_sync(&path_to_string(&root), false).unwrap();
        let visible_names: Vec<&str> = visible.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(visible_names, vec!["Alpha_folder", "zeta_folder", "a_file.txt"]);
        assert!(visible[0].is_dir);
        assert!(visible[1].is_dir);
        assert!(!visible[2].is_dir);
        assert_eq!(visible[2].extension, "txt");
        assert_eq!(visible[2].size, 5);

        let all = read_dir_entries_sync(&path_to_string(&root), true).unwrap();
        assert_eq!(all.len(), 5);
        assert!(all[0].is_dir && all[1].is_dir && all[2].is_dir);
        assert!(!all[3].is_dir && !all[4].is_dir);

        let subfolders = get_subfolders_sync(&path_to_string(&root)).unwrap();
        let subfolder_names: Vec<&str> = subfolders.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(subfolder_names, vec!["Alpha_folder", "zeta_folder"]);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_and_move_auto_rename_on_collision() {
        let root = make_temp_dir("copy_move");
        let src_dir = root.join("src");
        let dst_dir = root.join("dst");
        fs::create_dir(&src_dir).unwrap();
        fs::create_dir(&dst_dir).unwrap();

        let src_file = src_dir.join("file.txt");
        fs::write(&src_file, b"content").unwrap();
        fs::write(dst_dir.join("file.txt"), b"existing").unwrap();

        let copied_1 = copy_items(vec![path_to_string(&src_file)], path_to_string(&dst_dir)).unwrap();
        assert_eq!(copied_1[0].name, "file - Copy.txt");

        let copied_2 = copy_items(vec![path_to_string(&src_file)], path_to_string(&dst_dir)).unwrap();
        assert_eq!(copied_2[0].name, "file - Copy (2).txt");

        let moved = move_items(vec![path_to_string(&src_file)], path_to_string(&dst_dir)).unwrap();
        assert_eq!(moved[0].name, "file - Copy (3).txt");
        assert!(!src_file.exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn create_and_rename_items() {
        let root = make_temp_dir("create_rename");
        let dir_path = root.join("New Folder");
        let file_path = root.join("notes.md");

        let created_dir = create_directory(path_to_string(&dir_path)).unwrap();
        assert!(created_dir.is_dir);
        assert_eq!(created_dir.name, "New Folder");

        let created_file = create_empty_file(path_to_string(&file_path)).unwrap();
        assert!(!created_file.is_dir);
        assert_eq!(created_file.extension, "md");

        let renamed_path = root.join("README.md");
        let renamed = rename_item(path_to_string(&file_path), path_to_string(&renamed_path)).unwrap();
        assert_eq!(renamed.name, "README.md");
        assert!(!file_path.exists());
        assert!(renamed_path.exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn restore_paths_undoes_move_to_exact_original_name() {
        let root = make_temp_dir("restore_paths");
        let dir_a = root.join("dir_a");
        let dir_b = root.join("dir_b");
        fs::create_dir(&dir_a).unwrap();
        fs::create_dir(&dir_b).unwrap();

        let original = dir_a.join("report.txt");
        fs::write(&original, b"hello").unwrap();
        // Existing colliding file in dir_b forces auto-rename on move
        fs::write(dir_b.join("report.txt"), b"other").unwrap();

        let moved = move_items(vec![path_to_string(&original)], path_to_string(&dir_b)).unwrap();
        assert_eq!(moved[0].name, "report - Copy.txt");
        assert!(!original.exists());

        // Undo move via restore_paths brings back exact original filename
        let restored = restore_paths(vec![PathPair {
            from_path: moved[0].path.clone(),
            to_path: path_to_string(&original),
        }])
        .unwrap();
        assert_eq!(restored[0].path, path_to_string(&original));
        assert!(original.exists());
        assert!(!Path::new(&moved[0].path).exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn folder_stats_computes_nested_size_and_counts() {
        let root = make_temp_dir("folder_stats");
        let sub = root.join("sub");
        let nested = sub.join("nested");
        fs::create_dir_all(&nested).unwrap();
        fs::write(root.join("a.bin"), vec![0u8; 100]).unwrap();
        fs::write(sub.join("b.bin"), vec![0u8; 250]).unwrap();
        fs::write(nested.join("c.bin"), vec![0u8; 50]).unwrap();

        let stats = compute_folder_stats_sync(&root).unwrap();
        assert_eq!(stats.total_size, 400);
        assert_eq!(stats.file_count, 3);
        assert_eq!(stats.folder_count, 2);
        assert!(!stats.truncated);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn parses_macos_mount_output_for_lan_drives_and_strips_passwords() {
        let sample = "\
/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)
//alice:supersecret@192.168.1.50/Shared%20Media on /Volumes/Shared Media (smbfs, nodev, nosuid, mounted by alice)
192.168.1.60:/srv/backups on /Volumes/backups (nfs, nodev, nosuid, mounted by alice)
afp_abc123@nas.local/TimeMachine on /Volumes/TimeMachine (afpfs, nodev, nosuid, mounted by alice)
";
        let drives = parse_mount_output(sample);
        assert_eq!(drives.len(), 3);

        let smb = drives.iter().find(|d| d.name == "Shared Media").unwrap();
        assert_eq!(smb.protocol, "SMB");
        assert_eq!(smb.host, "192.168.1.50");
        assert_eq!(smb.path, "/Volumes/Shared Media");
        assert!(!smb.remote_url.contains("supersecret"));
        assert_eq!(smb.remote_url, "smb://alice@192.168.1.50/Shared%20Media");

        let nfs = drives.iter().find(|d| d.name == "backups").unwrap();
        assert_eq!(nfs.protocol, "NFS");
        assert_eq!(nfs.host, "192.168.1.60");

        let afp = drives.iter().find(|d| d.name == "TimeMachine").unwrap();
        assert_eq!(afp.protocol, "AFP");
        assert_eq!(afp.host, "nas.local");
    }

    #[test]
    fn normalizes_windows_unc_and_smb_urls() {
        let (conn, disp) = normalize_network_url(
            r"\\192.168.1.10\Team Docs",
            "smb",
            Some("admin"),
            Some("p@ss word"),
        )
        .unwrap();
        assert_eq!(disp, "smb://admin@192.168.1.10/Team%20Docs");
        assert_eq!(conn, "smb://admin:p%40ss%20word@192.168.1.10/Team%20Docs");

        let (conn2, disp2) = normalize_network_url("192.168.1.25/Media", "smb", None, None).unwrap();
        assert_eq!(conn2, "smb://192.168.1.25/Media");
        assert_eq!(disp2, "smb://192.168.1.25/Media");
    }

    #[test]
    fn browses_and_extracts_zip_archive_entries_directly() {
        use std::io::Write;
        use zip::write::SimpleFileOptions;
        use zip::ZipWriter;

        let root = make_temp_dir("zip_browse");
        let zip_path = root.join("sample.zip");
        {
            let file = File::create(&zip_path).unwrap();
            let mut writer = ZipWriter::new(file);
            let options = SimpleFileOptions::default();

            writer.start_file("readme.txt", options).unwrap();
            writer.write_all(b"hello root").unwrap();

            writer.start_file("docs/guide.md", options).unwrap();
            writer.write_all(b"# Guide").unwrap();

            writer.start_file("docs/nested/spec.txt", options).unwrap();
            writer.write_all(b"nested spec").unwrap();

            writer.start_file("__MACOSX/._readme.txt", options).unwrap();
            writer.write_all(b"meta").unwrap();

            writer.finish().unwrap();
        }

        // Root listing via virtual path (folders first, __MACOSX hidden by default)
        let root_virtual = format!("{}::", path_to_string(&zip_path));
        let root_entries = read_dir_entries_sync(&root_virtual, false).unwrap();
        let names: Vec<&str> = root_entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["docs", "readme.txt"]);
        assert!(root_entries[0].is_dir);
        assert_eq!(root_entries[0].path, format!("{}::docs", path_to_string(&zip_path)));
        assert!(!root_entries[1].is_dir);
        assert_eq!(root_entries[1].size, 10);

        // Nested subfolder listing
        let docs_entries = read_dir_entries_sync(&root_entries[0].path, false).unwrap();
        let docs_names: Vec<&str> = docs_entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(docs_names, vec!["nested", "guide.md"]);
        assert!(docs_entries[0].is_dir);
        assert!(!docs_entries[1].is_dir);

        // Extract single file & folder out to a real destination directory
        let out_dir = root.join("out");
        fs::create_dir(&out_dir).unwrap();

        let extracted_file = extract_zip_entry_sync(&zip_path, "docs/guide.md", &out_dir).unwrap();
        assert_eq!(extracted_file.len(), 1);
        assert_eq!(extracted_file[0].name, "guide.md");
        assert_eq!(fs::read_to_string(&extracted_file[0].path).unwrap(), "# Guide");

        let extracted_dir = extract_zip_entry_sync(&zip_path, "docs", &out_dir).unwrap();
        assert_eq!(extracted_dir.len(), 1);
        assert!(extracted_dir[0].is_dir);
        assert_eq!(
            fs::read_to_string(out_dir.join("docs/nested/spec.txt")).unwrap(),
            "nested spec"
        );

        // Temp preview extraction preserves filename and contents
        let temp_file = extract_zip_entry_to_temp_sync(&zip_path, "readme.txt").unwrap();
        assert_eq!(temp_file.file_name().unwrap(), "readme.txt");
        assert_eq!(fs::read_to_string(&temp_file).unwrap(), "hello root");

        let _ = fs::remove_dir_all(&root);
    }
}
