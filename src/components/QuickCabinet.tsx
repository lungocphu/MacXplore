import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  Cloud,
  Download,
  Eye,
  FileText,
  Folder,
  FolderOutput,
  FolderPlus,
  Home,
  Inbox,
  Loader2,
  Maximize2,
  Monitor,
  Pin,
  PinOff,
  Plus,
  RotateCw,
  Search,
  Settings2,
  StickyNote,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  tauriApi,
  type FileEntry,
  type SpecialPaths,
} from "../lib/tauriApi";
import {
  formatFileSize,
  formatModifiedDate,
  generateUniqueName,
  getParentPath,
  getPathTitle,
  joinPath,
  normalizePath,
} from "../lib/format";
import {
  loadCustomInboxPath,
  loadPinnedFolders,
  saveCustomInboxPath,
  savePinnedFolders,
  type PinnedCabinetFolder,
} from "../lib/cabinetStorage";
import { FileIcon } from "./FileIcon";

interface QuickTab {
  id: string;
  label: string;
  path: string;
  kind: "inbox" | "essential" | "cloud" | "custom";
}

function findDropFolderAtLogicalPoint(cx: number, cy: number): string | null {
  if (
    cx < 0 ||
    cy < 0 ||
    cx > window.innerWidth ||
    cy > window.innerHeight
  ) {
    return null;
  }

  const elements = document.elementsFromPoint(cx, cy);
  for (const el of elements) {
    const target = (el as HTMLElement).closest?.("[data-drop-folder]") as
      | HTMLElement
      | null;
    if (target?.dataset.dropFolder) {
      return target.dataset.dropFolder;
    }
  }
  return null;
}

