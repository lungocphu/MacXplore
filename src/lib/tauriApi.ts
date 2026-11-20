import { invoke } from "@tauri-apps/api/core";

/**
 * Represents a single file or directory returned by the Rust filesystem backend.
 */
export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  /** Last modified time as Unix timestamp in milliseconds (UTC). */
  modified_timestamp: number;
  /** Lowercase file extension without leading dot, or empty string for directories/extensionless files. */
  extension: string;
  /** True if the entry is hidden (leading dot or macOS UF_HIDDEN flag). */
  is_hidden: boolean;
}

/**
 * Represents a cloud storage mount detected under ~/Library/CloudStorage (or iCloud Drive).
 */
export interface CloudDrive {
  name: string;
  path: string;
  provider: string;
}

/**
 * Represents a mounted LAN network drive (SMB, AFP, NFS, WebDAV, etc.).
 */
export interface NetworkDrive {
  name: string;
  path: string;
  protocol: string;
  remote_url: string;
  host: string;
}

/**
 * Represents a LAN server discovered via macOS Bonjour / mDNS.
 */
export interface LanServer {
  name: string;
  host: string;
  address: string;
  protocol: string;
}

/**
 * Represents a shared folder discovered on an SMB server.
 */
export interface NetworkShareInfo {
  name: string;
  share_type: string;
  comment: string;
}

export interface ConnectNetworkResult {
  status: "mounted" | "already_mounted" | "prompted" | string;
  url: string;
  mounted_drive: NetworkDrive | null;
}

/**
 * Well-known macOS user directories, mounted cloud drives, and LAN network drives.
 */
export interface SpecialPaths {
  home: string | null;
  inbox: string | null;
  desktop: string | null;
  documents: string | null;
  downloads: string | null;
  pictures: string | null;
  music: string | null;
  videos: string | null;
  applications: string | null;
  cloud_drives: CloudDrive[];
  network_drives: NetworkDrive[];
}

export interface TrashedItem {
  original_path: string;
  trashed_path: string | null;
}

export interface PathPair {
  from_path: string;
  to_path: string;
}

export interface FolderStats {
  path: string;
  total_size: number;
  file_count: number;
  folder_count: number;
  truncated: boolean;
}

/**
 * Reads all entries in the specified directory.
 * Folders are always sorted before files, alphabetically (case-insensitive).
 */
export async function readDirEntries(
  path: string,
  showHidden = false
): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("read_dir_entries", { path, showHidden });
}

/**
 * Returns only direct subdirectories of the specified path (used for the Sidebar Tree View).
 */
export async function getSubfolders(path: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("get_subfolders", { path });
}

/**
 * Returns standard user directories (Home, Desktop, Documents, Downloads, etc.)
 * along with Cloud Drives discovered in ~/Library/CloudStorage.
 */
export async function getSpecialPaths(): Promise<SpecialPaths> {
  return invoke<SpecialPaths>("get_special_paths");
}

/**
 * Creates a new directory at the given path and returns its FileEntry metadata.
 */
export async function createDirectory(path: string): Promise<FileEntry> {
  return invoke<FileEntry>("create_directory", { path });
}

/**
 * Creates a new empty file at the given path and returns its FileEntry metadata.
 */
export async function createEmptyFile(path: string): Promise<FileEntry> {
  return invoke<FileEntry>("create_empty_file", { path });
}

/**
 * Renames or moves an item from `oldPath` to `newPath` and returns the updated FileEntry.
 */
export async function renameItem(
  oldPath: string,
  newPath: string
): Promise<FileEntry> {
  return invoke<FileEntry>("rename_item", { oldPath, newPath });
}

/**
 * Moves one or more files/directories into the macOS Trash and returns their trashed locations for Undo.
 */
export async function deleteItems(paths: string[]): Promise<TrashedItem[]> {
  return invoke<TrashedItem[]>("delete_items", { paths });
}

/**
 * Restores or moves items from exact source paths back to exact target paths (used for Undo/Redo).
 */
export async function restorePaths(pairs: PathPair[]): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("restore_paths", { pairs });
}

