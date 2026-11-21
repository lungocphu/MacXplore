import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import {
  tauriApi,
  type ConnectNetworkResult,
  type DownloadCompletedEvent,
  type FileEntry,
  type MacOsIntegrationStatus,
  type NetworkDrive,
  type RevealTarget,
  type SpecialPaths,
} from "../lib/tauriApi";
import {
  generateUniqueName,
  getParentPath,
  getPathTitle,
  getVisibleEntries,
  isZipFileEntry,
  isZipVirtualPath,
  joinPath,
  normalizePath,
  splitZipVirtualPath,
} from "../lib/format";

export type ViewMode = "details" | "list" | "medium-icons" | "large-icons";
export type PaneId = "left" | "right";
export type ClipboardAction = "copy" | "cut" | null;
export type SortField = "name" | "modified" | "type" | "size";
export type SortDirection = "asc" | "desc";
export type TransferMode = "copy" | "move";

export interface TabItem {
  id: string;
  title: string;
  currentPath: string;
  history: string[];
  historyIndex: number;
  selectedPaths: string[];
}

export interface PaneState {
  currentPath: string;
  history: string[];
  historyIndex: number;
  selectedPaths: string[];
  lastSelectedPath: string | null;
  entries: FileEntry[];
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  spotlightActive: boolean;
  spotlightQuery: string;
  spotlightScopeDir: string;
  spotlightResults: FileEntry[];
  isSearching: boolean;
}

export interface ResolvedPaneState extends PaneState {
  paneId: PaneId;
  title: string;
  tabId?: string;
}

export interface ClipboardState {
  paths: string[];
  action: ClipboardAction;
}

export interface ContextMenuState {
  x: number;
  y: number;
  targetEntry: FileEntry | null;
  paneId: PaneId;
}

export interface DestinationModalState {
  mode: TransferMode;
  sourcePaths: string[];
}

export interface ToastState {
  text: string;
  type: "info" | "error";
  canUndo?: boolean;
}

export type UndoRecord =
  | {
      kind: "rename";
      label: string;
      oldPath: string;
      newPath: string;
    }
  | {
      kind: "move";
      label: string;
      pairs: Array<{ fromPath: string; toPath: string }>;
    }
  | {
      kind: "copy";
      label: string;
      sourcePaths: string[];
      destDir: string;
      createdPaths: string[];
    }
  | {
      kind: "create_dir";
      label: string;
      path: string;
    }
  | {
      kind: "create_file";
      label: string;
      path: string;
    }
  | {
      kind: "delete";
      label: string;
      items: Array<{ originalPath: string; trashedPath: string | null }>;
    };

const RECENT_DESTINATIONS_STORAGE_KEY = "macxplore.recentDestinations";
const RECENT_LAN_SERVERS_STORAGE_KEY = "macxplore.recentLanAddresses";
const VIEW_MODE_STORAGE_KEY = "macxplore.viewMode";
const SHOW_CHECKBOXES_STORAGE_KEY = "macxplore.showCheckboxes";
const DUAL_PANE_SPLIT_STORAGE_KEY = "macxplore.dualPaneSplitRatio";
const DOWNLOAD_NOTIFICATIONS_STORAGE_KEY = "macxplore.downloadNotifications";
const MAX_RECENT_DESTINATIONS = 5;
const MAX_RECENT_LAN_ADDRESSES = 8;
const MAX_UNDO_HISTORY = 50;

const VALID_VIEW_MODES: ReadonlySet<ViewMode> = new Set([
  "details",
  "list",
  "medium-icons",
  "large-icons",
]);

function loadRecentDestinations(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_DESTINATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0
        )
        .slice(0, MAX_RECENT_DESTINATIONS);
    }
  } catch {
    // Ignore storage read failures
  }
  return [];
}

function saveRecentDestinations(paths: string[]) {
  try {
    window.localStorage.setItem(
      RECENT_DESTINATIONS_STORAGE_KEY,
      JSON.stringify(paths.slice(0, MAX_RECENT_DESTINATIONS))
    );
  } catch {
    // Ignore storage write failures
  }
}

function loadRecentLanAddresses(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_LAN_SERVERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0
        )
        .slice(0, MAX_RECENT_LAN_ADDRESSES);
    }
  } catch {
    // Ignore storage read failures
  }
  return [];
}

function saveRecentLanAddresses(addresses: string[]) {
  try {
    window.localStorage.setItem(
      RECENT_LAN_SERVERS_STORAGE_KEY,
      JSON.stringify(addresses.slice(0, MAX_RECENT_LAN_ADDRESSES))
    );
  } catch {
    // Ignore storage write failures
  }
}

export function isNetworkAddressInput(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("\\\\")) return true;
  return /^(smb|cifs|afp|nfs|dav|davs|ftp):\/\//i.test(trimmed);
}

export function findNetworkDriveForPath(
  path: string,
  drives: NetworkDrive[]
): NetworkDrive | null {
  if (!path || drives.length === 0) return null;
  for (const drive of drives) {
    if (path === drive.path || path.startsWith(`${drive.path}/`)) {
      return drive;
    }
  }
  return null;
}

function loadViewMode(): ViewMode {
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (raw && VALID_VIEW_MODES.has(raw as ViewMode)) {
      return raw as ViewMode;
    }
  } catch {
    // Ignore storage read failures
  }
  return "details";
}

function saveViewMode(mode: ViewMode) {
  try {
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage write failures
  }
}

function loadShowCheckboxes(): boolean {
  try {
    return window.localStorage.getItem(SHOW_CHECKBOXES_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function saveShowCheckboxes(show: boolean) {
  try {
    window.localStorage.setItem(
      SHOW_CHECKBOXES_STORAGE_KEY,
      show ? "true" : "false"
    );
  } catch {
    // Ignore storage write failures
  }
}

function loadSplitRatio(): number {
  try {
    const raw = Number(window.localStorage.getItem(DUAL_PANE_SPLIT_STORAGE_KEY));
    if (Number.isFinite(raw) && raw >= 0.22 && raw <= 0.78) {
      return raw;
    }
  } catch {
    // Ignore storage read failures
  }
  return 0.5;
}

function saveSplitRatio(ratio: number) {
  try {
    window.localStorage.setItem(DUAL_PANE_SPLIT_STORAGE_KEY, String(ratio));
  } catch {
    // Ignore storage write failures
  }
}

function loadDownloadNotificationsEnabled(): boolean {
  try {
    const raw = window.localStorage.getItem(DOWNLOAD_NOTIFICATIONS_STORAGE_KEY);
    return raw === null ? true : raw !== "false";
  } catch {
    return true;
  }
}

function saveDownloadNotificationsEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(
      DOWNLOAD_NOTIFICATIONS_STORAGE_KEY,
      enabled ? "true" : "false"
    );
  } catch {
    // Ignore storage write failures
  }
}

function createEmptyPaneState(initialPath = ""): PaneState {
  const normalized = initialPath ? normalizePath(initialPath) : "";
  return {
    currentPath: normalized,
    history: normalized ? [normalized] : [],
    historyIndex: normalized ? 0 : -1,
    selectedPaths: [],
    lastSelectedPath: null,
    entries: [],
    isLoading: false,
    error: null,
    searchQuery: "",
    spotlightActive: false,
    spotlightQuery: "",
    spotlightScopeDir: "",
    spotlightResults: [],
    isSearching: false,
  };
}

export interface ExplorerStore {
  tabs: TabItem[];
  activeTabId: string;
  clipboard: ClipboardState;
  viewMode: ViewMode;
  showHidden: boolean;
  showCheckboxes: boolean;

  // Dual Pane state
  dualPane: boolean;
  activePane: PaneId;
  dualPaneSplitRatio: number;
  rightPane: PaneState;

  // Directory contents & primary (left) pane UI state
  specialPaths: SpecialPaths | null;
  entries: FileEntry[];
  entriesByPath: Record<string, FileEntry[]>;
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  sortField: SortField;
  sortDirection: SortDirection;
  lastSelectedPath: string | null;

  // Inline rename, Context Menu, Destination Modal, Recent Destinations, Toast
  renamingPath: string | null;
  renamingPaneId: PaneId | null;
  contextMenu: ContextMenuState | null;
  destinationModal: DestinationModalState | null;
  recentDestinations: string[];
  toast: ToastState | null;

  // LAN Network Drives state
  networkDrives: NetworkDrive[];
  isLoadingNetworkDrives: boolean;
  networkModalOpen: boolean;
  networkModalInitialAddress: string;
  recentLanAddresses: string[];

  // ZIP archive extraction state
  isExtractingZip: boolean;

  // Native Drag & Drop visual state
  draggingPaths: string[];
  dropTargetFolder: string | null;
  dropCopyMode: boolean;

  // macOS "Show in MXplore" Integration & Downloads Watcher state
  integrationModalOpen: boolean;
  macosIntegrationStatus: MacOsIntegrationStatus | null;
  downloadNotificationsEnabled: boolean;
  recentDownloadNotice: DownloadCompletedEvent | null;

  // Phase 4: macOS Spotlight search state (primary / left pane)
  spotlightActive: boolean;
  spotlightQuery: string;
  spotlightScopeDir: string;
  spotlightResults: FileEntry[];
  isSearching: boolean;

  // Undo / Redo history
  undoStack: UndoRecord[];
  redoStack: UndoRecord[];
  isUndoing: boolean;

  // Initialization & data fetching
  initExplorer: () => Promise<void>;
  loadDirectory: (
    path: string,
    targetTabId?: string,
    paneId?: PaneId
  ) => Promise<void>;
  refresh: (paneId?: PaneId) => Promise<void>;
  refreshAllPanes: () => Promise<void>;
  refreshPathIfOpen: (path: string) => Promise<void>;

  // Dual Pane actions
  toggleDualPane: () => void;
  setDualPane: (enabled: boolean) => void;
  setActivePane: (paneId: PaneId) => void;
  setDualPaneSplitRatio: (ratio: number) => void;

  // Tab actions
  addTab: (initialPath?: string) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;

  // Navigation actions
  navigateTo: (path: string, paneId?: PaneId) => void;
  goBack: (paneId?: PaneId) => void;
  goForward: (paneId?: PaneId) => void;
  goUp: (paneId?: PaneId) => void;

  // Selection actions
  setSelectedPaths: (
    paths: string[],
    anchorPath?: string | null,
    paneId?: PaneId
  ) => void;
  toggleSelectPath: (path: string, paneId?: PaneId) => void;
  selectAll: (paneId?: PaneId) => void;
  toggleSelectAll: (paneId?: PaneId) => void;
  clearSelection: (paneId?: PaneId) => void;

  // File operation actions
  openEntry: (entry: FileEntry, paneId?: PaneId) => Promise<void>;
  openSelected: (paneId?: PaneId) => Promise<void>;
  copySelected: () => void;
  cutSelected: () => void;
  pasteClipboard: () => Promise<void>;
  deleteSelected: () => Promise<void>;
  startRenaming: (path?: string, paneId?: PaneId) => void;
  cancelRenaming: () => void;
  commitRename: (oldPath: string, newName: string) => Promise<void>;
  createNewFolder: () => Promise<void>;
  createNewFile: (baseName: string, extension: string) => Promise<void>;
  copyPathToClipboard: (paths?: string[]) => Promise<void>;

  // Copy To / Move To actions
  openDestinationModal: (mode: TransferMode, sourcePaths?: string[]) => void;
  closeDestinationModal: () => void;
  addRecentDestination: (path: string) => void;
  copyOrMoveToDestination: (
    mode: TransferMode,
    sourcePaths: string[],
    destDir: string
  ) => Promise<boolean>;

  // ZIP archive actions
  extractZipAll: (zipPath?: string, destDir?: string) => Promise<void>;

  // Native Drag & Drop actions
  setDraggingPaths: (paths: string[]) => void;
  setDropTargetFolder: (path: string | null, copyMode?: boolean) => void;
  clearDragState: () => void;
  beginNativeFileDrag: (paths: string[]) => Promise<void>;

  // LAN Network Drive actions
  refreshNetworkDrives: () => Promise<NetworkDrive[]>;
  openNetworkModal: (initialAddress?: string) => void;
  closeNetworkModal: () => void;
  addRecentLanAddress: (address: string) => void;
  removeRecentLanAddress: (address: string) => void;
  connectToLanDrive: (
    address: string,
    options?: { protocol?: string; username?: string; password?: string }
  ) => Promise<ConnectNetworkResult | null>;
  disconnectLanDrive: (mountPath: string) => Promise<boolean>;

  // Phase 4: macOS native integrations
  quicklookSelected: (path?: string) => Promise<void>;
  revealInFinder: (path?: string) => Promise<void>;
  openInTerminal: (path?: string) => Promise<void>;
  runSpotlightSearch: (query?: string, paneId?: PaneId) => Promise<void>;
  clearSpotlightSearch: (paneId?: PaneId) => void;

  // macOS "Show in MXplore" Integration & Reveal actions
  openIntegrationModal: () => void;
  closeIntegrationModal: () => void;
  refreshMacosIntegrationStatus: () => Promise<MacOsIntegrationStatus | null>;
  setMacosIntegrationStatus: (status: MacOsIntegrationStatus) => void;
  setDownloadNotificationsEnabled: (enabled: boolean) => void;
  setRecentDownloadNotice: (notice: DownloadCompletedEvent | null) => void;
  revealTargetInPane: (target: RevealTarget, paneId?: PaneId) => Promise<void>;
  revealPath: (
    rawPath: string,
    preferSelectDir?: boolean,
    paneId?: PaneId
  ) => Promise<void>;

  // Undo / Redo actions
  pushUndoRecord: (record: UndoRecord) => void;
  undoLastAction: () => Promise<void>;
  redoLastAction: () => Promise<void>;

  // Context Menu & Toast
  openContextMenu: (
    x: number,
    y: number,
    targetEntry: FileEntry | null,
    paneId?: PaneId
  ) => void;
  closeContextMenu: () => void;
  showToast: (text: string, type?: "info" | "error", canUndo?: boolean) => void;
  clearToast: () => void;

  // Clipboard & view settings
  setClipboard: (paths: string[], action: ClipboardAction) => void;
  clearClipboard: () => void;
  setViewMode: (mode: ViewMode) => void;
  setShowHidden: (show: boolean) => void;
  toggleShowHidden: () => void;
  setShowCheckboxes: (show: boolean) => void;
  toggleShowCheckboxes: () => void;
  setSearchQuery: (query: string, paneId?: PaneId) => void;
  setSort: (field: SortField) => void;
}

let tabCounter = 1;
const fetchRequestCounters: Record<PaneId, number> = { left: 0, right: 0 };
const spotlightRequestCounters: Record<PaneId, number> = { left: 0, right: 0 };
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function createTab(path: string, homePath?: string | null): TabItem {
  const normalized = normalizePath(path, homePath);
  const id = `tab-${tabCounter++}`;
  return {
    id,
    title: getPathTitle(normalized, homePath),
    currentPath: normalized,
    history: [normalized],
    historyIndex: 0,
    selectedPaths: [],
  };
}

const initialTab = createTab("/");

export function selectActiveTab(state: ExplorerStore): TabItem {
  return (
    state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0]
  );
}

