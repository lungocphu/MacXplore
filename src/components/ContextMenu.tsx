import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CheckSquare,
  ChevronRight,
  ClipboardCopy,
  ClipboardPaste,
  Cloud,
  Columns2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileArchive,
  FileCode2,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderOutput,
  FolderPlus,
  FolderSearch,
  Grid2x2,
  Inbox,
  LayoutGrid,
  LayoutList,
  List,
  Monitor,
  Network,
  Pencil,
  Pin,
  PinOff,
  Redo2,
  RotateCw,
  Scissors,
  Search,
  Terminal,
  Trash2,
  Undo2,
} from "lucide-react";
import { tauriApi } from "../lib/tauriApi";
import {
  isFolderPinnedInStorage,
  loadCustomInboxPath,
  togglePinnedFolderInStorage,
} from "../lib/cabinetStorage";
import {
  isZipFileEntry,
  isZipVirtualPath,
  splitZipVirtualPath,
} from "../lib/format";
import {
  useActivePane,
  useExplorerStore,
  usePane,
  type TransferMode,
  type ViewMode,
} from "../store/useExplorerStore";

interface MenuRowProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  bold?: boolean;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  hasSubmenu?: boolean;
  isSubmenuOpen?: boolean;
  onClick: () => void;
  onMouseEnter?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseLeave?: () => void;
}

function MenuRow({
  icon,
  label,
  shortcut,
  bold = false,
  danger = false,
  disabled = false,
  checked = false,
  hasSubmenu = false,
  isSubmenuOpen = false,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: MenuRowProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`flex h-[30px] w-full items-center gap-2.5 rounded-[5px] px-2.5 text-left text-[12.5px] transition-colors ${
        disabled
          ? "cursor-default text-neutral-400 dark:text-neutral-600"
          : danger
            ? "text-red-600 hover:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/15"
            : isSubmenuOpen
              ? "bg-black/[0.06] text-[#1f1f1f] dark:bg-white/[0.09] dark:text-[#ffffff]"
              : "text-[#1f1f1f] hover:bg-black/[0.06] dark:text-[#f0f0f0] dark:hover:bg-white/[0.08]"
      } ${bold ? "font-semibold" : ""}`}
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {checked && (
        <Check
          size={13}
          className="shrink-0 text-[#0067c0] dark:text-[#60cdff]"
        />
      )}
      {hasSubmenu && (
        <ChevronRight
          size={13}
          className="ml-2 shrink-0 text-neutral-400 dark:text-neutral-500"
        />
      )}
      {shortcut && !checked && !hasSubmenu && (
        <span className="ml-4 shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">
          {shortcut}
        </span>
      )}
    </button>
  );
}

function MenuDivider() {
  return <div className="my-1 h-[1px] bg-black/[0.08] dark:bg-white/[0.08]" />;
}

interface QuickDestination {
  label: string;
  path: string;
  icon: React.ReactNode;
  group: "pane" | "quick" | "tab";
}

type ActiveSubmenuType = TransferMode | "view" | null;

const VIEW_MENU_ITEMS: Array<{
  mode: ViewMode;
  label: string;
  icon: React.ReactNode;
}> = [
  { mode: "large-icons", label: "Large icons", icon: <Grid2x2 size={14} /> },
  {
    mode: "medium-icons",
    label: "Medium icons",
    icon: <LayoutGrid size={14} />,
  },
  { mode: "list", label: "List", icon: <List size={14} /> },
  { mode: "details", label: "Details", icon: <LayoutList size={14} /> },
];