export function QuickCabinet() {
  const [specialPaths, setSpecialPaths] = useState<SpecialPaths | null>(null);
  const [inboxPath, setInboxPath] = useState<string>("");
  const [inboxCount, setInboxCount] = useState<number>(0);
  const [pinnedFolders, setPinnedFolders] = useState<PinnedCabinetFolder[]>(() =>
    loadPinnedFolders()
  );

  const [currentPath, setCurrentPath] = useState<string>("");
  const [history, setHistory] = useState<string[]>([]);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Default pinned = true so clicking/dragging files from Desktop never hides Quick Cabinet
  const [isWindowPinned, setIsWindowPinned] = useState<boolean>(true);
  const [dropMode, setDropMode] = useState<"move" | "copy">("move");
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [dragTargetFolder, setDragTargetFolder] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Inline Quick Note / Pin Path / Inbox Settings / 1-click Classify states
  const [showQuickNote, setShowQuickNote] = useState<boolean>(false);
  const [noteTitle, setNoteTitle] = useState<string>("");
  const [noteContent, setNoteContent] = useState<string>("");
  const [showPinInput, setShowPinInput] = useState<boolean>(false);
  const [pinDraftPath, setPinDraftPath] = useState<string>("");
  const [showInboxSettings, setShowInboxSettings] = useState<boolean>(false);
  const [inboxDraftPath, setInboxDraftPath] = useState<string>("");
  const [classifyEntryPath, setClassifyEntryPath] = useState<string | null>(
    null
  );

  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPathRef = useRef(currentPath);
  const inboxPathRef = useRef(inboxPath);
  const dropModeRef = useRef(dropMode);
  const dragTargetRef = useRef<string | null>(null);
  currentPathRef.current = currentPath;
  inboxPathRef.current = inboxPath;
  dropModeRef.current = dropMode;

  const flashNotice = useCallback((text: string) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setStatusNotice(text);
    noticeTimerRef.current = setTimeout(() => {
      setStatusNotice(null);
    }, 2800);
  }, []);

  const refreshInboxBadge = useCallback(async (targetInbox: string) => {
    if (!targetInbox) return;
    try {
      const items = await tauriApi.readDirEntries(targetInbox, false);
      setInboxCount(items.length);
    } catch {
      setInboxCount(0);
    }
  }, []);

  const loadFolder = useCallback(
    async (targetPath: string, pushHistory = false) => {
      if (!targetPath) return;
      setIsLoading(true);
      setError(null);
      setClassifyEntryPath(null);
      try {
        const list = await tauriApi.readDirEntries(targetPath, false);
        setEntries(list);
        setCurrentPath((prev) => {
          if (pushHistory && prev && prev !== targetPath) {
            setHistory((h) => [...h, prev]);
          }
          return targetPath;
        });
        if (targetPath === inboxPathRef.current) {
          setInboxCount(list.length);
        }
      } catch (err) {
        setEntries([]);
        setError(String(err));
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // Initial load: fetch special paths + ensure Inbox exists
  const initCabinet = useCallback(async () => {
    try {
      const paths = await tauriApi.getSpecialPaths();
      setSpecialPaths(paths);
      const customInbox = loadCustomInboxPath();
      const resolvedInbox = await tauriApi.getOrCreateInboxDir(
        customInbox ?? undefined
      );
      inboxPathRef.current = resolvedInbox;
      setInboxPath(resolvedInbox);
      setInboxDraftPath(resolvedInbox);
      setPinnedFolders(loadPinnedFolders());
      await refreshInboxBadge(resolvedInbox);
      await loadFolder(resolvedInbox, false);
    } catch (err) {
      setError(String(err));
      setIsLoading(false);
    }
  }, [loadFolder, refreshInboxBadge]);

  useEffect(() => {
    void initCabinet();
  }, [initCabinet]);

  // Listen to Tauri events (popover shown / cross-window sync) & native OS file Drag-and-Drop
  useEffect(() => {
    let unlistenShown: (() => void) | null = null;
    let unlistenSync: (() => void) | null = null;
    let unlistenDrag: (() => void) | null = null;
    let unlistenDragEnded: (() => void) | null = null;

    const setup = async () => {
      unlistenShown = await listen("mxplore:cabinet-shown", () => {
        setPinnedFolders(loadPinnedFolders());
        const target = currentPathRef.current;
        if (target) {
          void loadFolder(target, false);
        }
        if (inboxPathRef.current) {
          void refreshInboxBadge(inboxPathRef.current);
        }
      });

      unlistenSync = await listen("mxplore:sync-cabinet", async () => {
        setPinnedFolders(loadPinnedFolders());
        const customInbox = loadCustomInboxPath();
        try {
          const resolved = await tauriApi.getOrCreateInboxDir(
            customInbox ?? undefined
          );
          inboxPathRef.current = resolved;
          setInboxPath(resolved);
          setInboxDraftPath(resolved);
          await refreshInboxBadge(resolved);
        } catch {
          // Ignore invalid custom path during sync
        }
      });

      unlistenDragEnded = await listen("mxplore:native-drag-ended", () => {
        const target = currentPathRef.current;
        if (target) {
          void loadFolder(target, false);
        }
        if (inboxPathRef.current) {
          void refreshInboxBadge(inboxPathRef.current);
        }
      });

      unlistenDrag = await getCurrentWebview().onDragDropEvent(async (event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setIsDragOver(true);
          const live = await tauriApi.getDragPointerState().catch(() => null);
          const hoveredFolder =
            live && live.inside
              ? findDropFolderAtLogicalPoint(live.x, live.y)
              : null;
          dragTargetRef.current = hoveredFolder;
          setDragTargetFolder(hoveredFolder);
        } else if (payload.type === "leave") {
          setIsDragOver(false);
          dragTargetRef.current = null;
          setDragTargetFolder(null);
        } else if (payload.type === "drop") {
          const live = await tauriApi.getDragPointerState().catch(() => null);
          const dropFolderFromPos =
            live && live.inside
              ? findDropFolderAtLogicalPoint(live.x, live.y)
              : null;
          const dest =
            dropFolderFromPos ??
            dragTargetRef.current ??
            currentPathRef.current;

          setIsDragOver(false);
          dragTargetRef.current = null;
          setDragTargetFolder(null);

          const droppedPaths = payload.paths;
          if (!dest || droppedPaths.length === 0) return;

          try {
            if (dropModeRef.current === "copy") {
              await tauriApi.copyItems(droppedPaths, dest);
              flashNotice(
                `Copied ${droppedPaths.length} ${
                  droppedPaths.length === 1 ? "item" : "items"
                } → ${getPathTitle(dest)}`
              );
            } else {
              await tauriApi.moveItems(droppedPaths, dest);
              flashNotice(
                `Moved ${droppedPaths.length} ${
                  droppedPaths.length === 1 ? "item" : "items"
                } → ${getPathTitle(dest)}`
              );
            }
            if (dest === currentPathRef.current) {
              await loadFolder(dest, false);
            } else if (currentPathRef.current) {
              await loadFolder(currentPathRef.current, false);
            }
            if (inboxPathRef.current) {
              await refreshInboxBadge(inboxPathRef.current);
            }
          } catch (err) {
            flashNotice(`Drop failed: ${String(err)}`);
          }
        }
      });
    };

    void setup();

    return () => {
      unlistenShown?.();
      unlistenSync?.();
      unlistenDrag?.();
      unlistenDragEnded?.();
    };
  }, [flashNotice, loadFolder, refreshInboxBadge]);

  // Press Escape to close Quick Cabinet when not typing in an input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      ) {
        return;
      }
      if (showQuickNote) {
        setShowQuickNote(false);
      } else if (showPinInput) {
        setShowPinInput(false);
      } else if (showInboxSettings) {
        setShowInboxSettings(false);
      } else if (classifyEntryPath) {
        setClassifyEntryPath(null);
      } else {
        void tauriApi.hideCabinet();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showQuickNote, showPinInput, showInboxSettings, classifyEntryPath]);

  const { inboxTab, essentialTabs, cloudTabs, customTabs, allQuickTabs } =
    useMemo(() => {
      const seen = new Set<string>();
      let inboxItem: QuickTab | null = null;
      const essentials: QuickTab[] = [];
      const clouds: QuickTab[] = [];
      const customs: QuickTab[] = [];

      if (inboxPath) {
        seen.add(inboxPath);
        inboxItem = {
          id: "inbox",
          label: "Inbox",
          path: inboxPath,
          kind: "inbox",
        };
      }
      if (specialPaths?.desktop && !seen.has(specialPaths.desktop)) {
        seen.add(specialPaths.desktop);
        essentials.push({
          id: "desktop",
          label: "Desktop",
          path: specialPaths.desktop,
          kind: "essential",
        });
      }
      if (specialPaths?.downloads && !seen.has(specialPaths.downloads)) {
        seen.add(specialPaths.downloads);
        essentials.push({
          id: "downloads",
          label: "Downloads",
          path: specialPaths.downloads,
          kind: "essential",
        });
      }
      if (specialPaths?.documents && !seen.has(specialPaths.documents)) {
        seen.add(specialPaths.documents);
        essentials.push({
          id: "documents",
          label: "Documents",
          path: specialPaths.documents,
          kind: "essential",
        });
      }
      if (specialPaths?.home && !seen.has(specialPaths.home)) {
        seen.add(specialPaths.home);
        essentials.push({
          id: "home",
          label: "Home",
          path: specialPaths.home,
          kind: "essential",
        });
      }
      for (const drive of specialPaths?.cloud_drives ?? []) {
        if (!seen.has(drive.path)) {
          seen.add(drive.path);
          clouds.push({
            id: `cloud-${drive.path}`,
            label: drive.name,
            path: drive.path,
            kind: "cloud",
          });
        }
      }
      for (const pinned of pinnedFolders) {
        if (!seen.has(pinned.path)) {
          seen.add(pinned.path);
          customs.push({
            id: `custom-${pinned.path}`,
            label: pinned.label,
            path: pinned.path,
            kind: "custom",
          });
        }
      }

      const combined: QuickTab[] = [
        ...(inboxItem ? [inboxItem] : []),
        ...essentials,
        ...clouds,
        ...customs,
      ];

      return {
        inboxTab: inboxItem,
        essentialTabs: essentials,
        cloudTabs: clouds,
        customTabs: customs,
        allQuickTabs: combined,
      };
    }, [inboxPath, specialPaths, pinnedFolders]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.name.toLowerCase().includes(q));
  }, [entries, searchQuery]);

  const isViewingInbox = Boolean(inboxPath && currentPath === inboxPath);
  const canGoUp = Boolean(currentPath && getParentPath(currentPath));
  const isCurrentAlreadyPinned = allQuickTabs.some(
    (t) => t.path === currentPath
  );

  const handleToggleWindowPin = async () => {
    const next = !isWindowPinned;
    setIsWindowPinned(next);
    await tauriApi.setCabinetPinned(next);
    flashNotice(
      next ? "Pinned on top (won't auto-hide)" : "Auto-hide enabled"
    );
  };

  const handleSelectQuickTab = (path: string) => {
    setHistory([]);
    setSearchQuery("");
    void loadFolder(path, false);
  };

  const handleGoBack = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    void loadFolder(prev, false);
  };

  const handleGoUp = () => {
    const parent = getParentPath(currentPath);
    if (parent && parent !== currentPath) {
      void loadFolder(parent, true);
    }
  };

  const handleOpenEntry = async (entry: FileEntry) => {
    if (entry.is_dir && !entry.name.toLowerCase().endsWith(".app")) {
      void loadFolder(entry.path, true);
      return;
    }
    try {
      await tauriApi.openItem(entry.path);
    } catch (err) {
      flashNotice(`Open failed: ${String(err)}`);
    }
  };

  const handleSaveQuickNote = async () => {
    if (!currentPath || (!noteTitle.trim() && !noteContent.trim())) return;
    try {
      const created = await tauriApi.createQuickNote(
        currentPath,
        noteTitle.trim() || null,
        noteContent
      );
      setNoteTitle("");
      setNoteContent("");
      setShowQuickNote(false);
      await loadFolder(currentPath, false);
      if (inboxPath) await refreshInboxBadge(inboxPath);
      flashNotice(`Saved "${created.name}"`);
    } catch (err) {
      flashNotice(`Save failed: ${String(err)}`);
    }
  };

  const handleQuickNewFolder = async () => {
    if (!currentPath) return;
    const uniqueName = generateUniqueName(
      entries.map((e) => e.name),
      "New folder"
    );
    try {
      const created = await tauriApi.createDirectory(
        joinPath(currentPath, uniqueName)
      );
      await loadFolder(currentPath, false);
      if (inboxPath) await refreshInboxBadge(inboxPath);
      flashNotice(`Created "${created.name}"`);
    } catch (err) {
      flashNotice(`Create folder failed: ${String(err)}`);
    }
  };

  const handleAddPinnedFolder = async (rawPath: string) => {
    const normalized = normalizePath(rawPath, specialPaths?.home);
    if (!normalized) return;
    try {
      await tauriApi.readDirEntries(normalized, false);
      const existing = loadPinnedFolders();
      if (!existing.some((f) => f.path === normalized)) {
        const next: PinnedCabinetFolder[] = [
          ...existing,
          {
            path: normalized,
            label: getPathTitle(normalized, specialPaths?.home),
          },
        ];
        savePinnedFolders(next);
        setPinnedFolders(next);
        await tauriApi.notifyCabinetSync();
        flashNotice(`Pinned "${getPathTitle(normalized)}"`);
      }
      setPinDraftPath("");
      setShowPinInput(false);
      void loadFolder(normalized, false);
    } catch (err) {
      flashNotice(`Invalid folder: ${String(err)}`);
    }
  };

  const handleUnpinFolder = async (pathToRemove: string) => {
    const next = pinnedFolders.filter((f) => f.path !== pathToRemove);
    savePinnedFolders(next);
    setPinnedFolders(next);
    await tauriApi.notifyCabinetSync();
    flashNotice("Unpinned folder");
  };

  const handleSaveInboxPath = async () => {
    const trimmed = inboxDraftPath.trim();
    try {
      const resolved = await tauriApi.getOrCreateInboxDir(trimmed || undefined);
      saveCustomInboxPath(trimmed || null);
      inboxPathRef.current = resolved;
      setInboxPath(resolved);
      setInboxDraftPath(resolved);
      setShowInboxSettings(false);
      await tauriApi.notifyCabinetSync();
      await loadFolder(resolved, false);
      await refreshInboxBadge(resolved);
      flashNotice(`Inbox set to "${getPathTitle(resolved)}"`);
    } catch (err) {
      flashNotice(`Invalid Inbox path: ${String(err)}`);
    }
  };

  const handleClassifyMove = async (entry: FileEntry, destPath: string) => {
    setClassifyEntryPath(null);
    if (destPath === currentPath) return;
    try {
      await tauriApi.moveItems([entry.path], destPath);
      await loadFolder(currentPath, false);
      if (inboxPath) await refreshInboxBadge(inboxPath);
      flashNotice(`Moved "${entry.name}" → ${getPathTitle(destPath)}`);
    } catch (err) {
      flashNotice(`Move failed: ${String(err)}`);
    }
  };

  const handleDeleteEntry = async (entry: FileEntry) => {
    try {
      await tauriApi.deleteItems([entry.path]);
      await loadFolder(currentPath, false);
      if (inboxPath) await refreshInboxBadge(inboxPath);
      flashNotice(`Moved "${entry.name}" to Trash`);
    } catch (err) {
      flashNotice(`Delete failed: ${String(err)}`);
    }
  };

  const renderTabIcon = (tab: QuickTab) => {
    if (tab.kind === "inbox") {
      return (
        <Inbox
          size={14}
          className="shrink-0 text-amber-500 dark:text-amber-400"
        />
      );
    }
    if (tab.id === "desktop") {
      return (
        <Monitor
          size={14}
          className="shrink-0 text-blue-600 dark:text-blue-400"
        />
      );
    }
    if (tab.id === "downloads") {
      return (
        <Download
          size={14}
          className="shrink-0 text-emerald-600 dark:text-emerald-400"
        />
      );
    }
    if (tab.id === "documents") {
      return (
        <FileText
          size={14}
          className="shrink-0 text-indigo-500 dark:text-indigo-400"
        />
      );
    }
    if (tab.id === "home") {
      return (
        <Home size={14} className="shrink-0 text-sky-600 dark:text-sky-400" />
      );
    }
    if (tab.kind === "cloud") {
      return (
        <Cloud size={14} className="shrink-0 text-sky-500 dark:text-sky-400" />
      );
    }
    return (
      <Folder
        size={14}
        className="shrink-0 fill-amber-400/90 text-amber-500 dark:fill-amber-400/85 dark:text-amber-300"
      />
    );
  };

  const renderSidebarItem = (tab: QuickTab) => {
    const isActive = currentPath === tab.path;
    const isDropHighlight = isDragOver && dragTargetFolder === tab.path;

    return (
      <div
        key={tab.id}
        data-drop-folder={tab.path}
        className={`group relative flex h-[30px] items-center rounded-[6px] text-[12px] transition-colors ${
          isDropHighlight
            ? "bg-[#0067c0]/18 font-semibold text-[#0067c0] ring-2 ring-[#0067c0] dark:bg-[#60cdff]/22 dark:text-[#60cdff] dark:ring-[#60cdff]"
            : isActive
              ? tab.kind === "inbox"
                ? "bg-amber-500/14 font-medium text-amber-700 dark:bg-amber-400/16 dark:text-amber-300"
                : "bg-black/[0.07] font-medium text-[#1a1a1a] dark:bg-white/[0.1] dark:text-white"
              : "text-[#2c2c2c] hover:bg-black/[0.045] dark:text-[#dcdcdc] dark:hover:bg-white/[0.06]"
        }`}
      >
        {isActive && !isDropHighlight && (
          <span
            className={`absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full ${
              tab.kind === "inbox"
                ? "bg-amber-500 dark:bg-amber-400"
                : "bg-[#0067c0] dark:bg-[#60cdff]"
            }`}
          />
        )}

        <button
          type="button"
          title={
            tab.kind === "inbox"
              ? `Inbox chưa phân loại (${tab.path})`
              : tab.path
          }
          onClick={() => handleSelectQuickTab(tab.path)}
          className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left"
        >
          {renderTabIcon(tab)}
          <span className="min-w-0 flex-1 truncate">{tab.label}</span>
          {tab.kind === "inbox" && inboxCount > 0 && (
            <span className="shrink-0 rounded-full bg-amber-500/20 px-1.5 text-[10px] font-semibold tabular-nums text-amber-700 dark:bg-amber-400/20 dark:text-amber-300">
              {inboxCount}
            </span>
          )}
        </button>

        {tab.kind === "custom" && (
          <button
            type="button"
            title={`Unpin ${tab.label}`}
            onClick={(e) => {
              e.stopPropagation();
              void handleUnpinFolder(tab.path);
            }}
            className="mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/[0.1] dark:hover:bg-white/[0.14]"
          >
            <X size={10} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      className="relative flex h-full w-full flex-col overflow-hidden rounded-[10px] border border-black/[0.12] bg-[#f9fafc] text-[#1a1a1a] select-none dark:border-white/[0.12] dark:bg-[#202020] dark:text-[#f3f3f3]"
    >
      {/* Header Bar (Draggable) */}
      <header
        data-tauri-drag-region
        className="flex h-[38px] shrink-0 items-center justify-between border-b border-black/[0.08] bg-white px-3 dark:border-white/[0.08] dark:bg-[#2a2a2a]"
      >
        <div
          data-tauri-drag-region
          className="flex min-w-0 items-center gap-2"
        >
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400">
            <Inbox size={13} />
          </div>
          <span
            data-tauri-drag-region
            className="truncate text-[12.5px] font-semibold"
          >
            MXplore Quick Cabinet
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void handleToggleWindowPin()}
            title={
              isWindowPinned
                ? "Pinned (stays open while dragging files) — click for Auto-hide"
                : "Auto-hide active — click to Pin on top"
            }
            className={`flex h-7 items-center gap-1 rounded-[5px] px-1.5 text-[11px] transition-colors ${
              isWindowPinned
                ? "bg-[#0067c0]/12 font-medium text-[#0067c0] dark:bg-[#60cdff]/16 dark:text-[#60cdff]"
                : "text-neutral-500 hover:bg-black/[0.06] dark:text-neutral-400 dark:hover:bg-white/[0.08]"
            }`}
          >
            {isWindowPinned ? <Pin size={12} /> : <PinOff size={12} />}
            <span>{isWindowPinned ? "Pinned" : "Auto-hide"}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (currentPath) {
                void tauriApi.openPathInMain(currentPath);
              }
            }}
            title="Open current folder in MXplore"
            className="flex h-7 w-7 items-center justify-center rounded-[5px] text-neutral-500 transition-colors hover:bg-black/[0.06] hover:text-[#1a1a1a] dark:text-neutral-400 dark:hover:bg-white/[0.08] dark:hover:text-white"
          >
            <Maximize2 size={13} />
          </button>
          <button
            type="button"
            onClick={() => void tauriApi.hideCabinet()}
            title="Hide Quick Cabinet (Esc)"
            className="flex h-7 w-7 items-center justify-center rounded-[5px] text-neutral-500 transition-colors hover:bg-black/[0.06] hover:text-[#1a1a1a] dark:text-neutral-400 dark:hover:bg-white/[0.08] dark:hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      {/* Main Split: Left Target Folders Sidebar + Right Content Area */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left Sidebar: Target Folders (also direct Drag-and-Drop targets!) */}
        <aside className="flex w-[166px] shrink-0 flex-col border-r border-black/[0.08] bg-[#f3f5f8] dark:border-white/[0.08] dark:bg-[#242424]">
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-2 py-2">
            {/* Unsorted Data Inbox */}
            {inboxTab && (
              <div>
                <div className="mb-1 flex items-center justify-between px-2 text-[10px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                  <span>Unsorted</span>
                  <button
                    type="button"
                    onClick={() => {
                      handleSelectQuickTab(inboxTab.path);
                      setShowInboxSettings((v) => !v);
                    }}
                    title="Configure Inbox folder path"
                    className="rounded p-0.5 text-neutral-400 hover:bg-black/[0.06] hover:text-neutral-700 dark:hover:bg-white/[0.08] dark:hover:text-neutral-200"
                  >
                    <Settings2 size={11} />
                  </button>
                </div>
                {renderSidebarItem(inboxTab)}
              </div>
            )}

            {/* Quick Access Essentials */}
            {essentialTabs.length > 0 && (
              <div>
                <div className="mb-1 px-2 text-[10px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                  Folders
                </div>
                <div className="space-y-0.5">
                  {essentialTabs.map(renderSidebarItem)}
                </div>
              </div>
            )}

            {/* Cloud Drives */}
            {cloudTabs.length > 0 && (
              <div className="border-t border-black/[0.06] pt-2 dark:border-white/[0.06]">
                <div className="mb-1 px-2 text-[10px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                  Cloud
                </div>
                <div className="space-y-0.5">
                  {cloudTabs.map(renderSidebarItem)}
                </div>
              </div>
            )}

            {/* Custom Pinned Folders */}
            {customTabs.length > 0 && (
              <div className="border-t border-black/[0.06] pt-2 dark:border-white/[0.06]">
                <div className="mb-1 px-2 text-[10px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                  Pinned
                </div>
                <div className="space-y-0.5">
                  {customTabs.map(renderSidebarItem)}
                </div>
              </div>
            )}
          </div>

          {/* Bottom Pin / Add Folder Button */}
          <div className="shrink-0 border-t border-black/[0.07] p-2 dark:border-white/[0.07]">
            {showPinInput ? (
              <div className="space-y-1.5">
                <input
                  type="text"
                  value={pinDraftPath}
                  onChange={(e) => setPinDraftPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      void handleAddPinnedFolder(pinDraftPath);
                    if (e.key === "Escape") setShowPinInput(false);
                  }}
                  placeholder="~/Folder path..."
                  autoFocus
                  spellCheck={false}
                  className="h-[26px] w-full rounded-[5px] border border-black/[0.12] bg-white px-2 text-[11.5px] outline-none focus:border-[#0067c0] dark:border-white/[0.12] dark:bg-[#1a1a1a] dark:focus:border-[#60cdff]"
                />
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void handleAddPinnedFolder(pinDraftPath)}
                    className="flex h-[24px] flex-1 items-center justify-center gap-1 rounded-[5px] bg-[#0067c0] text-[11px] font-medium text-white hover:bg-[#005aa8] dark:bg-[#60cdff] dark:text-[#141414]"
                  >
                    <Check size={11} />
                    <span>Pin</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPinInput(false)}
                    className="flex h-[24px] items-center justify-center rounded-[5px] px-2 text-[11px] text-neutral-500 hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                  >
                    <X size={11} />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (currentPath && !isCurrentAlreadyPinned) {
                    void handleAddPinnedFolder(currentPath);
                  } else {
                    setPinDraftPath(currentPath || specialPaths?.home || "");
                    setShowPinInput(true);
                  }
                }}
                title={
                  currentPath && !isCurrentAlreadyPinned
                    ? `Pin "${getPathTitle(currentPath)}" to sidebar`
                    : "Pin a custom folder path"
                }
                className="flex h-[28px] w-full items-center justify-center gap-1.5 rounded-[6px] border border-dashed border-black/[0.16] text-[11.5px] text-neutral-500 transition-colors hover:border-[#0067c0] hover:text-[#0067c0] dark:border-white/[0.18] dark:text-neutral-400 dark:hover:border-[#60cdff] dark:hover:text-[#60cdff]"
              >
                <Plus size={12} />
                <span className="truncate">
                  {currentPath && !isCurrentAlreadyPinned
                    ? "Pin current"
                    : "Add folder"}
                </span>
              </button>
            )}
          </div>
        </aside>

        {/* Right Pane: Toolbar + File List + Drop Overlay */}
        <div className="relative flex min-w-0 flex-1 flex-col bg-white dark:bg-[#191919]">
          {/* Inbox Unsorted Banner + Folder Location Config */}
          {isViewingInbox && (
            <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/[0.07] px-2.5 py-1.5 dark:border-amber-400/15 dark:bg-amber-400/[0.07]">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate text-amber-800 dark:text-amber-300">
                  <strong>Inbox (Chưa phân loại)</strong> — Kéo thả file vào đây hoặc vào folder bên trái
                </span>
              </div>
              {showInboxSettings && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <input
                    type="text"
                    value={inboxDraftPath}
                    onChange={(e) => setInboxDraftPath(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSaveInboxPath();
                      if (e.key === "Escape") setShowInboxSettings(false);
                    }}
                    placeholder="~/MXplore Inbox"
                    spellCheck={false}
                    className="h-[25px] min-w-0 flex-1 rounded-[5px] border border-amber-500/40 bg-white px-2 text-[11.5px] outline-none dark:bg-[#1e1e1e]"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSaveInboxPath()}
                    className="h-[25px] rounded-[5px] bg-amber-600 px-2 text-[11px] font-medium text-white hover:bg-amber-700 dark:bg-amber-400 dark:text-[#1a1a1a]"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Mini Navigation + Search + Quick Actions Bar */}
          <div className="flex shrink-0 items-center gap-1 border-b border-black/[0.08] bg-[#f9fafc] px-2 py-1.5 dark:border-white/[0.08] dark:bg-[#262626]">
            <button
              type="button"
              disabled={history.length === 0}
              onClick={handleGoBack}
              title="Back"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] text-neutral-600 hover:bg-black/[0.06] disabled:opacity-35 dark:text-neutral-300 dark:hover:bg-white/[0.08]"
            >
              <ArrowLeft size={13} />
            </button>
            <button
              type="button"
              disabled={!canGoUp}
              onClick={handleGoUp}
              title="Up"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] text-neutral-600 hover:bg-black/[0.06] disabled:opacity-35 dark:text-neutral-300 dark:hover:bg-white/[0.08]"
            >
              <ArrowUp size={13} />
            </button>

            <div className="flex h-[27px] min-w-0 flex-1 items-center gap-1.5 rounded-[6px] border border-black/[0.08] bg-white px-2 focus-within:border-[#0067c0] dark:border-white/[0.08] dark:bg-[#1e1e1e] dark:focus-within:border-[#60cdff]">
              <Search size={12} className="shrink-0 text-neutral-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Filter ${getPathTitle(currentPath)}...`}
                spellCheck={false}
                className="h-full min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                >
                  <X size={11} />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowQuickNote((v) => !v)}
              title="Quick Note (save unsorted text/links)"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] transition-colors ${
                showQuickNote
                  ? "bg-[#0067c0]/14 text-[#0067c0] dark:bg-[#60cdff]/18 dark:text-[#60cdff]"
                  : "text-neutral-600 hover:bg-black/[0.06] dark:text-neutral-300 dark:hover:bg-white/[0.08]"
              }`}
            >
              <StickyNote size={13} />
            </button>
            <button
              type="button"
              onClick={() => void handleQuickNewFolder()}
              title="New folder here"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] text-amber-600 hover:bg-black/[0.06] dark:text-amber-400 dark:hover:bg-white/[0.08]"
            >
              <FolderPlus size={14} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (currentPath) void loadFolder(currentPath, false);
              }}
              title="Refresh"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] text-neutral-600 hover:bg-black/[0.06] dark:text-neutral-300 dark:hover:bg-white/[0.08]"
            >
              <RotateCw size={13} className={isLoading ? "animate-spin" : ""} />
            </button>
          </div>

          {/* Inline Quick Note Composer */}
          {showQuickNote && (
            <div className="shrink-0 space-y-1.5 border-b border-black/[0.08] bg-[#f3f5f8] p-2.5 dark:border-white/[0.08] dark:bg-[#242424]">
              <input
                type="text"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder="Note title (optional — auto-timestamped .md)"
                className="h-[26px] w-full rounded-[5px] border border-black/[0.1] bg-white px-2 text-[12px] outline-none focus:border-[#0067c0] dark:border-white/[0.1] dark:bg-[#1a1a1a] dark:focus:border-[#60cdff]"
              />
              <textarea
                rows={3}
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="Paste quick notes, links, or unsorted snippets..."
                autoFocus
                className="w-full resize-none rounded-[5px] border border-black/[0.1] bg-white p-2 text-[12px] outline-none focus:border-[#0067c0] dark:border-white/[0.1] dark:bg-[#1a1a1a] dark:focus:border-[#60cdff]"
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowQuickNote(false)}
                  className="h-[25px] rounded-[5px] px-2.5 text-[11.5px] text-neutral-500 hover:bg-black/[0.06] dark:text-neutral-400 dark:hover:bg-white/[0.08]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!noteTitle.trim() && !noteContent.trim()}
                  onClick={() => void handleSaveQuickNote()}
                  className="h-[25px] rounded-[5px] bg-[#0067c0] px-3 text-[11.5px] font-medium text-white hover:bg-[#005aa8] disabled:opacity-45 dark:bg-[#60cdff] dark:text-[#141414]"
                >
                  Save to {getPathTitle(currentPath)}
                </button>
              </div>
            </div>
          )}

          {/* File List Body */}
          <div className="relative min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
            {isLoading && entries.length === 0 ? (
              <div className="flex h-full items-center justify-center gap-2 text-[12.5px] text-neutral-400">
                <Loader2 size={15} className="animate-spin" />
                <span>Loading...</span>
              </div>
            ) : error ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-[12px] text-amber-600 dark:text-amber-400">
                <span>{error}</span>
              </div>
            ) : filteredEntries.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center text-neutral-400 dark:text-neutral-500">
                {isViewingInbox ? (
                  <>
                    <Inbox
                      size={30}
                      strokeWidth={1.5}
                      className="text-amber-500/60"
                    />
                    <div className="text-[12.5px] font-medium text-neutral-500 dark:text-neutral-400">
                      Inbox trống — chưa có dữ liệu cần phân loại
                    </div>
                    <p className="text-[11.5px]">
                      Kéo thả file từ Desktop vào đây hoặc trực tiếp vào bất kỳ thư mục nào ở cột bên trái.
                    </p>
                  </>
                ) : (
                  <span className="text-[12.5px]">
                    {searchQuery
                      ? `No items match "${searchQuery}"`
                      : "This folder is empty."}
                  </span>
                )}
              </div>
            ) : (
              <div className="space-y-0.5">
                {filteredEntries.map((entry) => {
                  const isClassifying = classifyEntryPath === entry.path;
                  return (
                    <div key={entry.path}>
                      <div
                        data-drop-folder={
                          entry.is_dir &&
                          !entry.name.toLowerCase().endsWith(".app")
                            ? entry.path
                            : undefined
                        }
                        onMouseDown={(e) => {
                          if (e.button !== 0 || e.detail >= 2) return;
                          const startX = e.clientX;
                          const startY = e.clientY;
                          const cleanup = () => {
                            window.removeEventListener("mousemove", onMove);
                            window.removeEventListener("mouseup", cleanup);
                            window.removeEventListener("blur", cleanup);
                          };
                          const onMove = (ev: MouseEvent) => {
                            if ((ev.buttons & 1) === 0) {
                              cleanup();
                              return;
                            }
                            if (
                              Math.hypot(
                                ev.clientX - startX,
                                ev.clientY - startY
                              ) < 5
                            ) {
                              return;
                            }
                            cleanup();
                            void tauriApi.startNativeDrag([entry.path]);
                          };
                          window.addEventListener("mousemove", onMove);
                          window.addEventListener("mouseup", cleanup);
                          window.addEventListener("blur", cleanup);
                        }}
                        onDoubleClick={() => void handleOpenEntry(entry)}
                        title={entry.path}
                        className={`group flex h-[36px] cursor-default items-center gap-2 rounded-[6px] px-2 text-[12.5px] transition-colors ${
                          dragTargetFolder === entry.path
                            ? "bg-[#0067c0]/18 ring-2 ring-inset ring-[#0067c0] dark:bg-[#60cdff]/20 dark:ring-[#60cdff]"
                            : "hover:bg-black/[0.05] dark:hover:bg-white/[0.06]"
                        }`}
                      >
                        <FileIcon entry={entry} size={16} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate leading-tight">
                            {entry.name}
                          </div>
                          <div className="truncate text-[10.5px] text-neutral-400 dark:text-neutral-500">
                            {entry.is_dir
                              ? formatModifiedDate(entry.modified_timestamp)
                              : `${formatFileSize(
                                  entry.size
                                )} • ${formatModifiedDate(
                                  entry.modified_timestamp
                                )}`}
                          </div>
                        </div>

                        {/* Hover Quick Actions */}
                        <div
                          onMouseDown={(e) => e.stopPropagation()}
                          className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void tauriApi.quicklookItem(entry.path);
                            }}
                            title="Quick Look"
                            className="flex h-6 w-6 items-center justify-center rounded-[4px] text-neutral-500 hover:bg-black/[0.08] hover:text-[#1a1a1a] dark:text-neutral-400 dark:hover:bg-white/[0.12] dark:hover:text-white"
                          >
                            <Eye size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setClassifyEntryPath((prev) =>
                                prev === entry.path ? null : entry.path
                              );
                            }}
                            title="Move / Classify to folder..."
                            className={`flex h-6 w-6 items-center justify-center rounded-[4px] transition-colors ${
                              isClassifying
                                ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                                : "text-amber-600 hover:bg-amber-500/15 dark:text-amber-400"
                            }`}
                          >
                            <FolderOutput size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void tauriApi.revealInFinder(entry.path);
                            }}
                            title="Reveal in Finder"
                            className="flex h-6 w-6 items-center justify-center rounded-[4px] text-neutral-500 hover:bg-black/[0.08] hover:text-[#1a1a1a] dark:text-neutral-400 dark:hover:bg-white/[0.12] dark:hover:text-white"
                          >
                            <Search size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteEntry(entry);
                            }}
                            title="Move to Trash"
                            className="flex h-6 w-6 items-center justify-center rounded-[4px] text-red-500 hover:bg-red-500/12"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>

                      {/* 1-Click Classify / Move Strip */}
                      {isClassifying && (
                        <div className="mx-2 mb-1.5 flex flex-wrap items-center gap-1 rounded-[6px] border border-black/[0.08] bg-[#f3f5f8] p-1.5 text-[11px] dark:border-white/[0.08] dark:bg-[#252525]">
                          <span className="mr-1 font-medium text-neutral-500 dark:text-neutral-400">
                            Move to:
                          </span>
                          {allQuickTabs
                            .filter((t) => t.path !== currentPath)
                            .map((dest) => (
                              <button
                                key={dest.id}
                                type="button"
                                onClick={() =>
                                  void handleClassifyMove(entry, dest.path)
                                }
                                className="flex items-center gap-1 rounded-[4px] border border-black/[0.08] bg-white px-2 py-0.5 text-[#1f1f1f] hover:border-[#0067c0] hover:text-[#0067c0] dark:border-white/[0.1] dark:bg-[#303030] dark:text-[#ececec] dark:hover:border-[#60cdff] dark:hover:text-[#60cdff]"
                              >
                                {renderTabIcon(dest)}
                                <span className="max-w-[96px] truncate">
                                  {dest.label}
                                </span>
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Native OS Drag-and-Drop Overlay (shown on right pane when not hovering a specific left sidebar target) */}
            {isDragOver && !dragTargetFolder && (
              <div className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-[8px] border-2 border-dashed border-[#0067c0] bg-[#0067c0]/12 text-[#0067c0] backdrop-blur-[2px] dark:border-[#60cdff] dark:bg-[#60cdff]/14 dark:text-[#60cdff]">
                <Upload size={26} />
                <div className="px-4 text-center text-[12.5px] font-semibold">
                  Drop files to {dropMode === "copy" ? "copy" : "move"} into{" "}
                  {getPathTitle(currentPath)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Compact Footer Status Bar */}
      <footer className="flex h-[28px] shrink-0 items-center justify-between gap-2 border-t border-black/[0.08] bg-[#f3f5f8] px-3 text-[11px] text-neutral-500 dark:border-white/[0.08] dark:bg-[#242424] dark:text-neutral-400">
        <span className="min-w-0 flex-1 truncate" title={currentPath}>
          {statusNotice ??
            (isDragOver && dragTargetFolder
              ? `Release to ${dropMode} into "${getPathTitle(dragTargetFolder)}"`
              : `${filteredEntries.length} ${
                  filteredEntries.length === 1 ? "item" : "items"
                } • ${currentPath}`)}
        </span>
        <button
          type="button"
          onClick={() => setDropMode((m) => (m === "move" ? "copy" : "move"))}
          title="Toggle drag-and-drop behavior (Move vs Copy)"
          className="shrink-0 rounded-[4px] border border-black/[0.08] bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-[#2c2c2c] hover:border-[#0067c0] dark:border-white/[0.1] dark:bg-[#2e2e2e] dark:text-[#dcdcdc] dark:hover:border-[#60cdff]"
        >
          Drop: {dropMode === "move" ? "Move" : "Copy"}
        </button>
      </footer>
    </div>
  );
}