export function getPaneSnapshot(
  state: ExplorerStore,
  paneId: PaneId
): ResolvedPaneState {
  if (paneId === "right") {
    const rp = state.rightPane;
    return {
      paneId: "right",
      title: getPathTitle(rp.currentPath || "/", state.specialPaths?.home),
      currentPath: rp.currentPath,
      history: rp.history,
      historyIndex: rp.historyIndex,
      selectedPaths: rp.selectedPaths,
      lastSelectedPath: rp.lastSelectedPath,
      entries: rp.entries,
      isLoading: rp.isLoading,
      error: rp.error,
      searchQuery: rp.searchQuery,
      spotlightActive: rp.spotlightActive,
      spotlightQuery: rp.spotlightQuery,
      spotlightScopeDir: rp.spotlightScopeDir,
      spotlightResults: rp.spotlightResults,
      isSearching: rp.isSearching,
    };
  }

  const activeTab = selectActiveTab(state);
  return {
    paneId: "left",
    tabId: activeTab.id,
    title: activeTab.title,
    currentPath: activeTab.currentPath,
    history: activeTab.history,
    historyIndex: activeTab.historyIndex,
    selectedPaths: activeTab.selectedPaths,
    lastSelectedPath: state.lastSelectedPath,
    entries: state.entries,
    isLoading: state.isLoading,
    error: state.error,
    searchQuery: state.searchQuery,
    spotlightActive: state.spotlightActive,
    spotlightQuery: state.spotlightQuery,
    spotlightScopeDir: state.spotlightScopeDir,
    spotlightResults: state.spotlightResults,
    isSearching: state.isSearching,
  };
}

export function getActivePaneSnapshot(state: ExplorerStore): ResolvedPaneState {
  const effectivePane: PaneId = state.dualPane ? state.activePane : "left";
  return getPaneSnapshot(state, effectivePane);
}

export function usePane(paneId: PaneId): ResolvedPaneState {
  return useExplorerStore(
    useShallow((state) => getPaneSnapshot(state, paneId))
  );
}

export function useActivePane(): ResolvedPaneState {
  return useExplorerStore(
    useShallow((state) => getActivePaneSnapshot(state))
  );
}