export function ContextMenu() {
  const contextMenu = useExplorerStore((s) => s.contextMenu);
  const tabs = useExplorerStore((s) => s.tabs);
  const activeTabId = useExplorerStore((s) => s.activeTabId);
  const dualPane = useExplorerStore((s) => s.dualPane);
  const activePane = useActivePane();
  const leftPane = usePane("left");
  const rightPane = usePane("right");
  const otherPane = activePane.paneId === "left" ? rightPane : leftPane;

  const specialPaths = useExplorerStore((s) => s.specialPaths);
  const networkDrives = useExplorerStore((s) => s.networkDrives);
  const clipboard = useExplorerStore((s) => s.clipboard);
  const viewMode = useExplorerStore((s) => s.viewMode);
  const showHidden = useExplorerStore((s) => s.showHidden);
  const showCheckboxes = useExplorerStore((s) => s.showCheckboxes);
  const undoStack = useExplorerStore((s) => s.undoStack);
  const redoStack = useExplorerStore((s) => s.redoStack);
  const isUndoing = useExplorerStore((s) => s.isUndoing);

  const closeContextMenu = useExplorerStore((s) => s.closeContextMenu);
  const openEntry = useExplorerStore((s) => s.openEntry);
  const addTab = useExplorerStore((s) => s.addTab);
  const cutSelected = useExplorerStore((s) => s.cutSelected);
  const copySelected = useExplorerStore((s) => s.copySelected);
  const pasteClipboard = useExplorerStore((s) => s.pasteClipboard);
  const startRenaming = useExplorerStore((s) => s.startRenaming);
  const deleteSelected = useExplorerStore((s) => s.deleteSelected);
  const createNewFolder = useExplorerStore((s) => s.createNewFolder);
  const createNewFile = useExplorerStore((s) => s.createNewFile);
  const copyPathToClipboard = useExplorerStore((s) => s.copyPathToClipboard);
  const copyOrMoveToDestination = useExplorerStore(
    (s) => s.copyOrMoveToDestination
  );
  const openDestinationModal = useExplorerStore((s) => s.openDestinationModal);
  const extractZipAll = useExplorerStore((s) => s.extractZipAll);
  const quicklookSelected = useExplorerStore((s) => s.quicklookSelected);
  const revealInFinder = useExplorerStore((s) => s.revealInFinder);
  const openInTerminal = useExplorerStore((s) => s.openInTerminal);
  const undoLastAction = useExplorerStore((s) => s.undoLastAction);
  const redoLastAction = useExplorerStore((s) => s.redoLastAction);
  const showToast = useExplorerStore((s) => s.showToast);
  const refresh = useExplorerStore((s) => s.refresh);
  const setViewMode = useExplorerStore((s) => s.setViewMode);
  const toggleShowHidden = useExplorerStore((s) => s.toggleShowHidden);
  const toggleShowCheckboxes = useExplorerStore((s) => s.toggleShowCheckboxes);

  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const closeSubmenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [activeSubmenu, setActiveSubmenu] = useState<ActiveSubmenuType>(null);
  const [submenuAnchorTop, setSubmenuAnchorTop] = useState(0);
  const [submenuPosition, setSubmenuPosition] = useState({ left: 0, top: 0 });

  // Reset submenu whenever context menu opens/closes or changes position
  useEffect(() => {
    setActiveSubmenu(null);
    if (closeSubmenuTimerRef.current) {
      clearTimeout(closeSubmenuTimerRef.current);
      closeSubmenuTimerRef.current = null;
    }
  }, [contextMenu]);

  useLayoutEffect(() => {
    if (!contextMenu) return;
    const el = menuRef.current;
    const menuWidth = el?.offsetWidth ?? 232;
    const menuHeight = el?.offsetHeight ?? 360;
    const padding = 8;

    const left = Math.min(
      contextMenu.x,
      Math.max(padding, window.innerWidth - menuWidth - padding)
    );
    const top = Math.min(
      contextMenu.y,
      Math.max(padding, window.innerHeight - menuHeight - padding)
    );
    setPosition({ left, top });
  }, [contextMenu]);

  useLayoutEffect(() => {
    if (!activeSubmenu || !menuRef.current) return;
    const mainRect = menuRef.current.getBoundingClientRect();
    const subWidth = submenuRef.current?.offsetWidth ?? 248;
    const subHeight = submenuRef.current?.offsetHeight ?? 260;
    const padding = 8;

    let left = mainRect.right - 2;
    if (left + subWidth > window.innerWidth - padding) {
      left = Math.max(padding, mainRect.left - subWidth + 2);
    }

    const top = Math.min(
      Math.max(padding, submenuAnchorTop - 4),
      Math.max(padding, window.innerHeight - subHeight - padding)
    );

    setSubmenuPosition({ left, top });
  }, [activeSubmenu, submenuAnchorTop, position]);

  useEffect(() => {
    if (!contextMenu) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideMain = menuRef.current?.contains(target) ?? false;
      const insideSub = submenuRef.current?.contains(target) ?? false;
      if (!insideMain && !insideSub) {
        closeContextMenu();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeContextMenu();
      }
    };
    const handleDismiss = () => closeContextMenu();

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleDismiss);
    window.addEventListener("resize", handleDismiss);

    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleDismiss);
      window.removeEventListener("resize", handleDismiss);
    };
  }, [contextMenu, closeContextMenu]);

  const { paneDestination, quickDestinations, tabDestinations } = useMemo(() => {
    const seen = new Set<string>();
    let otherPaneDest: QuickDestination | null = null;

    if (
      dualPane &&
      otherPane.currentPath &&
      otherPane.currentPath !== activePane.currentPath
    ) {
      seen.add(otherPane.currentPath);
      otherPaneDest = {
        label: `Other Pane (${otherPane.title})`,
        path: otherPane.currentPath,
        icon: (
          <Columns2
            size={14}
            className="text-[#0067c0] dark:text-[#60cdff]"
          />
        ),
        group: "pane",
      };
    }

    const quick: QuickDestination[] = [];
    if (specialPaths?.desktop && !seen.has(specialPaths.desktop)) {
      seen.add(specialPaths.desktop);
      quick.push({
        label: "Desktop",
        path: specialPaths.desktop,
        icon: (
          <Monitor size={14} className="text-blue-600 dark:text-blue-400" />
        ),
        group: "quick",
      });
    }
    if (specialPaths?.documents && !seen.has(specialPaths.documents)) {
      seen.add(specialPaths.documents);
      quick.push({
        label: "Documents",
        path: specialPaths.documents,
        icon: (
          <FileText
            size={14}
            className="text-indigo-500 dark:text-indigo-400"
          />
        ),
        group: "quick",
      });
    }
    if (specialPaths?.downloads && !seen.has(specialPaths.downloads)) {
      seen.add(specialPaths.downloads);
      quick.push({
        label: "Downloads",
        path: specialPaths.downloads,
        icon: (
          <Download
            size={14}
            className="text-emerald-600 dark:text-emerald-400"
          />
        ),
        group: "quick",
      });
    }
    for (const drive of specialPaths?.cloud_drives ?? []) {
      if (!seen.has(drive.path)) {
        seen.add(drive.path);
        quick.push({
          label: drive.name,
          path: drive.path,
          icon: <Cloud size={14} className="text-sky-500 dark:text-sky-400" />,
          group: "quick",
        });
      }
    }
    for (const drive of networkDrives) {
      if (!seen.has(drive.path) && drive.path !== activePane.currentPath) {
        seen.add(drive.path);
        quick.push({
          label: `${drive.name} (${drive.protocol})`,
          path: drive.path,
          icon: (
            <Network size={14} className="text-teal-600 dark:text-teal-400" />
          ),
          group: "quick",
        });
      }
    }

    const otherTabs: QuickDestination[] = [];
    for (const tab of tabs) {
      if (tab.id === activeTabId && activePane.paneId === "left") continue;
      if (tab.currentPath === activePane.currentPath) continue;
      if (seen.has(tab.currentPath)) continue;
      seen.add(tab.currentPath);
      otherTabs.push({
        label: tab.title,
        path: tab.currentPath,
        icon: (
          <Folder
            size={14}
            className="fill-amber-400/90 text-amber-500 dark:fill-amber-400/85 dark:text-amber-300"
          />
        ),
        group: "tab",
      });
    }

    return {
      paneDestination: otherPaneDest,
      quickDestinations: quick,
      tabDestinations: otherTabs,
    };
  }, [
    dualPane,
    otherPane.currentPath,
    otherPane.title,
    activePane.currentPath,
    activePane.paneId,
    specialPaths,
    networkDrives,
    tabs,
    activeTabId,
  ]);

  if (!contextMenu) return null;

  const { targetEntry, paneId } = contextMenu;
  const canPaste = clipboard.action !== null && clipboard.paths.length > 0;
  const canRename = activePane.selectedPaths.length === 1;
  const lastUndo = undoStack[undoStack.length - 1];
  const lastRedo = redoStack[redoStack.length - 1];
  const isFolderTarget =
    targetEntry !== null &&
    targetEntry.is_dir &&
    !targetEntry.name.toLowerCase().endsWith(".app");

  const cancelSubmenuClose = () => {
    if (closeSubmenuTimerRef.current) {
      clearTimeout(closeSubmenuTimerRef.current);
      closeSubmenuTimerRef.current = null;
    }
  };

  const scheduleSubmenuClose = () => {
    cancelSubmenuClose();
    closeSubmenuTimerRef.current = setTimeout(() => {
      setActiveSubmenu(null);
    }, 150);
  };

  const openSubmenuFor = (
    submenu: ActiveSubmenuType,
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    cancelSubmenuClose();
    const rect = e.currentTarget.getBoundingClientRect();
    setSubmenuAnchorTop(rect.top);
    setActiveSubmenu(submenu);
  };

  const clearSubmenuImmediately = () => {
    cancelSubmenuClose();
    setActiveSubmenu(null);
  };

  const runAndClose = (fn: () => void | Promise<void>) => {
    closeContextMenu();
    void fn();
  };

  const handleQuickTransfer = (mode: TransferMode, destPath: string) => {
    const sources =
      activePane.selectedPaths.length > 0
        ? [...activePane.selectedPaths]
        : targetEntry
          ? [targetEntry.path]
          : [];
    closeContextMenu();
    if (sources.length > 0) {
      void copyOrMoveToDestination(mode, sources, destPath);
    }
  };

  const handleChooseLocation = (mode: TransferMode) => {
    const sources =
      activePane.selectedPaths.length > 0
        ? [...activePane.selectedPaths]
        : targetEntry
          ? [targetEntry.path]
          : [];
    openDestinationModal(mode, sources);
  };

  const handleSendToInbox = async () => {
    const sources =
      activePane.selectedPaths.length > 0
        ? [...activePane.selectedPaths]
        : targetEntry
          ? [targetEntry.path]
          : [];
    closeContextMenu();
    if (sources.length === 0) return;

    try {
      const customInbox = loadCustomInboxPath();
      const targetInbox = await tauriApi.getOrCreateInboxDir(
        customInbox ?? undefined
      );
      await copyOrMoveToDestination("move", sources, targetInbox);
      await tauriApi.notifyCabinetSync();
    } catch (err) {
      showToast(`Send to Inbox failed: ${String(err)}`, "error");
    }
  };

  const handleTogglePinFolder = async (
    folderPath: string,
    folderName: string
  ) => {
    closeContextMenu();
    const { pinned } = togglePinnedFolderInStorage(
      folderPath,
      specialPaths?.home
    );
    await tauriApi.notifyCabinetSync();
    showToast(
      pinned
        ? `Pinned "${folderName}" to Quick Cabinet`
        : `Unpinned "${folderName}" from Quick Cabinet`,
      "info"
    );
  };

  const isTargetPinned =
    isFolderTarget && targetEntry && !isZipVirtualPath(targetEntry.path)
      ? isFolderPinnedInStorage(targetEntry.path, specialPaths?.home)
      : false;
  const isInZip = isZipVirtualPath(activePane.currentPath);
  const activeZipInfo = splitZipVirtualPath(activePane.currentPath);
  const isZipTarget =
    targetEntry !== null && !isInZip && isZipFileEntry(targetEntry);

  return (
    <>
      <div
        ref={menuRef}
        role="menu"
        onContextMenu={(e) => e.preventDefault()}
        style={{ left: position.left, top: position.top }}
        className="fixed z-50 min-w-[232px] rounded-[8px] border border-black/[0.1] bg-white/95 p-1 shadow-[0_8px_28px_rgba(0,0,0,0.18)] backdrop-blur-xl select-none dark:border-white/[0.12] dark:bg-[#2b2b2b]/95 dark:shadow-[0_10px_32px_rgba(0,0,0,0.48)]"
      >
        {targetEntry && isInZip ? (
          <>
            <MenuRow
              icon={
                isFolderTarget ? (
                  <FolderOpen size={14} className="text-amber-500" />
                ) : (
                  <ExternalLink size={14} />
                )
              }
              label="Open"
              shortcut="Enter"
              bold
              onMouseEnter={clearSubmenuImmediately}
              onClick={() => runAndClose(() => openEntry(targetEntry, paneId))}
            />
            {isFolderTarget && (
              <MenuRow
                icon={<FolderPlus size={14} className="text-sky-500" />}
                label="Open in New Tab"
                onMouseEnter={clearSubmenuImmediately}
                onClick={() => runAndClose(() => addTab(targetEntry.path))}
              />
            )}
            {!isFolderTarget && (
              <MenuRow
                icon={
                  <Eye size={14} className="text-sky-600 dark:text-sky-400" />
                }
                label="Quick Look"
                shortcut="Space"
                disabled={!canRename}
                onMouseEnter={clearSubmenuImmediately}
                onClick={() =>
                  runAndClose(() => quicklookSelected(targetEntry.path))
                }
              />
            )}

            <MenuDivider />

            <MenuRow
              icon={<Copy size={14} />}
              label="Copy"
              shortcut="⌘C"
              onMouseEnter={clearSubmenuImmediately}
              onClick={() => runAndClose(copySelected)}
            />
            <MenuRow
              icon={
                <FolderInput
                  size={14}
                  className="text-sky-600 dark:text-sky-400"
                />
              }
              label="Extract To"
              hasSubmenu
              isSubmenuOpen={activeSubmenu === "copy"}
              onMouseEnter={(e) => openSubmenuFor("copy", e)}
              onMouseLeave={scheduleSubmenuClose}
              onClick={() => handleChooseLocation("copy")}
            />
            {activeZipInfo && (
              <MenuRow
                icon={
                  <FileArchive
                    size={14}
                    className="text-amber-600 dark:text-amber-400"
                  />
                }
                label="Extract All..."
                onMouseEnter={clearSubmenuImmediately}
                onClick={() =>
                  runAndClose(() => extractZipAll(activeZipInfo.zipPath))
                }
              />
            )}
            <MenuRow
              icon={<ClipboardCopy size={14} />}
              label={
                activePane.selectedPaths.length > 1
                  ? "Copy Paths"
                  : "Copy Path"
              }
              onMouseEnter={clearSubmenuImmediately}
              onClick={() => runAndClose(() => copyPathToClipboard())}
            />
          </>
        ) : targetEntry ? (
          <>
            <MenuRow
              icon={
                isFolderTarget ? (
                  <FolderOpen size={14} className="text-amber-500" />
                ) : isZipTarget ? (
                  <FileArchive size={14} className="text-amber-600" />
                ) : (
                  <ExternalLink size={14} />
                )
              }
              label="Open"
              shortcut="Enter"
              bold
              onMouseEnter={clearSubmenuImmediately}
              onClick={() => runAndClose(() => openEntry(targetEntry, paneId))}
            />
            {(isFolderTarget || isZipTarget) && (
              <MenuRow
                icon={<FolderPlus size={14} className="text-sky-500" />}
                label="Open in New Tab"
                onMouseEnter={clearSubmenuImmediately}
                onClick={() =>
                  runAndClose(() =>
                    addTab(
                      isZipTarget ? `${targetEntry.path}::` : targetEntry.path
                    )
                  )
                }
              />
            )}
            {isZipTarget && (
              <MenuRow
                icon={
                  <FolderOutput
                    size={14}
                    className="text-amber-600 dark:text-amber-400"
                  />
                }
                label="Extract All..."
                onMouseEnter={clearSubmenuImmediately}
                onClick={() =>
                  runAndClose(() => extractZipAll(targetEntry.path))
                }
              />
            )}
            <MenuRow
              icon={<Eye size={14} className="text-sky-600 dark:text-sky-400" />}
              label="Quick Look"
              shortcut="Space"
              disabled={!canRename}
              onMouseEnter={clearSubmenuImmediately}
              onClick={() =>
                runAndClose(() => quicklookSelected(targetEntry.path))
              }
            />
            <MenuRow
              icon={<Search size={14} />}
              label="Reveal in Finder"
              onMouseEnter={clearSubmenuImmediately}
              onClick={() =>
                runAndClose(() => revealInFinder(targetEntry.path))
              }
            />
            {isFolderTarget && (
              <MenuRow
                icon={<Terminal size={14} />}
                label="Open in Terminal"
                onMouseEnter={clearSubmenuImmediately}
                onClick={() =>
                  runAndClose(() => openInTerminal(targetEntry.path))
                }
              />
            )}

            <MenuDivider />

            <MenuRow
              icon={<Scissors size={14} />}
              label="Cut"
              shortcut="⌘X"
              onMouseEnter={clearSubmenuImmediately}
              onClick={() => runAndClose(cutSelected)}
            />
            <MenuRow
              icon={<Copy size={14} />}
              label="Copy"
              shortcut="⌘C"
              onMouseEnter={clearSubmenuImmediately}
              onClick={() => runAndClose(copySelected)}
            />
            {canPaste && (
              <MenuRow
                icon={<ClipboardPaste size={14} />}
                label="Paste"
                shortcut="⌘V"
                onMouseEnter={clearSubmenuImmediately}
                onClick={() => runAndClose(pasteClipboard)}
              />
            )}

            {/* Copy To / Move To Hover Submenu Triggers */}
            <MenuRow
              icon={
                <FolderInput
                  size={14}
                  className="text-sky-600 dark:text-sky-400"
                />
              }
              label="Copy To"
              hasSubmenu
              isSubmenuOpen={activeSubmenu === "copy"}
              onMouseEnter={(e) => openSubmenuFor("copy", e)}
              onMouseLeave={scheduleSubmenuClose}
              onClick={() => handleChooseLocation("copy")}
            />
            <MenuRow
              icon={
                <FolderOutput
                  size={14}
                  className="text-amber-600 dark:text-amber-400"
                />
              }
              label="Move To"
              hasSubmenu
              isSubmenuOpen={activeSubmenu === "move"}
              onMouseEnter={(e) => openSubmenuFor("move", e)}
              onMouseLeave={scheduleSubmenuClose}
              onClick={() => handleChooseLocation("move")}
            />
            <MenuRow
              icon={
                <Inbox
                  size={14}
                  className="text-amber-500 dark:text-amber-400"
                />
              }
              label="Send to Inbox (Unsorted)"
              onMouseEnter={clearSubmenuImmediately}
              onClick={() => void handleSendToInbox()}
            />
            {isFolderTarget && (
              <MenuRow
                icon={
                  isTargetPinned ? (
                    <PinOff size={14} className="text-neutral-500" />
                  ) : (
                    <Pin
                      size={14}
                      className="text-[#0067c0] dark:text-[#60cdff]"
                    />
                  )
                }
                label={
                  isTargetPinned
                    ? "Unpin from Quick Cabinet"
                    : "Pin to Quick Cabinet"
                }
                onMouseEnter={clearSubmenuImmediately}
                onClick={() =>
                  void handleTogglePinFolder(targetEntry.path, targetEntry.name)
                }
              />
            )}

            <MenuRow
              icon={<ClipboardCopy size={14} />}
              label={
                activePane.selectedPaths.length > 1
                  ? "Copy Paths"
                  : "Copy Path"
              }
              onMouseEnter={clearSubmenuImmediately}
              onClick={() => runAndClose(() => copyPathToClipboard())}
            />

            <MenuDivider />

            <MenuRow
              icon={<Pencil size={14} />}
              label="Rename"
              shortcut="F2"
              disabled={!canRename}
              onMouseEnter={clearSubmenuImmediately}
              onClick={() =>
                runAndClose(() => startRenaming(targetEntry.path, paneId))
              }
            />
            <MenuRow
              icon={<Trash2 size={14} />}
              label="Delete"
              shortcut="⌘⌫"
              danger
              onMouseEnter={clearSubmenuImmediately}
              onClick={() => runAndClose(deleteSelected)}
            />

            <MenuDivider />

            <MenuRow
              icon={<FolderPlus size={14} className="text-amber-500" />}
              label="New Folder"
              onMouseEnter={clearSubmenuImmediately}
              onClick={() => runAndClose(createNewFolder)}
            />
            <MenuRow
              icon={<FileText size={14} className="text-blue-500" />}
              label="New Text File (.txt)"
              onMouseEnter={clearSubmenuImmediately}
              onClick={() =>
                runAndClose(() => createNewFile("New Text Document", "txt"))
              }
            />
            <MenuRow
              icon={<FileCode2 size={14} className="text-sky-500" />}
              label="New Markdown (.md)"
              onMouseEnter={clearSubmenuImmediately}
              onClick={() =>
                runAndClose(() => createNewFile("New Document", "md"))
              }
            />
          </>
        ) : isInZip ? (
          <>
            {activeZipInfo && (
              <MenuRow
                icon={
                  <FolderOutput
                    size={14}
                    className="text-amber-600 dark:text-amber-400"
                  />
                }
                label="Extract All..."
                bold
                onMouseEnter={clearSubmenuImmediately}
                onClick={() =>
                  runAndClose(() => extractZipAll(activeZipInfo.zipPath))
                }
              />
            )}
            <MenuRow
              icon={<Search size={14} />}
              label="Reveal ZIP in Finder"
              onMouseEnter={clearSubmenuImmediately}
              onClick={() =>
                runAndClose(() => revealInFinder(activePane.currentPath))
              }
            />
            <MenuRow
              icon={<ClipboardCopy size={14} />}
              label="Copy Path"
              onMouseEnter={clearSubmenuImmediately}
              onClick={() =>
                runAndClose(() => copyPathToClipboard([activePane.currentPath]))
              }
            />

            <MenuDivider />

            <MenuRow
              icon={<LayoutGrid size={14} />}
              label="View"
              hasSubmenu
              isSubmenuOpen={activeSubmenu === "view"}
              onMouseEnter={(e) => openSubmenuFor("view", e)}
              onMouseLeave={scheduleSubmenuClose}
              onClick={() => {}}
            />
            <MenuRow
              icon={<CheckSquare size={14} />}
              label="Item check boxes"
              checked={showCheckboxes}
              onMouseEnter={clearSubmenuImmediately}
              onClick={() => runAndClose(toggleShowCheckboxes)}
            />
            <MenuRow
              icon={<Eye size={14} />}
              label="Show hidden items"
              checked={showHidden}
              onMouseEnter={clearSubmenuImmediately}
              onClick={() => runAndClose(toggleShowHidden)}
            />
            <MenuRow
              icon={<RotateCw size={14} />}
              label="Refresh"
              shortcut="⌘R"
              onMouseEnter={clearSubmenuImmediately}
              onClick={() => runAndClose(() => refresh(paneId))}
            />
          </>
        ) : (
          <>
            <MenuRow
              icon={<FolderPlus size={14} className="text-amber-500" />}
              label="New Folder"
              shortcut="⌘⇧N"
              onMouseEnter={clearSubmenuImmediately}
              onClick={() => runAndClose(createNewFolder)}
            />
            <MenuRow
              icon={<FileText size={14} className="text-blue-500" />}
              label="New Text File (.txt)"
              onMouseEnter={clearSubmenuImmediately}
              onClick={() =>
                runAndClose(() => createNewFile("New Text Document", "txt"))
              }
            />
            <MenuRow
              icon={<FileCode2 size={14} className="text-sky-500" />}
              label="New Markdown (.md)"
              onMouseEnter={clearSubmenuImmediately}
              onClick={() =>
                runAndClose(() => createNewFile("New Document", "md"))
              }
            />

            <MenuDivider />

            <MenuRow
              icon={<ClipboardPaste size={14} />}
              label="Paste"
              shortcut="⌘V"
              disabled={!canPaste}
              onMouseEnter={clearSubmenuImmediately}
              onClick={() => runAndClose(pasteClipboard)}
            />
            <MenuRow
              icon={<Undo2 size={14} />}
              label={lastUndo ? `Undo ${lastUndo.label}` : "Undo"}
              shortcut="⌘Z"
              disabled={!lastUndo || isUndoing}
              onMouseEnter={clearSubmenuImmediately}
              onClick={() => runAndClose(undoLastAction)}
            />
            {lastRedo && (
              <MenuRow
                icon={<Redo2 size={14} />}
                label={`Redo ${lastRedo.label}`}
                shortcut="⇧⌘Z"
                disabled={isUndoing}
                onMouseEnter={clearSubmenuImmediately}
                onClick={() => runAndClose(redoLastAction)}
              />
            )}
            <MenuRow
              icon={<ClipboardCopy size={14} />}
              label="Copy Path"
              onMouseEnter={clearSubmenuImmediately}
              onClick={() =>
                runAndClose(() => copyPathToClipboard([activePane.currentPath]))
              }
            />
            <MenuRow
              icon={<Terminal size={14} />}
              label="Open in Terminal"
              onMouseEnter={clearSubmenuImmediately}
              onClick={() =>
                runAndClose(() => openInTerminal(activePane.currentPath))
              }
            />
            <MenuRow
              icon={<Search size={14} />}
              label="Reveal in Finder"
              onMouseEnter={clearSubmenuImmediately}
              onClick={() =>
                runAndClose(() => revealInFinder(activePane.currentPath))
              }
            />

            <MenuDivider />

            <MenuRow
              icon={<LayoutGrid size={14} />}
              label="View"
              hasSubmenu
              isSubmenuOpen={activeSubmenu === "view"}
              onMouseEnter={(e) => openSubmenuFor("view", e)}
              onMouseLeave={scheduleSubmenuClose}
              onClick={() => {}}
            />
            <MenuRow
              icon={<CheckSquare size={14} />}
              label="Item check boxes"
              checked={showCheckboxes}
              onMouseEnter={clearSubmenuImmediately}
              onClick={() => runAndClose(toggleShowCheckboxes)}
            />
            <MenuRow
              icon={<Eye size={14} />}
              label="Show hidden items"
              checked={showHidden}
              onMouseEnter={clearSubmenuImmediately}
              onClick={() => runAndClose(toggleShowHidden)}
            />
            <MenuRow
              icon={<RotateCw size={14} />}
              label="Refresh"
              shortcut="⌘R"
              onMouseEnter={clearSubmenuImmediately}
              onClick={() => runAndClose(() => refresh(paneId))}
            />
          </>
        )}
      </div>

      {/* Floating Submenu for Copy To / Move To */}
      {targetEntry && (activeSubmenu === "copy" || activeSubmenu === "move") && (
        <div
          ref={submenuRef}
          role="menu"
          onContextMenu={(e) => e.preventDefault()}
          onMouseEnter={cancelSubmenuClose}
          onMouseLeave={scheduleSubmenuClose}
          style={{ left: submenuPosition.left, top: submenuPosition.top }}
          className="fixed z-50 min-w-[244px] max-w-[300px] rounded-[8px] border border-black/[0.1] bg-white/95 p-1 shadow-[0_10px_30px_rgba(0,0,0,0.2)] backdrop-blur-xl select-none dark:border-white/[0.12] dark:bg-[#2b2b2b]/95 dark:shadow-[0_12px_36px_rgba(0,0,0,0.52)]"
        >
          {paneDestination && (
            <>
              <div className="px-2.5 pt-1 pb-0.5 text-[10.5px] font-semibold tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
                Split View
              </div>
              <button
                type="button"
                title={paneDestination.path}
                onClick={() =>
                  handleQuickTransfer(activeSubmenu, paneDestination.path)
                }
                className="flex h-[30px] w-full items-center gap-2.5 rounded-[5px] px-2.5 text-left text-[12.5px] font-medium text-[#0067c0] transition-colors hover:bg-[#0067c0]/10 dark:text-[#60cdff] dark:hover:bg-[#60cdff]/14"
              >
                <span className="flex w-4 shrink-0 items-center justify-center">
                  {paneDestination.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {paneDestination.label}
                </span>
              </button>
              <MenuDivider />
            </>
          )}

          {quickDestinations.length > 0 && (
            <>
              <div className="px-2.5 pt-1 pb-0.5 text-[10.5px] font-semibold tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
                Quick destinations
              </div>
              {quickDestinations.map((dest) => (
                <button
                  key={dest.path}
                  type="button"
                  title={dest.path}
                  onClick={() => handleQuickTransfer(activeSubmenu, dest.path)}
                  className="flex h-[30px] w-full items-center gap-2.5 rounded-[5px] px-2.5 text-left text-[12.5px] text-[#1f1f1f] transition-colors hover:bg-black/[0.06] dark:text-[#f0f0f0] dark:hover:bg-white/[0.08]"
                >
                  <span className="flex w-4 shrink-0 items-center justify-center">
                    {dest.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{dest.label}</span>
                </button>
              ))}
            </>
          )}

          {tabDestinations.length > 0 && (
            <>
              <MenuDivider />
              <div className="px-2.5 pt-0.5 pb-0.5 text-[10.5px] font-semibold tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
                Open tabs
              </div>
              {tabDestinations.map((dest) => (
                <button
                  key={dest.path}
                  type="button"
                  title={dest.path}
                  onClick={() => handleQuickTransfer(activeSubmenu, dest.path)}
                  className="flex h-[30px] w-full items-center gap-2.5 rounded-[5px] px-2.5 text-left text-[12.5px] text-[#1f1f1f] transition-colors hover:bg-black/[0.06] dark:text-[#f0f0f0] dark:hover:bg-white/[0.08]"
                >
                  <span className="flex w-4 shrink-0 items-center justify-center">
                    {dest.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{dest.label}</span>
                </button>
              ))}
            </>
          )}

          <MenuDivider />

          <MenuRow
            icon={
              <FolderSearch
                size={14}
                className="text-[#0067c0] dark:text-[#60cdff]"
              />
            }
            label="Choose Location..."
            bold
            onClick={() => handleChooseLocation(activeSubmenu)}
          />
        </div>
      )}

      {/* Floating Submenu for Background View Options */}
      {!targetEntry && activeSubmenu === "view" && (
        <div
          ref={submenuRef}
          role="menu"
          onContextMenu={(e) => e.preventDefault()}
          onMouseEnter={cancelSubmenuClose}
          onMouseLeave={scheduleSubmenuClose}
          style={{ left: submenuPosition.left, top: submenuPosition.top }}
          className="fixed z-50 min-w-[196px] rounded-[8px] border border-black/[0.1] bg-white/95 p-1 shadow-[0_10px_30px_rgba(0,0,0,0.2)] backdrop-blur-xl select-none dark:border-white/[0.12] dark:bg-[#2b2b2b]/95 dark:shadow-[0_12px_36px_rgba(0,0,0,0.52)]"
        >
          {VIEW_MENU_ITEMS.map((item) => (
            <MenuRow
              key={item.mode}
              icon={item.icon}
              label={item.label}
              checked={viewMode === item.mode}
              onClick={() => runAndClose(() => setViewMode(item.mode))}
            />
          ))}
        </div>
      )}
    </>
  );
}