/**
 * Copies files and/or directories into `destDir`, automatically renaming on collision
 * (e.g. `file - Copy.txt`, `file - Copy (2).txt`).
 */
export async function copyItems(
  sources: string[],
  destDir: string
): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("copy_items", { sources, destDir });
}

/**
 * Moves files and/or directories into `destDir`, automatically renaming on collision
 * and falling back to copy+delete across different filesystems.
 */
export async function moveItems(
  sources: string[],
  destDir: string
): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("move_items", { sources, destDir });
}

/**
 * Opens a file or folder with the default macOS application.
 */
export async function openItem(path: string): Promise<void> {
  return invoke<void>("open_item", { path });
}

/**
 * Opens macOS QuickLook preview (qlmanage -p) for the specified path.
 */
export async function quicklookItem(path: string): Promise<void> {
  return invoke<void>("quicklook_item", { path });
}

/**
 * Opens macOS Finder and highlights the specified file or folder (open -R).
 */
export async function revealInFinder(path: string): Promise<void> {
  return invoke<void>("reveal_in_finder", { path });
}

/**
 * Opens macOS Terminal at the specified directory (open -a Terminal).
 */
export async function openInTerminal(path: string): Promise<void> {
  return invoke<void>("open_in_terminal", { path });
}

/**
 * Runs an instant macOS Spotlight search (mdfind -onlyin <dir> -name <query>).
 */
export async function spotlightSearch(
  dir: string,
  query: string,
  showHidden = false
): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("spotlight_search", { dir, query, showHidden });
}

/**
 * Calculates total recursive size and item counts for a directory (bounded for speed).
 */
export async function getFolderStats(path: string): Promise<FolderStats> {
  return invoke<FolderStats>("get_folder_stats", { path });
}

/**
 * Returns a base64 data URI thumbnail for an image file (using native macOS sips for large/HEIC images).
 */
export async function getImageThumbnail(
  path: string,
  maxSize = 240
): Promise<string> {
  return invoke<string>("get_image_thumbnail", { path, maxSize });
}

/**
 * Scans currently mounted LAN network drives (SMB, AFP, NFS, WebDAV, etc.).
 */
export async function getNetworkDrives(): Promise<NetworkDrive[]> {
  return invoke<NetworkDrive[]>("get_network_drives");
}

/**
 * Connects/mounts a LAN network share (supports Windows UNC `\\IP\Share` and `smb://`, `afp://`, `nfs://`).
 */
export async function connectNetworkDrive(
  address: string,
  options?: {
    protocol?: string;
    username?: string;
    password?: string;
  }
): Promise<ConnectNetworkResult> {
  return invoke<ConnectNetworkResult>("connect_network_drive", {
    address,
    protocol: options?.protocol ?? null,
    username: options?.username ?? null,
    password: options?.password ?? null,
  });
}

/**
 * Unmounts / ejects a mounted LAN network drive safely.
 */
export async function disconnectNetworkDrive(mountPath: string): Promise<void> {
  return invoke<void>("disconnect_network_drive", { mountPath });
}

/**
 * Lists shared folders (Disk shares) available on an SMB LAN host.
 */
export async function listSmbShares(
  host: string,
  options?: {
    username?: string;
    password?: string;
  }
): Promise<NetworkShareInfo[]> {
  return invoke<NetworkShareInfo[]>("list_smb_shares", {
    host,
    username: options?.username ?? null,
    password: options?.password ?? null,
  });
}

/**
 * Discovers SMB/AFP servers advertising on the local LAN via macOS Bonjour/mDNS.
 */
export async function discoverLanServers(): Promise<LanServer[]> {
  return invoke<LanServer[]>("discover_lan_servers");
}

/**
 * Extracts a specific file or folder (or the entire archive if `innerPath` is empty) from a `.zip` file into `destDir`.
 */
export async function extractZipEntry(
  zipPath: string,
  innerPath: string,
  destDir: string
): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("extract_zip_entry", {
    zipPath,
    innerPath,
    destDir,
  });
}

/**
 * Extracts an entire `.zip` archive into a sibling folder with the same name (or `destDir` if provided).
 */