export const useExplorerStore = create<ExplorerStore>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  clipboard: { paths: [], action: null },
  viewMode: loadViewMode(),
  showHidden: false,
  showCheckboxes: loadShowCheckboxes(),

  dualPane: false,
  activePane: "left",
  dualPaneSplitRatio: loadSplitRatio(),
  rightPane: createEmptyPaneState(""),

  specialPaths: null,
  entries: [],
  entriesByPath: {},
  isLoading: false,
  error: null,
  searchQuery: "",
  sortField: "name",
  sortDirection: "asc",
  lastSelectedPath: null,

  renamingPath: null,
  renamingPaneId: null,
  contextMenu: null,
  destinationModal: null,
  recentDestinations: loadRecentDestinations(),
  toast: null,

  networkDrives: [],
  isLoadingNetworkDrives: false,
  networkModalOpen: false,
  networkModalInitialAddress: "",
  recentLanAddresses: loadRecentLanAddresses(),

  isExtractingZip: false,

  draggingPaths: [],
  dropTargetFolder: null,
  dropCopyMode: false,

  integrationModalOpen: false,
  macosIntegrationStatus: null,
  downloadNotificationsEnabled: loadDownloadNotificationsEnabled(),
  recentDownloadNotice: null,

  spotlightActive: false,
  spotlightQuery: "",
  spotlightScopeDir: "",
  spotlightResults: [],
  isSearching: false,

  undoStack: [],
  redoStack: [],
  isUndoing: false,

  initExplorer: async () => {
    try {
      const specialPaths = await tauriApi.getSpecialPaths();
      const startPath = normalizePath(
        specialPaths.home ?? "/",
        specialPaths.home
      );
      const firstTab = createTab(startPath, specialPaths.home);
      set({
        specialPaths,
        networkDrives: specialPaths.network_drives ?? [],
        tabs: [firstTab],
        activeTabId: firstTab.id,
        activePane: "left",
      });
      await get().loadDirectory(startPath, firstTab.id, "left");
      void get().refreshMacosIntegrationStatus();
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  loadDirectory: async (
    path: string,
    targetTabId?: string,
    paneId?: PaneId
  ) => {
    const resolvedPane: PaneId = paneId ?? (targetTabId ? "left" : get().activePane);
    const requestId = ++fetchRequestCounters[resolvedPane];
    const { showHidden, activeTabId } = get();
    const expectedTabId = targetTabId ?? activeTabId;

    if (resolvedPane === "right") {
      set((state) => ({
        rightPane: {
          ...state.rightPane,
          isLoading: true,
          error: null,
        },
      }));
    } else {
      set({ isLoading: true, error: null });
    }

    try {
      const entries = await tauriApi.readDirEntries(path, showHidden);
      if (requestId !== fetchRequestCounters[resolvedPane]) {
        return;
      }

      if (resolvedPane === "right") {
        if (get().rightPane.currentPath !== path) {
          return;
        }
        set((state) => ({
          rightPane: {
            ...state.rightPane,
            entries,
            isLoading: false,
            error: null,
          },
          entriesByPath: {
            ...state.entriesByPath,
            [path]: entries,
          },
        }));
      } else {
        if (get().activeTabId !== expectedTabId) {
          return;
        }
        set((state) => ({
          entries,
          entriesByPath: {
            ...state.entriesByPath,
            [path]: entries,
          },
          isLoading: false,
          error: null,
        }));
      }
    } catch (err) {
      if (requestId !== fetchRequestCounters[resolvedPane]) {
        return;
      }
      const errMsg = typeof err === "string" ? err : String(err);
      if (resolvedPane === "right") {
        if (get().rightPane.currentPath !== path) {
          return;
        }
        set((state) => ({
          rightPane: {
            ...state.rightPane,
            entries: [],
            isLoading: false,
            error: errMsg,
          },
        }));
      } else {
        if (get().activeTabId !== expectedTabId) {
          return;
        }
        set({
          entries: [],
          isLoading: false,
          error: errMsg,
        });
      }
    }
  },

  refresh: async (paneId?: PaneId) => {
    const state = get();
    const targetPane: PaneId = paneId ?? (state.dualPane ? state.activePane : "left");
    const pane = getPaneSnapshot(state, targetPane);

    if (pane.spotlightActive && pane.spotlightQuery.trim()) {
      await state.runSpotlightSearch(pane.spotlightQuery, targetPane);
      return;
    }

    if (!pane.currentPath) return;
    await state.loadDirectory(pane.currentPath, pane.tabId, targetPane);
  },

  refreshAllPanes: async () => {
    const state = get();
    const tasks: Array<Promise<void>> = [state.refresh("left")];
    if (state.dualPane) {
      tasks.push(state.refresh("right"));
    }
    await Promise.all(tasks);
  },

  refreshPathIfOpen: async (rawPath: string) => {
    const state = get();
    const normalized = normalizePath(rawPath, state.specialPaths?.home);
    const activeTab = selectActiveTab(state);

    const refreshPromises: Array<Promise<void>> = [];

    // Refresh left pane if showing this path
    if (activeTab.currentPath === normalized) {
      refreshPromises.push(state.refresh("left"));
    }

    // Refresh right pane if dual pane is active and showing this path
    if (state.dualPane && state.rightPane.currentPath === normalized) {
      refreshPromises.push(state.refresh("right"));
    }

    if (refreshPromises.length > 0) {
      await Promise.all(refreshPromises);
    }

    // If another inactive tab is showing this path, eagerly refresh its cached entries
    const hasInactiveMatchingTab = state.tabs.some(
      (t) => t.id !== activeTab.id && t.currentPath === normalized
    );
    if (!hasInactiveMatchingTab || refreshPromises.length > 0) return;

    try {
      const freshEntries = await tauriApi.readDirEntries(
        normalized,
        state.showHidden
      );
      set((curr) => ({
        entriesByPath: {
          ...curr.entriesByPath,
          [normalized]: freshEntries,
        },
      }));
    } catch {
      // Ignore background refresh error for inactive tab
    }
  },

  toggleDualPane: () => {
    const state = get();
    state.setDualPane(!state.dualPane);
  },

  setDualPane: (enabled: boolean) => {
    const state = get();
    if (enabled === state.dualPane) return;

    if (!enabled) {
      set({
        dualPane: false,
        activePane: "left",
        renamingPath: null,
        renamingPaneId: null,
        contextMenu: null,
      });
      return;
    }

    const activeTab = selectActiveTab(state);
    const existingRightPath = state.rightPane.currentPath;
    const startPath =
      existingRightPath ||
      activeTab.currentPath ||
      state.specialPaths?.home ||
      "/";
    const normalized = normalizePath(startPath, state.specialPaths?.home);
    const cached = state.entriesByPath[normalized];

    if (!existingRightPath || state.rightPane.history.length === 0) {
      set({
        dualPane: true,
        contextMenu: null,
        rightPane: {
          ...createEmptyPaneState(normalized),
          entries: cached ?? [],
        },
      });
    } else {
      set({
        dualPane: true,
        contextMenu: null,
      });
    }

    void get().loadDirectory(normalized, undefined, "right");
  },

  setActivePane: (paneId: PaneId) => {
    const state = get();
    if (!state.dualPane && paneId === "right") return;
    if (state.activePane === paneId) return;
    set({ activePane: paneId });
  },

  setDualPaneSplitRatio: (ratio: number) => {
    const clamped = Math.min(0.78, Math.max(0.22, ratio));
    saveSplitRatio(clamped);
    set({ dualPaneSplitRatio: clamped });
  },

  addTab: (initialPath?: string) => {
    const { tabs, activeTabId, specialPaths, entriesByPath, loadDirectory } = get();
    const activeTab = tabs.find((t) => t.id === activeTabId);
    const defaultPath =
      initialPath ?? specialPaths?.home ?? activeTab?.currentPath ?? "/";
    const newTab = createTab(defaultPath, specialPaths?.home);
    const cached = entriesByPath[newTab.currentPath];

    set({
      tabs: [...tabs, newTab],
      activeTabId: newTab.id,
      activePane: "left",
      entries: cached ?? [],
      searchQuery: "",
      spotlightActive: false,
      spotlightQuery: "",
      spotlightScopeDir: "",
      spotlightResults: [],
      isSearching: false,
      lastSelectedPath: null,
      renamingPath: null,
      renamingPaneId: null,
      contextMenu: null,
    });
    void loadDirectory(newTab.currentPath, newTab.id, "left");
  },

  closeTab: (id: string) => {
    const { tabs, activeTabId, specialPaths, entriesByPath, loadDirectory } = get();
    const closingIndex = tabs.findIndex((t) => t.id === id);
    if (closingIndex === -1) return;

    if (tabs.length === 1) {
      const fallbackPath = specialPaths?.home ?? "/";
      const freshTab = createTab(fallbackPath, specialPaths?.home);
      set({
        tabs: [freshTab],
        activeTabId: freshTab.id,
        activePane: "left",
        entries: entriesByPath[freshTab.currentPath] ?? [],
        searchQuery: "",
        spotlightActive: false,
        spotlightQuery: "",
        spotlightScopeDir: "",
        spotlightResults: [],
        isSearching: false,
        lastSelectedPath: null,
        renamingPath: null,
        renamingPaneId: null,
        contextMenu: null,
      });
      void loadDirectory(freshTab.currentPath, freshTab.id, "left");
      return;
    }

    const nextTabs = tabs.filter((t) => t.id !== id);
    if (activeTabId !== id) {
      set({ tabs: nextTabs });
      return;
    }

    const nextActiveIndex = Math.min(closingIndex, nextTabs.length - 1);
    const nextActiveTab = nextTabs[nextActiveIndex];
    set({
      tabs: nextTabs,
      activeTabId: nextActiveTab.id,
      entries: entriesByPath[nextActiveTab.currentPath] ?? [],
      searchQuery: "",
      spotlightActive: false,
      spotlightQuery: "",
      spotlightScopeDir: "",
      spotlightResults: [],
      isSearching: false,
      lastSelectedPath: null,
      renamingPath: null,
      renamingPaneId: null,
      contextMenu: null,
    });
    void loadDirectory(nextActiveTab.currentPath, nextActiveTab.id, "left");
  },

  setActiveTab: (id: string) => {
    const { tabs, activeTabId, entriesByPath, loadDirectory } = get();
    if (id === activeTabId) {
      set({ activePane: "left" });
      return;
    }
    const targetTab = tabs.find((t) => t.id === id);
    if (!targetTab) return;

    const cached = entriesByPath[targetTab.currentPath];
    set({
      activeTabId: id,
      activePane: "left",
      entries: cached ?? [],
      searchQuery: "",
      spotlightActive: false,
      spotlightQuery: "",
      spotlightScopeDir: "",
      spotlightResults: [],
      isSearching: false,
      lastSelectedPath: null,
      renamingPath: null,
      renamingPaneId: null,
      contextMenu: null,
    });
    void loadDirectory(targetTab.currentPath, targetTab.id, "left");
  },

  navigateTo: (rawPath: string, paneId?: PaneId) => {
    const state = get();
    const targetPane: PaneId =
      paneId ?? (state.dualPane ? state.activePane : "left");

    // Support pasting Windows UNC (`\\192.168.1.x\Share`) or `smb://`, `afp://`, `nfs://` directly into Address Bar
    if (isNetworkAddressInput(rawPath)) {
      const cleaned = rawPath.trim().replace(/\\/g, "/").toLowerCase();
      const matched = state.networkDrives.find((drive) => {
        const remoteLower = drive.remote_url.toLowerCase();
        const hostShare = `${drive.host}/${drive.name}`.toLowerCase();
        return (
          remoteLower === cleaned ||
          cleaned.endsWith(`/${hostShare}`) ||
          cleaned.includes(`/${drive.host.toLowerCase()}/${drive.name.toLowerCase()}`)
        );
      });
      if (matched) {
        state.navigateTo(matched.path, targetPane);
      } else {
        state.openNetworkModal(rawPath.trim());
      }
      return;
    }

    const normalized = normalizePath(rawPath, state.specialPaths?.home);
    const cached = state.entriesByPath[normalized];

    if (targetPane === "right") {
      const rp = state.rightPane;
      if (normalized === rp.currentPath) {
        set((curr) => ({
          rightPane: {
            ...curr.rightPane,
            searchQuery: "",
            spotlightActive: false,
            spotlightQuery: "",
            spotlightScopeDir: "",
            spotlightResults: [],
            isSearching: false,
          },
          renamingPath: null,
          renamingPaneId: null,
          contextMenu: null,
        }));
        void state.loadDirectory(normalized, undefined, "right");
        return;
      }

      const truncatedHistory = rp.history.slice(0, rp.historyIndex + 1);
      const nextHistory = [...truncatedHistory, normalized];
      const nextIndex = nextHistory.length - 1;

      set((curr) => ({
        rightPane: {
          ...curr.rightPane,
          currentPath: normalized,
          history: nextHistory,
          historyIndex: nextIndex,
          selectedPaths: [],
          lastSelectedPath: null,
          entries: cached ?? curr.rightPane.entries,
          error: null,
          searchQuery: "",
          spotlightActive: false,
          spotlightQuery: "",
          spotlightScopeDir: "",
          spotlightResults: [],
          isSearching: false,
        },
        renamingPath: null,
        renamingPaneId: null,
        contextMenu: null,
      }));
      void state.loadDirectory(normalized, undefined, "right");
      return;
    }

    const { tabs, activeTabId, specialPaths, loadDirectory } = state;
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab) return;

    if (normalized === activeTab.currentPath) {
      set({
        searchQuery: "",
        spotlightActive: false,
        spotlightQuery: "",
        spotlightScopeDir: "",
        spotlightResults: [],
        isSearching: false,
        renamingPath: null,
        renamingPaneId: null,
        contextMenu: null,
      });
      void loadDirectory(normalized, activeTab.id, "left");
      return;
    }

    const truncatedHistory = activeTab.history.slice(
      0,
      activeTab.historyIndex + 1
    );
    const nextHistory = [...truncatedHistory, normalized];
    const nextIndex = nextHistory.length - 1;

    const updatedTabs = tabs.map((tab) =>
      tab.id === activeTabId
        ? {
            ...tab,
            currentPath: normalized,
            title: getPathTitle(normalized, specialPaths?.home),
            history: nextHistory,
            historyIndex: nextIndex,
            selectedPaths: [],
          }
        : tab
    );

    set({
      tabs: updatedTabs,
      entries: cached ?? state.entries,
      searchQuery: "",
      spotlightActive: false,
      spotlightQuery: "",
      spotlightScopeDir: "",
      spotlightResults: [],
      isSearching: false,
      lastSelectedPath: null,
      renamingPath: null,
      renamingPaneId: null,
      contextMenu: null,
    });
    void loadDirectory(normalized, activeTabId, "left");
  },

  goBack: (paneId?: PaneId) => {
    const state = get();
    const targetPane: PaneId =
      paneId ?? (state.dualPane ? state.activePane : "left");

    if (targetPane === "right") {
      const rp = state.rightPane;
      if (rp.historyIndex <= 0) return;
      const nextIndex = rp.historyIndex - 1;
      const nextPath = rp.history[nextIndex];
      const cached = state.entriesByPath[nextPath];
      set((curr) => ({
        rightPane: {
          ...curr.rightPane,
          currentPath: nextPath,
          historyIndex: nextIndex,
          selectedPaths: [],
          lastSelectedPath: null,
          entries: cached ?? curr.rightPane.entries,
          error: null,
          searchQuery: "",
          spotlightActive: false,
          spotlightQuery: "",
          spotlightScopeDir: "",
          spotlightResults: [],
          isSearching: false,
        },
        renamingPath: null,
        renamingPaneId: null,
        contextMenu: null,
      }));
      void state.loadDirectory(nextPath, undefined, "right");
      return;
    }

    const { tabs, activeTabId, specialPaths, entriesByPath, loadDirectory } =
      state;
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab || activeTab.historyIndex <= 0) return;

    const nextIndex = activeTab.historyIndex - 1;
    const nextPath = activeTab.history[nextIndex];
    const cached = entriesByPath[nextPath];

    const updatedTabs = tabs.map((tab) =>
      tab.id === activeTabId
        ? {
            ...tab,
            currentPath: nextPath,
            title: getPathTitle(nextPath, specialPaths?.home),
            historyIndex: nextIndex,
            selectedPaths: [],
          }
        : tab
    );

    set({
      tabs: updatedTabs,
      entries: cached ?? state.entries,
      searchQuery: "",
      spotlightActive: false,
      spotlightQuery: "",
      spotlightScopeDir: "",
      spotlightResults: [],
      isSearching: false,
      lastSelectedPath: null,
      renamingPath: null,
      renamingPaneId: null,
      contextMenu: null,
    });
    void loadDirectory(nextPath, activeTabId, "left");
  },

  goForward: (paneId?: PaneId) => {
    const state = get();
    const targetPane: PaneId =
      paneId ?? (state.dualPane ? state.activePane : "left");

    if (targetPane === "right") {
      const rp = state.rightPane;
      if (rp.historyIndex >= rp.history.length - 1) return;
      const nextIndex = rp.historyIndex + 1;
      const nextPath = rp.history[nextIndex];
      const cached = state.entriesByPath[nextPath];
      set((curr) => ({
        rightPane: {
          ...curr.rightPane,
          currentPath: nextPath,
          historyIndex: nextIndex,
          selectedPaths: [],
          lastSelectedPath: null,
          entries: cached ?? curr.rightPane.entries,
          error: null,
          searchQuery: "",
          spotlightActive: false,
          spotlightQuery: "",
          spotlightScopeDir: "",
          spotlightResults: [],
          isSearching: false,
        },
        renamingPath: null,
        renamingPaneId: null,
        contextMenu: null,
      }));
      void state.loadDirectory(nextPath, undefined, "right");
      return;
    }

    const { tabs, activeTabId, specialPaths, entriesByPath, loadDirectory } =
      state;
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (
      !activeTab ||
      activeTab.historyIndex >= activeTab.history.length - 1
    ) {
      return;
    }

    const nextIndex = activeTab.historyIndex + 1;
    const nextPath = activeTab.history[nextIndex];
    const cached = entriesByPath[nextPath];

    const updatedTabs = tabs.map((tab) =>
      tab.id === activeTabId
        ? {
            ...tab,
            currentPath: nextPath,
            title: getPathTitle(nextPath, specialPaths?.home),
            historyIndex: nextIndex,
            selectedPaths: [],
          }
        : tab
    );

    set({
      tabs: updatedTabs,
      entries: cached ?? state.entries,
      searchQuery: "",
      spotlightActive: false,
      spotlightQuery: "",
      spotlightScopeDir: "",
      spotlightResults: [],
      isSearching: false,
      lastSelectedPath: null,
      renamingPath: null,
      renamingPaneId: null,
      contextMenu: null,
    });
    void loadDirectory(nextPath, activeTabId, "left");
  },

  goUp: (paneId?: PaneId) => {
    const state = get();
    const targetPane: PaneId =
      paneId ?? (state.dualPane ? state.activePane : "left");
    const pane = getPaneSnapshot(state, targetPane);
    if (!pane.currentPath) return;

    const parent = getParentPath(pane.currentPath);
    if (parent && parent !== pane.currentPath) {
      state.navigateTo(parent, targetPane);
    }
  },

  setSelectedPaths: (
    paths: string[],
    anchorPath?: string | null,
    paneId?: PaneId
  ) => {
    const state = get();
    const targetPane: PaneId =
      paneId ?? (state.dualPane ? state.activePane : "left");

    if (targetPane === "right") {
      set((curr) => ({
        rightPane: {
          ...curr.rightPane,
          selectedPaths: paths,
          lastSelectedPath:
            anchorPath !== undefined
              ? anchorPath
              : curr.rightPane.lastSelectedPath,
        },
      }));
      return;
    }

    const { tabs, activeTabId } = state;
    const updatedTabs = tabs.map((tab) =>
      tab.id === activeTabId ? { ...tab, selectedPaths: paths } : tab
    );
    set((curr) => ({
      tabs: updatedTabs,
      lastSelectedPath:
        anchorPath !== undefined ? anchorPath : curr.lastSelectedPath,
    }));
  },

  toggleSelectPath: (path: string, paneId?: PaneId) => {
    const state = get();
    const targetPane: PaneId =
      paneId ?? (state.dualPane ? state.activePane : "left");
    const pane = getPaneSnapshot(state, targetPane);
    const next = new Set(pane.selectedPaths);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    state.setSelectedPaths(Array.from(next), path, targetPane);
  },

  selectAll: (paneId?: PaneId) => {
    const state = get();
    const targetPane: PaneId =
      paneId ?? (state.dualPane ? state.activePane : "left");
    const pane = getPaneSnapshot(state, targetPane);
    const visible = pane.spotlightActive
      ? getVisibleEntries(
          pane.spotlightResults,
          "",
          state.sortField,
          state.sortDirection
        )
      : getVisibleEntries(
          pane.entries,
          pane.searchQuery,
          state.sortField,
          state.sortDirection
        );
    const allPaths = visible.map((e) => e.path);
    state.setSelectedPaths(allPaths, allPaths[0] ?? null, targetPane);
  },

  toggleSelectAll: (paneId?: PaneId) => {
    const state = get();
    const targetPane: PaneId =
      paneId ?? (state.dualPane ? state.activePane : "left");
    const pane = getPaneSnapshot(state, targetPane);
    const visible = pane.spotlightActive
      ? getVisibleEntries(
          pane.spotlightResults,
          "",
          state.sortField,
          state.sortDirection
        )
      : getVisibleEntries(
          pane.entries,
          pane.searchQuery,
          state.sortField,
          state.sortDirection
        );

    if (visible.length === 0) {
      state.clearSelection(targetPane);
      return;
    }

    const selectedSet = new Set(pane.selectedPaths);
    const allSelected = visible.every((e) => selectedSet.has(e.path));

    if (allSelected) {
      state.clearSelection(targetPane);
    } else {
      const allPaths = visible.map((e) => e.path);
      state.setSelectedPaths(allPaths, allPaths[0] ?? null, targetPane);
    }
  },

  clearSelection: (paneId?: PaneId) => {
    const state = get();
    const targetPane: PaneId =
      paneId ?? (state.dualPane ? state.activePane : "left");

    if (targetPane === "right") {
      if (state.rightPane.selectedPaths.length === 0) return;
      set((curr) => ({
        rightPane: {
          ...curr.rightPane,
          selectedPaths: [],
          lastSelectedPath: null,
        },
      }));
      return;
    }

    const { tabs, activeTabId } = state;
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab || activeTab.selectedPaths.length === 0) return;

    set({
      tabs: tabs.map((tab) =>
        tab.id === activeTabId ? { ...tab, selectedPaths: [] } : tab
      ),
      lastSelectedPath: null,
    });
  },

  openEntry: async (entry: FileEntry, paneId?: PaneId) => {
    const state = get();
    const targetPane: PaneId =
      paneId ?? (state.dualPane ? state.activePane : "left");

    // 1. Entry inside a virtual ZIP path (`/path/to/a.zip::inner/path`)
    const zipParts = splitZipVirtualPath(entry.path);
    if (zipParts) {
      if (entry.is_dir) {
        state.navigateTo(entry.path, targetPane);
        return;
      }
      try {
        await tauriApi.openZipEntry(zipParts.zipPath, zipParts.innerPath);
      } catch (err) {
        state.showToast(
          `Could not open "${entry.name}" from ZIP: ${String(err)}`,
          "error"
        );
      }
      return;
    }

    // 2. Real `.zip` archive on disk -> navigate straight inside like a normal folder!
    if (isZipFileEntry(entry)) {
      state.navigateTo(`${entry.path}::`, targetPane);
      return;
    }

    // 3. Normal folder
    if (entry.is_dir && !entry.name.toLowerCase().endsWith(".app")) {
      state.navigateTo(entry.path, targetPane);
      return;
    }

    // 4. Normal file or .app bundle
    try {
      await tauriApi.openItem(entry.path);
    } catch (err) {
      if (entry.is_dir) {
        state.navigateTo(entry.path, targetPane);
      } else {
        state.showToast(
          `Could not open "${entry.name}": ${String(err)}`,
          "error"
        );
      }
    }
  },

  openSelected: async (paneId?: PaneId) => {
    const state = get();
    const targetPane: PaneId =
      paneId ?? (state.dualPane ? state.activePane : "left");
    const pane = getPaneSnapshot(state, targetPane);
    if (pane.selectedPaths.length === 0) return;

    const sourceList = pane.spotlightActive
      ? pane.spotlightResults
      : pane.entries;
    const entryMap = new Map(sourceList.map((e) => [e.path, e]));

    if (pane.selectedPaths.length === 1) {
      const entry = entryMap.get(pane.selectedPaths[0]);
      if (entry) {
        await state.openEntry(entry, targetPane);
      }
      return;
    }

    for (const path of pane.selectedPaths) {
      const entry = entryMap.get(path);
      if (!entry) continue;
      if (!entry.is_dir || entry.name.toLowerCase().endsWith(".app")) {
        await state.openEntry(entry, targetPane);
      }
    }
  },

  copySelected: () => {
    const state = get();
    const pane = getActivePaneSnapshot(state);
    if (pane.selectedPaths.length === 0) return;
    set({
      clipboard: {
        paths: [...pane.selectedPaths],
        action: "copy",
      },
    });
    const count = pane.selectedPaths.length;
    state.showToast(
      `Copied ${count} ${count === 1 ? "item" : "items"}`,
      "info"
    );
  },

  cutSelected: () => {
    const state = get();
    const pane = getActivePaneSnapshot(state);
    if (pane.selectedPaths.length === 0) return;
    if (isZipVirtualPath(pane.currentPath)) {
      state.showToast(
        "ZIP archives are read-only. Use Copy (⌘C) to extract items.",
        "info"
      );
      return;
    }
    set({
      clipboard: {
        paths: [...pane.selectedPaths],
        action: "cut",
      },
    });
    const count = pane.selectedPaths.length;
    state.showToast(
      `Cut ${count} ${count === 1 ? "item" : "items"}`,
      "info"
    );
  },

  pasteClipboard: async () => {
    const state = get();
    const pane = getActivePaneSnapshot(state);
    const { clipboard } = state;

    if (!clipboard.action || clipboard.paths.length === 0) return;

    if (isZipVirtualPath(pane.currentPath)) {
      state.showToast(
        "Cannot paste into a ZIP archive directly. Extract the archive first.",
        "error"
      );
      return;
    }

    try {
      const hasZipSources = clipboard.paths.some((p) => isZipVirtualPath(p));
      let resultEntries: FileEntry[] = [];

      if (hasZipSources) {
        const regularSources: string[] = [];
        for (const srcPath of clipboard.paths) {
          const zipParts = splitZipVirtualPath(srcPath);
          if (zipParts) {
            const extracted = await tauriApi.extractZipEntry(
              zipParts.zipPath,
              zipParts.innerPath,
              pane.currentPath
            );
            resultEntries.push(...extracted);
          } else {
            regularSources.push(srcPath);
          }
        }
        if (regularSources.length > 0) {
          const extra =
            clipboard.action === "cut"
              ? await tauriApi.moveItems(regularSources, pane.currentPath)
              : await tauriApi.copyItems(regularSources, pane.currentPath);
          resultEntries.push(...extra);
        }
      } else {
        resultEntries =
          clipboard.action === "cut"
            ? await tauriApi.moveItems(clipboard.paths, pane.currentPath)
            : await tauriApi.copyItems(clipboard.paths, pane.currentPath);
      }

      const sourceParents = new Set(
        clipboard.paths
          .filter((p) => !isZipVirtualPath(p))
          .map((p) => getParentPath(p))
          .filter((p): p is string => Boolean(p))
      );

      if (clipboard.action === "cut") {
        set({ clipboard: { paths: [], action: null } });
      }

      await state.refreshPathIfOpen(pane.currentPath);
      if (pane.spotlightActive) {
        await state.refresh(pane.paneId);
      }
      for (const parentPath of sourceParents) {
        if (parentPath !== pane.currentPath) {
          await state.refreshPathIfOpen(parentPath);
        }
      }

      const newPaths = resultEntries.map((e) => e.path);

      // Record undo history
      if (clipboard.action === "cut" && !hasZipSources) {
        const pairs = clipboard.paths
          .map((fromPath, idx) => ({
            fromPath,
            toPath: resultEntries[idx]?.path ?? fromPath,
          }))
          .filter((pair) => pair.fromPath !== pair.toPath);
        if (pairs.length > 0) {
          state.pushUndoRecord({
            kind: "move",
            label:
              pairs.length === 1
                ? `Move "${getPathTitle(pairs[0].fromPath)}"`
                : `Move ${pairs.length} items`,
            pairs,
          });
        }
      } else if (newPaths.length > 0) {
        state.pushUndoRecord({
          kind: "copy",
          label:
            newPaths.length === 1
              ? `${hasZipSources ? "Extract" : "Copy"} "${getPathTitle(newPaths[0])}"`
              : `${hasZipSources ? "Extract" : "Copy"} ${newPaths.length} items`,
          sourcePaths: [...clipboard.paths],
          destDir: pane.currentPath,
          createdPaths: newPaths,
        });
      }

      state.setSelectedPaths(newPaths, newPaths[0] ?? null, pane.paneId);

      const verb = hasZipSources
        ? "Extracted"
        : clipboard.action === "cut"
          ? "Moved"
          : "Copied";
      state.showToast(
        `${verb} ${resultEntries.length} ${
          resultEntries.length === 1 ? "item" : "items"
        }`,
        "info",
        true
      );
    } catch (err) {
      state.showToast(`Paste failed: ${String(err)}`, "error");
    }
  },

  deleteSelected: async () => {
    const state = get();
    const pane = getActivePaneSnapshot(state);
    const targets = pane.selectedPaths;
    if (targets.length === 0) return;
    if (isZipVirtualPath(pane.currentPath)) {
      state.showToast("Cannot delete items inside a read-only ZIP archive.", "info");
      return;
    }

    try {
      const trashedRecords = await tauriApi.deleteItems(targets);

      const targetSet = new Set(targets);
      const remainingClip = state.clipboard.paths.filter(
        (p) => !targetSet.has(p)
      );
      set({
        clipboard:
          remainingClip.length > 0
            ? { paths: remainingClip, action: state.clipboard.action }
            : { paths: [], action: null },
        renamingPath: null,
        renamingPaneId: null,
      });

      const undoItems = trashedRecords.map((item) => ({
        originalPath: item.original_path,
        trashedPath: item.trashed_path,
      }));
      const canRestore = undoItems.some((item) => item.trashedPath !== null);

      if (undoItems.length > 0) {
        state.pushUndoRecord({
          kind: "delete",
          label:
            undoItems.length === 1
              ? `Delete "${getPathTitle(undoItems[0].originalPath)}"`
              : `Delete ${undoItems.length} items`,
          items: undoItems,
        });
      }

      state.clearSelection(pane.paneId);

      const affectedParents = new Set(
        targets
          .map((p) => getParentPath(p))
          .filter((p): p is string => Boolean(p))
      );
      affectedParents.add(pane.currentPath);
      for (const dir of affectedParents) {
        await state.refreshPathIfOpen(dir);
      }
      if (pane.spotlightActive) {
        await state.refresh(pane.paneId);
      }

      state.showToast(
        `Moved ${targets.length} ${
          targets.length === 1 ? "item" : "items"
        } to Trash`,
        "info",
        canRestore
      );
    } catch (err) {
      state.showToast(`Delete failed: ${String(err)}`, "error");
    }
  },

  startRenaming: (path?: string, paneId?: PaneId) => {
    const state = get();
    const targetPane: PaneId =
      paneId ?? (state.dualPane ? state.activePane : "left");
    const pane = getPaneSnapshot(state, targetPane);
    if (isZipVirtualPath(pane.currentPath)) {
      state.showToast("Cannot rename items inside a read-only ZIP archive.", "info");
      return;
    }
    const target =
      path ??
      (pane.selectedPaths.length === 1 ? pane.selectedPaths[0] : null);
    if (!target) return;

    state.setSelectedPaths([target], target, targetPane);
    set({
      renamingPath: target,
      renamingPaneId: targetPane,
      contextMenu: null,
    });
  },

  cancelRenaming: () => {
    set({ renamingPath: null, renamingPaneId: null });
  },

  commitRename: async (oldPath: string, rawNewName: string) => {
    const state = get();
    const targetPane: PaneId =
      state.renamingPaneId ?? (state.dualPane ? state.activePane : "left");
    const trimmed = rawNewName.trim();

    if (!trimmed) {
      set({ renamingPath: null, renamingPaneId: null });
      return;
    }

    if (trimmed.includes("/") || trimmed.includes("\0")) {
      state.showToast('Name cannot contain "/" characters', "error");
      return;
    }

    const parent = getParentPath(oldPath) ?? "/";
    const newPath = joinPath(parent, trimmed);

    if (newPath === oldPath) {
      set({ renamingPath: null, renamingPaneId: null });
      return;
    }

    try {
      const updated = await tauriApi.renameItem(oldPath, newPath);
      set({ renamingPath: null, renamingPaneId: null });
      state.pushUndoRecord({
        kind: "rename",
        label: `Rename "${getPathTitle(oldPath)}"`,
        oldPath,
        newPath: updated.path,
      });
      await state.refreshPathIfOpen(parent);
      const pane = getPaneSnapshot(get(), targetPane);
      if (pane.spotlightActive) {
        await state.refresh(targetPane);
      }
      state.setSelectedPaths([updated.path], updated.path, targetPane);
    } catch (err) {
      state.showToast(`Rename failed: ${String(err)}`, "error");
      set({ renamingPath: null, renamingPaneId: null });
    }
  },

  createNewFolder: async () => {
    const state = get();
    const pane = getActivePaneSnapshot(state);
    if (isZipVirtualPath(pane.currentPath)) {
      state.showToast("Cannot create folders inside a read-only ZIP archive.", "info");
      return;
    }
    const uniqueName = generateUniqueName(
      pane.entries.map((e) => e.name),
      "New folder"
    );
    const targetPath = joinPath(pane.currentPath, uniqueName);

    try {
      const created = await tauriApi.createDirectory(targetPath);
      state.pushUndoRecord({
        kind: "create_dir",
        label: `New Folder "${created.name}"`,
        path: created.path,
      });
      await state.refreshPathIfOpen(pane.currentPath);
      state.setSelectedPaths([created.path], created.path, pane.paneId);
      set({
        renamingPath: created.path,
        renamingPaneId: pane.paneId,
        contextMenu: null,
      });
    } catch (err) {
      state.showToast(`Could not create folder: ${String(err)}`, "error");
    }
  },

  createNewFile: async (baseName: string, extension: string) => {
    const state = get();
    const pane = getActivePaneSnapshot(state);
    if (isZipVirtualPath(pane.currentPath)) {
      state.showToast("Cannot create files inside a read-only ZIP archive.", "info");
      return;
    }
    const uniqueName = generateUniqueName(
      pane.entries.map((e) => e.name),
      baseName,
      extension
    );
    const targetPath = joinPath(pane.currentPath, uniqueName);

    try {
      const created = await tauriApi.createEmptyFile(targetPath);
      state.pushUndoRecord({
        kind: "create_file",
        label: `New File "${created.name}"`,
        path: created.path,
      });
      await state.refreshPathIfOpen(pane.currentPath);
      state.setSelectedPaths([created.path], created.path, pane.paneId);
      set({
        renamingPath: created.path,
        renamingPaneId: pane.paneId,
        contextMenu: null,
      });
    } catch (err) {
      state.showToast(`Could not create file: ${String(err)}`, "error");
    }
  },

  copyPathToClipboard: async (paths?: string[]) => {
    const state = get();
    const pane = getActivePaneSnapshot(state);
    const targetPaths =
      paths && paths.length > 0
        ? paths
        : pane.selectedPaths.length > 0
          ? pane.selectedPaths
          : [pane.currentPath];

    const text = targetPaths.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      state.showToast(
        targetPaths.length === 1
          ? "Path copied to clipboard"
          : `${targetPaths.length} paths copied to clipboard`,
        "info"
      );
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      state.showToast("Path copied to clipboard", "info");
    }
  },

  openDestinationModal: (mode: TransferMode, sourcePaths?: string[]) => {
    const state = get();
    const pane = getActivePaneSnapshot(state);
    const paths =
      sourcePaths && sourcePaths.length > 0
        ? sourcePaths
        : pane.selectedPaths;

    if (paths.length === 0) return;

    set({
      contextMenu: null,
      destinationModal: {
        mode,
        sourcePaths: [...paths],
      },
    });
  },

  closeDestinationModal: () => {
    set({ destinationModal: null });
  },

  refreshNetworkDrives: async () => {
    set({ isLoadingNetworkDrives: true });
    try {
      const drives = await tauriApi.getNetworkDrives();
      set((state) => ({
        networkDrives: drives,
        isLoadingNetworkDrives: false,
        specialPaths: state.specialPaths
          ? { ...state.specialPaths, network_drives: drives }
          : state.specialPaths,
      }));
      return drives;
    } catch {
      set({ isLoadingNetworkDrives: false });
      return get().networkDrives;
    }
  },

  openNetworkModal: (initialAddress = "") => {
    set({
      contextMenu: null,
      networkModalOpen: true,
      networkModalInitialAddress: initialAddress,
    });
    void get().refreshNetworkDrives();
  },

  closeNetworkModal: () => {
    set({ networkModalOpen: false, networkModalInitialAddress: "" });
  },

  addRecentLanAddress: (rawAddress: string) => {
    const trimmed = rawAddress.trim();
    if (!trimmed) return;
    const { recentLanAddresses } = get();
    const next = [
      trimmed,
      ...recentLanAddresses.filter(
        (item) => item.toLowerCase() !== trimmed.toLowerCase()
      ),
    ].slice(0, MAX_RECENT_LAN_ADDRESSES);
    saveRecentLanAddresses(next);
    set({ recentLanAddresses: next });
  },

  removeRecentLanAddress: (address: string) => {
    const next = get().recentLanAddresses.filter((item) => item !== address);
    saveRecentLanAddresses(next);
    set({ recentLanAddresses: next });
  },

  connectToLanDrive: async (
    address: string,
    options?: { protocol?: string; username?: string; password?: string }
  ) => {
    const state = get();
    const beforePaths = new Set(state.networkDrives.map((d) => d.path));
    try {
      const result = await tauriApi.connectNetworkDrive(address, options);
      state.addRecentLanAddress(result.url);

      const drives = await state.refreshNetworkDrives();
      if (result.mounted_drive) {
        state.navigateTo(result.mounted_drive.path);
        state.showToast(
          result.status === "already_mounted"
            ? `Opened LAN drive "${result.mounted_drive.name}"`
            : `Connected to LAN drive "${result.mounted_drive.name}"`,
          "info"
        );
        return result;
      }

      // Check if a new drive appeared right after refresh
      const newlyAppeared = drives.find((d) => !beforePaths.has(d.path));
      if (newlyAppeared) {
        state.navigateTo(newlyAppeared.path);
        state.showToast(
          `Connected to LAN drive "${newlyAppeared.name}"`,
          "info"
        );
        return { ...result, status: "mounted", mounted_drive: newlyAppeared };
      }

      // macOS showed the native Connect/Share prompt — poll gently for ~15s so it auto-opens on mount
      state.showToast(
        "Complete login or choose a shared folder in the macOS dialog...",
        "info"
      );

      let attempts = 0;
      const pollTimer = setInterval(() => {
        attempts += 1;
        void get()
          .refreshNetworkDrives()
          .then((latest) => {
            const added = latest.find((d) => !beforePaths.has(d.path));
            if (added) {
              clearInterval(pollTimer);
              get().navigateTo(added.path);
              get().showToast(
                `Connected to LAN drive "${added.name}"`,
                "info"
              );
            } else if (attempts >= 12) {
              clearInterval(pollTimer);
            }
          });
      }, 1250);

      return result;
    } catch (err) {
      state.showToast(`LAN connection failed: ${String(err)}`, "error");
      return null;
    }
  },

  disconnectLanDrive: async (mountPath: string) => {
    const state = get();
    const drive = state.networkDrives.find((d) => d.path === mountPath);
    const homeFallback = state.specialPaths?.home ?? "/";

    // Navigate away first if any visible pane is currently inside the share being ejected
    const leftTab = selectActiveTab(state);
    if (
      leftTab.currentPath === mountPath ||
      leftTab.currentPath.startsWith(`${mountPath}/`)
    ) {
      state.navigateTo(homeFallback, "left");
    }
    if (
      state.dualPane &&
      (state.rightPane.currentPath === mountPath ||
        state.rightPane.currentPath.startsWith(`${mountPath}/`))
    ) {
      state.navigateTo(homeFallback, "right");
    }

    try {
      await tauriApi.disconnectNetworkDrive(mountPath);
      await state.refreshNetworkDrives();
      state.showToast(
        `Disconnected "${drive?.name ?? getPathTitle(mountPath)}"`,
        "info"
      );
      return true;
    } catch (err) {
      state.showToast(`Disconnect failed: ${String(err)}`, "error");
      return false;
    }
  },

  addRecentDestination: (rawPath: string) => {
    const { specialPaths, recentDestinations } = get();
    const normalized = normalizePath(rawPath, specialPaths?.home);
    const next = [
      normalized,
      ...recentDestinations.filter((p) => p !== normalized),
    ].slice(0, MAX_RECENT_DESTINATIONS);

    saveRecentDestinations(next);
    set({ recentDestinations: next });
  },

  copyOrMoveToDestination: async (
    mode: TransferMode,
    sourcePaths: string[],
    rawDestDir: string
  ) => {
    const state = get();
    if (sourcePaths.length === 0) return false;

    const normalizedDest = normalizePath(rawDestDir, state.specialPaths?.home);
    if (isZipVirtualPath(normalizedDest)) {
      state.showToast(
        "Cannot copy or move items into a read-only ZIP archive.",
        "error"
      );
      return false;
    }

    const pane = getActivePaneSnapshot(state);
    const hasZipSources = sourcePaths.some((p) => isZipVirtualPath(p));

    try {
      let resultEntries: FileEntry[] = [];
      if (hasZipSources) {
        const regularSources: string[] = [];
        for (const srcPath of sourcePaths) {
          const zipParts = splitZipVirtualPath(srcPath);
          if (zipParts) {
            const extracted = await tauriApi.extractZipEntry(
              zipParts.zipPath,
              zipParts.innerPath,
              normalizedDest
            );
            resultEntries.push(...extracted);
          } else {
            regularSources.push(srcPath);
          }
        }
        if (regularSources.length > 0) {
          const extra =
            mode === "move"
              ? await tauriApi.moveItems(regularSources, normalizedDest)
              : await tauriApi.copyItems(regularSources, normalizedDest);
          resultEntries.push(...extra);
        }
      } else {
        resultEntries =
          mode === "move"
            ? await tauriApi.moveItems(sourcePaths, normalizedDest)
            : await tauriApi.copyItems(sourcePaths, normalizedDest);
      }

      state.addRecentDestination(normalizedDest);

      const affectedDirs = new Set<string>([normalizedDest, pane.currentPath]);
      for (const src of sourcePaths) {
        const parent = getParentPath(src);
        if (parent) affectedDirs.add(parent);
      }

      if (mode === "move") {
        // Remove moved items from cut/copy clipboard if present
        const movedSet = new Set(sourcePaths);
        const remainingClip = state.clipboard.paths.filter(
          (p) => !movedSet.has(p)
        );
        set({
          clipboard:
            remainingClip.length > 0
              ? { paths: remainingClip, action: state.clipboard.action }
              : { paths: [], action: null },
        });
        if (normalizedDest !== pane.currentPath) {
          state.clearSelection(pane.paneId);
        }
      }

      // Record undo history for Copy To / Move To
      if (mode === "move" && !hasZipSources) {
        const pairs = sourcePaths
          .map((fromPath, idx) => ({
            fromPath,
            toPath: resultEntries[idx]?.path ?? fromPath,
          }))
          .filter((pair) => pair.fromPath !== pair.toPath);
        if (pairs.length > 0) {
          state.pushUndoRecord({
            kind: "move",
            label:
              pairs.length === 1
                ? `Move "${getPathTitle(pairs[0].fromPath)}"`
                : `Move ${pairs.length} items`,
            pairs,
          });
        }
      } else if (resultEntries.length > 0) {
        state.pushUndoRecord({
          kind: "copy",
          label:
            resultEntries.length === 1
              ? `${hasZipSources ? "Extract" : "Copy"} "${getPathTitle(resultEntries[0].path)}"`
              : `${hasZipSources ? "Extract" : "Copy"} ${resultEntries.length} items`,
          sourcePaths: [...sourcePaths],
          destDir: normalizedDest,
          createdPaths: resultEntries.map((e) => e.path),
        });
      }

      // Refresh every affected directory across both panes and open tabs
      for (const dir of affectedDirs) {
        if (!isZipVirtualPath(dir)) {
          await state.refreshPathIfOpen(dir);
        }
      }
      if (pane.spotlightActive) {
        await state.refresh(pane.paneId);
      }

      const destLabel = getPathTitle(normalizedDest, state.specialPaths?.home);
      const count = resultEntries.length;
      const verb = hasZipSources
        ? "Extracted"
        : mode === "move"
          ? "Moved"
          : "Copied";
      state.showToast(
        `${verb} ${count} ${count === 1 ? "item" : "items"} to "${destLabel}"`,
        "info",
        true
      );
      return true;
    } catch (err) {
      const verb = mode === "move" ? "Move" : "Copy";
      state.showToast(`${verb} failed: ${String(err)}`, "error");
      return false;
    }
  },

  extractZipAll: async (rawZipPath?: string, destDir?: string) => {
    const state = get();
    if (state.isExtractingZip) return;

    const pane = getActivePaneSnapshot(state);
    const zipPath =
      rawZipPath ?? splitZipVirtualPath(pane.currentPath)?.zipPath ?? null;
    if (!zipPath) return;

    set({ isExtractingZip: true });
    try {
      const extractedDir = await tauriApi.extractZipAll(zipPath, destDir);
      set({ isExtractingZip: false });

      const parentDir = getParentPath(extractedDir.path);
      if (parentDir) {
        await state.refreshPathIfOpen(parentDir);
      }
      state.navigateTo(extractedDir.path, pane.paneId);
      state.showToast(`Extracted archive to "${extractedDir.name}"`, "info");
    } catch (err) {
      set({ isExtractingZip: false });
      state.showToast(`Extract failed: ${String(err)}`, "error");
    }
  },

  setDraggingPaths: (paths: string[]) => {
    set({ draggingPaths: paths });
  },

  setDropTargetFolder: (path: string | null, copyMode?: boolean) => {
    set((curr) => ({
      dropTargetFolder: path,
      dropCopyMode: copyMode !== undefined ? copyMode : curr.dropCopyMode,
    }));
  },

  clearDragState: () => {
    set({
      draggingPaths: [],
      dropTargetFolder: null,
      dropCopyMode: false,
    });
  },

  beginNativeFileDrag: async (paths: string[]) => {
    if (paths.length === 0) return;
    set({ draggingPaths: [...paths], contextMenu: null });
    try {
      await tauriApi.startNativeDrag(paths);
    } catch (err) {
      set({ draggingPaths: [], dropTargetFolder: null, dropCopyMode: false });
      get().showToast(`Could not drag items: ${String(err)}`, "error");
    }
  },

  quicklookSelected: async (path?: string) => {
    const state = get();
    const pane = getActivePaneSnapshot(state);
    const target =
      path ??
      (pane.selectedPaths.length === 1 ? pane.selectedPaths[0] : null);
    if (!target) return;

    try {
      const zipParts = splitZipVirtualPath(target);
      if (zipParts) {
        if (!zipParts.innerPath) return;
        await tauriApi.quicklookZipEntry(zipParts.zipPath, zipParts.innerPath);
      } else {
        await tauriApi.quicklookItem(target);
      }
    } catch (err) {
      state.showToast(`QuickLook failed: ${String(err)}`, "error");
    }
  },

  revealInFinder: async (path?: string) => {
    const state = get();
    const pane = getActivePaneSnapshot(state);
    const rawTarget = path ?? pane.selectedPaths[0] ?? pane.currentPath;
    if (!rawTarget) return;

    // If inside a ZIP archive, reveal the underlying .zip file in Finder
    const target = splitZipVirtualPath(rawTarget)?.zipPath ?? rawTarget;

    try {
      await tauriApi.revealInFinder(target);
    } catch (err) {
      state.showToast(`Reveal in Finder failed: ${String(err)}`, "error");
    }
  },

  openInTerminal: async (path?: string) => {
    const state = get();
    const pane = getActivePaneSnapshot(state);
    const rawTarget = path ?? pane.currentPath;
    if (!rawTarget) return;

    // If inside a ZIP archive, open Terminal at the folder containing the .zip file
    const zipParts = splitZipVirtualPath(rawTarget);
    const target = zipParts
      ? (getParentPath(zipParts.zipPath) ?? "/")
      : rawTarget;

    try {
      await tauriApi.openInTerminal(target);
    } catch (err) {
      state.showToast(`Open in Terminal failed: ${String(err)}`, "error");
    }
  },

  runSpotlightSearch: async (rawQuery?: string, paneId?: PaneId) => {
    const state = get();
    const targetPane: PaneId =
      paneId ?? (state.dualPane ? state.activePane : "left");
    const pane = getPaneSnapshot(state, targetPane);
    const query = (rawQuery ?? pane.searchQuery).trim();

    if (!query) {
      state.clearSpotlightSearch(targetPane);
      return;
    }

    const reqId = ++spotlightRequestCounters[targetPane];
    const scopeDir = pane.currentPath;

    if (targetPane === "right") {
      set((curr) => ({
        rightPane: {
          ...curr.rightPane,
          searchQuery: query,
          spotlightActive: true,
          spotlightQuery: query,
          spotlightScopeDir: scopeDir,
          isSearching: true,
          error: null,
        },
      }));
    } else {
      set({
        searchQuery: query,
        spotlightActive: true,
        spotlightQuery: query,
        spotlightScopeDir: scopeDir,
        isSearching: true,
        error: null,
      });
    }
    state.clearSelection(targetPane);

    try {
      const results = await tauriApi.spotlightSearch(
        scopeDir,
        query,
        state.showHidden
      );
      if (reqId !== spotlightRequestCounters[targetPane]) return;

      if (targetPane === "right") {
        set((curr) => ({
          rightPane: {
            ...curr.rightPane,
            spotlightResults: results,
            isSearching: false,
          },
        }));
      } else {
        set({
          spotlightResults: results,
          isSearching: false,
        });
      }
    } catch (err) {
      if (reqId !== spotlightRequestCounters[targetPane]) return;
      if (targetPane === "right") {
        set((curr) => ({
          rightPane: {
            ...curr.rightPane,
            spotlightResults: [],
            isSearching: false,
          },
        }));
      } else {
        set({
          spotlightResults: [],
          isSearching: false,
        });
      }
      state.showToast(`Spotlight search failed: ${String(err)}`, "error");
    }
  },

  clearSpotlightSearch: (paneId?: PaneId) => {
    const state = get();
    const targetPane: PaneId =
      paneId ?? (state.dualPane ? state.activePane : "left");
    spotlightRequestCounters[targetPane] += 1;

    if (targetPane === "right") {
      set((curr) => ({
        rightPane: {
          ...curr.rightPane,
          searchQuery: "",
          spotlightActive: false,
          spotlightQuery: "",
          spotlightScopeDir: "",
          spotlightResults: [],
          isSearching: false,
        },
      }));
    } else {
      set({
        searchQuery: "",
        spotlightActive: false,
        spotlightQuery: "",
        spotlightScopeDir: "",
        spotlightResults: [],
        isSearching: false,
      });
    }
    get().clearSelection(targetPane);
  },

  pushUndoRecord: (record: UndoRecord) => {
    set((state) => ({
      undoStack: [...state.undoStack, record].slice(-MAX_UNDO_HISTORY),
      redoStack: [],
    }));
  },

  undoLastAction: async () => {
    const state = get();
    if (state.isUndoing || state.undoStack.length === 0) return;

    const record = state.undoStack[state.undoStack.length - 1];
    const remainingUndo = state.undoStack.slice(0, -1);
    const activePaneData = getActivePaneSnapshot(state);

    set({
      isUndoing: true,
      renamingPath: null,
      renamingPaneId: null,
      contextMenu: null,
    });

    try {
      const affectedDirs = new Set<string>();
      const pathsToSelect: string[] = [];
      let redoRecord: UndoRecord = record;

      switch (record.kind) {
        case "rename": {
          const restored = await tauriApi.renameItem(
            record.newPath,
            record.oldPath
          );
          const parent = getParentPath(restored.path);
          if (parent) affectedDirs.add(parent);
          pathsToSelect.push(restored.path);
          redoRecord = {
            ...record,
            oldPath: restored.path,
            newPath: record.newPath,
          };
          break;
        }

        case "move": {
          const pairsToRestore = record.pairs.map((p) => ({
            from_path: p.toPath,
            to_path: p.fromPath,
          }));
          const restoredEntries = await tauriApi.restorePaths(pairsToRestore);
          for (const p of record.pairs) {
            const p1 = getParentPath(p.fromPath);
            const p2 = getParentPath(p.toPath);
            if (p1) affectedDirs.add(p1);
            if (p2) affectedDirs.add(p2);
          }
          for (const entry of restoredEntries) {
            pathsToSelect.push(entry.path);
          }
          redoRecord = {
            ...record,
            pairs: record.pairs.map((p, idx) => ({
              fromPath: restoredEntries[idx]?.path ?? p.fromPath,
              toPath: p.toPath,
            })),
          };
          break;
        }

        case "copy": {
          await tauriApi.deleteItems(record.createdPaths);
          affectedDirs.add(record.destDir);
          break;
        }

        case "create_dir":
        case "create_file": {
          await tauriApi.deleteItems([record.path]);
          const parent = getParentPath(record.path);
          if (parent) affectedDirs.add(parent);
          break;
        }

        case "delete": {
          const restorable = record.items.filter(
            (item): item is { originalPath: string; trashedPath: string } =>
              item.trashedPath !== null
          );
          if (restorable.length === 0) {
            set({ isUndoing: false });
            state.showToast(
              "Cannot restore from macOS Trash automatically. Please use Put Back in Finder Trash.",
              "error"
            );
            return;
          }
          const restoredEntries = await tauriApi.restorePaths(
            restorable.map((item) => ({
              from_path: item.trashedPath,
              to_path: item.originalPath,
            }))
          );
          for (const entry of restoredEntries) {
            const parent = getParentPath(entry.path);
            if (parent) affectedDirs.add(parent);
            pathsToSelect.push(entry.path);
          }
          redoRecord = {
            ...record,
            items: restoredEntries.map((entry) => ({
              originalPath: entry.path,
              trashedPath: null,
            })),
          };
          break;
        }
      }

      set((curr) => ({
        undoStack: remainingUndo,
        redoStack: [...curr.redoStack, redoRecord].slice(-MAX_UNDO_HISTORY),
        isUndoing: false,
      }));

      affectedDirs.add(activePaneData.currentPath);
      for (const dir of affectedDirs) {
        await get().refreshPathIfOpen(dir);
      }

      const selectable = pathsToSelect.filter(
        (p) => getParentPath(p) === activePaneData.currentPath
      );
      if (selectable.length > 0) {
        get().setSelectedPaths(
          selectable,
          selectable[0],
          activePaneData.paneId
        );
      } else {
        get().clearSelection(activePaneData.paneId);
      }

      get().showToast(`Undid ${record.label}`, "info");
    } catch (err) {
      set({ isUndoing: false });
      get().showToast(`Undo failed: ${String(err)}`, "error");
    }
  },

  redoLastAction: async () => {
    const state = get();
    if (state.isUndoing || state.redoStack.length === 0) return;

    const record = state.redoStack[state.redoStack.length - 1];
    const remainingRedo = state.redoStack.slice(0, -1);
    const activePaneData = getActivePaneSnapshot(state);

    set({
      isUndoing: true,
      renamingPath: null,
      renamingPaneId: null,
      contextMenu: null,
    });

    try {
      const affectedDirs = new Set<string>();
      const pathsToSelect: string[] = [];
      let nextUndoRecord: UndoRecord = record;

      switch (record.kind) {
        case "rename": {
          const updated = await tauriApi.renameItem(
            record.oldPath,
            record.newPath
          );
          const parent = getParentPath(updated.path);
          if (parent) affectedDirs.add(parent);
          pathsToSelect.push(updated.path);
          nextUndoRecord = { ...record, newPath: updated.path };
          break;
        }

        case "move": {
          const movedEntries = await tauriApi.restorePaths(
            record.pairs.map((p) => ({
              from_path: p.fromPath,
              to_path: p.toPath,
            }))
          );
          for (const p of record.pairs) {
            const p1 = getParentPath(p.fromPath);
            const p2 = getParentPath(p.toPath);
            if (p1) affectedDirs.add(p1);
            if (p2) affectedDirs.add(p2);
          }
          for (const entry of movedEntries) {
            pathsToSelect.push(entry.path);
          }
          nextUndoRecord = {
            ...record,
            pairs: record.pairs.map((p, idx) => ({
              fromPath: p.fromPath,
              toPath: movedEntries[idx]?.path ?? p.toPath,
            })),
          };
          break;
        }

        case "copy": {
          const copied = await tauriApi.copyItems(
            record.sourcePaths,
            record.destDir
          );
          affectedDirs.add(record.destDir);
          const createdPaths = copied.map((e) => e.path);
          pathsToSelect.push(...createdPaths);
          nextUndoRecord = { ...record, createdPaths };
          break;
        }

        case "create_dir": {
          const created = await tauriApi.createDirectory(record.path);
          const parent = getParentPath(created.path);
          if (parent) affectedDirs.add(parent);
          pathsToSelect.push(created.path);
          nextUndoRecord = { ...record, path: created.path };
          break;
        }

        case "create_file": {
          const created = await tauriApi.createEmptyFile(record.path);
          const parent = getParentPath(created.path);
          if (parent) affectedDirs.add(parent);
          pathsToSelect.push(created.path);
          nextUndoRecord = { ...record, path: created.path };
          break;
        }

        case "delete": {
          const pathsToDelete = record.items.map((item) => item.originalPath);
          const trashed = await tauriApi.deleteItems(pathsToDelete);
          for (const p of pathsToDelete) {
            const parent = getParentPath(p);
            if (parent) affectedDirs.add(parent);
          }
          nextUndoRecord = {
            ...record,
            items: trashed.map((t) => ({
              originalPath: t.original_path,
              trashedPath: t.trashed_path,
            })),
          };
          break;
        }
      }

      set((curr) => ({
        redoStack: remainingRedo,
        undoStack: [...curr.undoStack, nextUndoRecord].slice(-MAX_UNDO_HISTORY),
        isUndoing: false,
      }));

      affectedDirs.add(activePaneData.currentPath);
      for (const dir of affectedDirs) {
        await get().refreshPathIfOpen(dir);
      }

      const selectable = pathsToSelect.filter(
        (p) => getParentPath(p) === activePaneData.currentPath
      );
      if (selectable.length > 0) {
        get().setSelectedPaths(
          selectable,
          selectable[0],
          activePaneData.paneId
        );
      } else {
        get().clearSelection(activePaneData.paneId);
      }

      get().showToast(`Redid ${record.label}`, "info", true);
    } catch (err) {
      set({ isUndoing: false });
      get().showToast(`Redo failed: ${String(err)}`, "error");
    }
  },

  openContextMenu: (
    x: number,
    y: number,
    targetEntry: FileEntry | null,
    paneId?: PaneId
  ) => {
    const state = get();
    const resolvedPane: PaneId =
      paneId ?? (state.dualPane ? state.activePane : "left");
    set({
      activePane: state.dualPane ? resolvedPane : "left",
      contextMenu: { x, y, targetEntry, paneId: resolvedPane },
    });
  },

  closeContextMenu: () => {
    if (get().contextMenu !== null) {
      set({ contextMenu: null });
    }
  },

  showToast: (
    text: string,
    type: "info" | "error" = "info",
    canUndo = false
  ) => {
    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    set({ toast: { text, type, canUndo } });
    toastTimer = setTimeout(
      () => {
        set({ toast: null });
        toastTimer = null;
      },
      type === "error" ? 4500 : canUndo ? 4500 : 2500
    );
  },

  clearToast: () => {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    set({ toast: null });
  },

  setClipboard: (paths: string[], action: ClipboardAction) => {
    set({ clipboard: { paths, action } });
  },

  clearClipboard: () => {
    set({ clipboard: { paths: [], action: null } });
  },

  setViewMode: (mode: ViewMode) => {
    saveViewMode(mode);
    set({ viewMode: mode });
  },

  setShowHidden: (show: boolean) => {
    set({ showHidden: show });
    void get().refreshAllPanes();
  },

  toggleShowHidden: () => {
    set((state) => ({ showHidden: !state.showHidden }));
    void get().refreshAllPanes();
  },

  setShowCheckboxes: (show: boolean) => {
    saveShowCheckboxes(show);
    set({ showCheckboxes: show });
  },

  toggleShowCheckboxes: () => {
    const next = !get().showCheckboxes;
    saveShowCheckboxes(next);
    set({ showCheckboxes: next });
  },

  setSearchQuery: (query: string, paneId?: PaneId) => {
    const state = get();
    const targetPane: PaneId =
      paneId ?? (state.dualPane ? state.activePane : "left");

    if (!query.trim()) {
      spotlightRequestCounters[targetPane] += 1;
      if (targetPane === "right") {
        set((curr) => ({
          rightPane: {
            ...curr.rightPane,
            searchQuery: "",
            spotlightActive: false,
            spotlightQuery: "",
            spotlightScopeDir: "",
            spotlightResults: [],
            isSearching: false,
          },
        }));
      } else {
        set({
          searchQuery: "",
          spotlightActive: false,
          spotlightQuery: "",
          spotlightScopeDir: "",
          spotlightResults: [],
          isSearching: false,
        });
      }
      return;
    }

    if (targetPane === "right") {
      set((curr) => ({
        rightPane: {
          ...curr.rightPane,
          searchQuery: query,
        },
      }));
    } else {
      set({ searchQuery: query });
    }
  },

  setSort: (field: SortField) => {
    set((state) => {
      if (state.sortField === field) {
        return {
          sortDirection: state.sortDirection === "asc" ? "desc" : "asc",
        };
      }
      return {
        sortField: field,
        sortDirection: "asc",
      };
    });
  },

  openIntegrationModal: () => {
    set({ integrationModalOpen: true, contextMenu: null });
    void get().refreshMacosIntegrationStatus();
  },

  closeIntegrationModal: () => {
    set({ integrationModalOpen: false });
  },

  refreshMacosIntegrationStatus: async () => {
    try {
      const status = await tauriApi.getMacosIntegrationStatus();
      set({ macosIntegrationStatus: status });
      return status;
    } catch {
      return null;
    }
  },

  setMacosIntegrationStatus: (status: MacOsIntegrationStatus) => {
    set({ macosIntegrationStatus: status });
  },

  setDownloadNotificationsEnabled: (enabled: boolean) => {
    saveDownloadNotificationsEnabled(enabled);
    set((state) => ({
      downloadNotificationsEnabled: enabled,
      recentDownloadNotice: enabled ? state.recentDownloadNotice : null,
    }));
  },

  setRecentDownloadNotice: (notice: DownloadCompletedEvent | null) => {
    set({ recentDownloadNotice: notice });
  },

  revealTargetInPane: async (target: RevealTarget, paneId?: PaneId) => {
    const state = get();
    const targetPane: PaneId =
      paneId ?? (state.dualPane ? state.activePane : "left");
    const home = state.specialPaths?.home;
    const normalizedDir = normalizePath(target.directory, home);

    state.navigateTo(normalizedDir, targetPane);

    const afterNav = get();
    const tabId =
      targetPane === "left" ? selectActiveTab(afterNav).id : undefined;

    await afterNav.loadDirectory(normalizedDir, tabId, targetPane);

    if (!target.select_path) {
      return;
    }

    const selectPath = normalizePath(target.select_path, home);
    let snap = getPaneSnapshot(get(), targetPane);
    let found = snap.entries.some((e) => e.path === selectPath);

    // If the revealed item is a hidden file/folder, automatically show hidden items so it can be highlighted
    if (!found && target.name.startsWith(".") && !get().showHidden) {
      set({ showHidden: true });
      await get().loadDirectory(normalizedDir, tabId, targetPane);
      snap = getPaneSnapshot(get(), targetPane);
      found = snap.entries.some((e) => e.path === selectPath);
    }

    if (found) {
      get().setSelectedPaths([selectPath], selectPath, targetPane);
    }
  },

  revealPath: async (
    rawPath: string,
    preferSelectDir = true,
    paneId?: PaneId
  ) => {
    try {
      const target = await tauriApi.resolveRevealPath(rawPath, preferSelectDir);
      await get().revealTargetInPane(target, paneId);
    } catch (err) {
      get().showToast(`Could not reveal item: ${String(err)}`, "error");
    }
  },
}));