export async function extractZipAll(
  zipPath: string,
  destDir?: string
): Promise<FileEntry> {
  return invoke<FileEntry>("extract_zip_all", {
    zipPath,
    destDir: destDir ?? null,
  });
}

/**
 * Extracts a single file from a `.zip` archive to temp storage and opens it with the default macOS app.
 */
export async function openZipEntry(
  zipPath: string,
  innerPath: string
): Promise<string> {
  return invoke<string>("open_zip_entry", { zipPath, innerPath });
}

/**
 * Extracts a single file from a `.zip` archive to temp storage and opens macOS QuickLook preview.
 */
export async function quicklookZipEntry(
  zipPath: string,
  innerPath: string
): Promise<string> {
  return invoke<string>("quicklook_zip_entry", { zipPath, innerPath });
}

/**
 * Ensures the Inbox (unsorted data) directory exists on disk and returns its absolute path.
 */
export async function getOrCreateInboxDir(
  customPath?: string
): Promise<string> {
  return invoke<string>("get_or_create_inbox_dir", {
    customPath: customPath ?? null,
  });
}

/**
 * Creates a timestamped Markdown quick note inside the specified directory.
 */
export async function createQuickNote(
  dir: string,
  title: string | null,
  content: string
): Promise<FileEntry> {
  return invoke<FileEntry>("create_quick_note", { dir, title, content });
}

/**
 * Toggles whether the floating Quick Cabinet window stays visible when losing focus.
 */
export async function setCabinetPinned(pinned: boolean): Promise<void> {
  return invoke<void>("set_cabinet_pinned", { pinned });
}

/**
 * Hides the floating Quick Cabinet window.
 */
export async function hideCabinet(): Promise<void> {
  return invoke<void>("hide_cabinet");
}

/**
 * Brings the main MXplore window to the front and navigates it to `path`.
 */
export async function openPathInMain(path: string): Promise<void> {
  return invoke<void>("open_path_in_main", { path });
}

/**
 * Broadcasts a sync event so Main MXplore and Quick Cabinet refresh shared pins/Inbox settings.
 */
export async function notifyCabinetSync(): Promise<void> {
  return invoke<void>("notify_cabinet_sync");
}

export interface DragPointerState {
  x: number;
  y: number;
  inside: boolean;
  option_down: boolean;
}

/**
 * Returns true if the macOS Option (Alt) modifier key is currently held down.
 */
export async function isOptionKeyDown(): Promise<boolean> {
  return invoke<boolean>("is_option_key_down");
}

/**
 * Returns the exact live cursor position in CSS logical pixels inside the current webview
 * along with the macOS Option key state, eliminating Retina/Y-flip drag coordinate mismatch.
 */
export async function getDragPointerState(): Promise<DragPointerState | null> {
  return invoke<DragPointerState | null>("get_drag_pointer_state");
}

/**
 * Initiates a native macOS Finder-style NSDraggingSession for the given file/folder paths,
 * allowing dragging out to any macOS app (Chrome, Slack, Mail, Finder, Desktop, etc.)
 * as well as internal drag-and-drop across panes, folders, sidebar, tabs, and breadcrumbs.
 */
export async function startNativeDrag(paths: string[]): Promise<void> {
  return invoke<void>("start_native_drag", { paths });
}

export const tauriApi = {
  readDirEntries,
  getSubfolders,
  getSpecialPaths,
  getOrCreateInboxDir,
  createQuickNote,
  createDirectory,
  createEmptyFile,
  renameItem,
  deleteItems,
  restorePaths,
  copyItems,
  moveItems,
  openItem,
  quicklookItem,
  revealInFinder,
  openInTerminal,
  spotlightSearch,
  getFolderStats,
  getImageThumbnail,
  getNetworkDrives,
  connectNetworkDrive,
  disconnectNetworkDrive,
  listSmbShares,
  discoverLanServers,
  extractZipEntry,
  extractZipAll,
  openZipEntry,
  quicklookZipEntry,
  setCabinetPinned,
  hideCabinet,
  openPathInMain,
  notifyCabinetSync,
  isOptionKeyDown,
  getDragPointerState,
  startNativeDrag,
};
