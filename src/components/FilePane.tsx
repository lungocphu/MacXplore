import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  FileArchive,
  FolderOpen,
  FolderOutput,
  Loader2,
  Minus,
  RotateCw,
  Search,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import type { FileEntry } from "../lib/tauriApi";
import {
  formatFileSize,
  formatModifiedDate,
  getFileTypeLabel,
  getParentPath,
  getPathTitle,
  getRenameSelectionEnd,
  getVisibleEntries,
  isZipFileEntry,
  isZipVirtualPath,
  splitZipVirtualPath,
} from "../lib/format";
import {
  useExplorerStore,
  usePane,
  type PaneId,
  type SortField,
} from "../store/useExplorerStore";
import { AddressBar } from "./AddressBar";
import { FileIcon, FileThumbnail } from "./FileIcon";
import {
  FolderHoverPopup,
  type FolderHoverTarget,
} from "./FolderHoverPopup";

interface InlineRenameInputProps {
  entry: FileEntry;
  align?: "left" | "center";
}

function InlineRenameInput({
  entry,
  align = "left",
}: InlineRenameInputProps) {
  const commitRename = useExplorerStore((s) => s.commitRename);
  const cancelRenaming = useExplorerStore((s) => s.cancelRenaming);

  const [draft, setDraft] = useState(entry.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const selEnd = getRenameSelectionEnd(entry.name, entry.is_dir);
    input.setSelectionRange(0, selEnd);
  }, [entry.name, entry.is_dir]);

  const submit = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    void commitRename(entry.path, draft);
  };

  const cancel = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    cancelRenaming();
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onBlur={submit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      spellCheck={false}
      aria-label={`Rename ${entry.name}`}
      className={`w-full rounded-[4px] border border-[#0067c0] bg-white px-1.5 py-0.5 text-[12.5px] text-[#1a1a1a] outline-none ring-1 ring-[#0067c0]/30 selection:bg-[#0067c0]/25 dark:border-[#60cdff] dark:bg-[#1f1f1f] dark:text-white dark:ring-[#60cdff]/30 dark:selection:bg-[#60cdff]/30 ${
        align === "center" ? "text-center text-[12px]" : "text-left"
      }`}
    />
  );
}

interface SelectionCheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  ariaLabel: string;
  onToggle: (e: React.MouseEvent) => void;
  className?: string;
}

function SelectionCheckbox({
  checked,
  indeterminate = false,
  ariaLabel,
  onToggle,
  className = "",
}: SelectionCheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={ariaLabel}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(e);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
        checked || indeterminate
          ? "border-[#0067c0] bg-[#0067c0] text-white dark:border-[#60cdff] dark:bg-[#60cdff] dark:text-[#141414]"
          : "border-black/[0.28] bg-white/95 hover:border-[#0067c0] dark:border-white/[0.3] dark:bg-[#252525]/95 dark:hover:border-[#60cdff]"
      } ${className}`}
    >
      {checked ? (
        <Check size={11} strokeWidth={3} />
      ) : indeterminate ? (
        <Minus size={11} strokeWidth={3} />
      ) : null}
    </button>
  );
}

const DETAILS_ROW_HEIGHT = 32;
const LIST_COL_MIN_WIDTH = 220;
const LIST_ROW_HEIGHT = 28;
const MEDIUM_TILE_MIN_WIDTH = 116;
const MEDIUM_ROW_HEIGHT = 112;
const LARGE_TILE_MIN_WIDTH = 152;
const LARGE_ROW_HEIGHT = 158;

export interface FilePaneProps {
  paneId?: PaneId;
  showPaneHeader?: boolean;
  isActivePane?: boolean;
  isExternalDragOver?: boolean;
  onCloseSplit?: () => void;
}

export function FilePane({
  paneId = "left",
  showPaneHeader = false,
  isActivePane = true,
  isExternalDragOver = false,
  onCloseSplit,
}: FilePaneProps) {
  const pane = usePane(paneId);
  const viewMode = useExplorerStore((s) => s.viewMode);
  const showCheckboxes = useExplorerStore((s) => s.showCheckboxes);
  const dualPane = useExplorerStore((s) => s.dualPane);
  const activePane = useExplorerStore((s) => s.activePane);
  const sortField = useExplorerStore((s) => s.sortField);
  const sortDirection = useExplorerStore((s) => s.sortDirection);
  const clipboard = useExplorerStore((s) => s.clipboard);
  const renamingPath = useExplorerStore((s) => s.renamingPath);
  const renamingPaneId = useExplorerStore((s) => s.renamingPaneId);
  const contextMenu = useExplorerStore((s) => s.contextMenu);
  const destinationModal = useExplorerStore((s) => s.destinationModal);
  const isExtractingZip = useExplorerStore((s) => s.isExtractingZip);
  const draggingPaths = useExplorerStore((s) => s.draggingPaths);
  const dropTargetFolder = useExplorerStore((s) => s.dropTargetFolder);
  const dropCopyMode = useExplorerStore((s) => s.dropCopyMode);

  const setActivePane = useExplorerStore((s) => s.setActivePane);
  const openEntry = useExplorerStore((s) => s.openEntry);
  const addTab = useExplorerStore((s) => s.addTab);
  const navigateTo = useExplorerStore((s) => s.navigateTo);
  const extractZipAll = useExplorerStore((s) => s.extractZipAll);
  const beginNativeFileDrag = useExplorerStore((s) => s.beginNativeFileDrag);
  const goBack = useExplorerStore((s) => s.goBack);
  const goForward = useExplorerStore((s) => s.goForward);
  const goUp = useExplorerStore((s) => s.goUp);
  const refresh = useExplorerStore((s) => s.refresh);
  const setSelectedPaths = useExplorerStore((s) => s.setSelectedPaths);
  const toggleSelectPath = useExplorerStore((s) => s.toggleSelectPath);
  const toggleSelectAll = useExplorerStore((s) => s.toggleSelectAll);
  const clearSelection = useExplorerStore((s) => s.clearSelection);
  const setSearchQuery = useExplorerStore((s) => s.setSearchQuery);
  const runSpotlightSearch = useExplorerStore((s) => s.runSpotlightSearch);
  const clearSpotlightSearch = useExplorerStore((s) => s.clearSpotlightSearch);
  const setSort = useExplorerStore((s) => s.setSort);
  const openContextMenu = useExplorerStore((s) => s.openContextMenu);
  const closeContextMenu = useExplorerStore((s) => s.closeContextMenu);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const paneSearchInputRef = useRef<HTMLInputElement>(null);
  const didNativeDragRef = useRef(false);
  const [containerWidth, setContainerWidth] = useState(800);
  const [paneSearchOpen, setPaneSearchOpen] = useState(false);

  // Keep pane search input visible whenever there's an active query or spotlight search
  useEffect(() => {
    if (pane.searchQuery || pane.spotlightActive) {
      setPaneSearchOpen(true);
    }
  }, [pane.searchQuery, pane.spotlightActive]);

  useEffect(() => {
    if (paneSearchOpen && showPaneHeader) {
      paneSearchInputRef.current?.focus();
    }
  }, [paneSearchOpen, showPaneHeader]);

  // Folder size hover pop-up state
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverCoordsRef = useRef({ x: 0, y: 0 });
  const [hoverTarget, setHoverTarget] = useState<FolderHoverTarget | null>(null);

  const dismissFolderHover = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverTarget(null);
  };

  const handleFolderMouseEnter = (
    e: React.MouseEvent,
    entry: FileEntry
  ) => {
    if (
      !entry.is_dir ||
      isZipVirtualPath(entry.path) ||
      renamingPath !== null ||
      contextMenu !== null ||
      destinationModal !== null
    ) {
      dismissFolderHover();
      return;
    }

    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
    }
    hoverCoordsRef.current = { x: e.clientX, y: e.clientY };
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null;
      setHoverTarget({
        entry,
        x: hoverCoordsRef.current.x,
        y: hoverCoordsRef.current.y,
      });
    }, 360);
  };

  const handleFolderMouseMove = (
    e: React.MouseEvent,
    entry: FileEntry
  ) => {
    if (!entry.is_dir) return;
    hoverCoordsRef.current = { x: e.clientX, y: e.clientY };
    setHoverTarget((prev) =>
      prev && prev.entry.path === entry.path
        ? { ...prev, x: e.clientX, y: e.clientY }
        : prev
    );
  };

  // Clear hover pop-up on navigation, tab switch, modal/menu open, or unmount
  useEffect(() => {
    dismissFolderHover();
  }, [
    pane.tabId,
    pane.currentPath,
    renamingPath,
    contextMenu,
    destinationModal,
    viewMode,
  ]);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  // Measure container width so multi-column List & Grid views virtualize responsively
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const updateWidth = () => {
      setContainerWidth(Math.max(180, el.clientWidth - 16));
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const displayedEntries = useMemo(() => {
    if (pane.spotlightActive) {
      return getVisibleEntries(
        pane.spotlightResults,
        "",
        sortField,
        sortDirection
      );
    }
    return getVisibleEntries(
      pane.entries,
      pane.searchQuery,
      sortField,
      sortDirection
    );
  }, [
    pane.spotlightActive,
    pane.spotlightResults,
    pane.entries,
    pane.searchQuery,
    sortField,
    sortDirection,
  ]);

  const selectedSet = useMemo(
    () => new Set(pane.selectedPaths),
    [pane.selectedPaths]
  );

  const visibleSelectedCount = useMemo(() => {
    if (pane.selectedPaths.length === 0 || displayedEntries.length === 0) {
      return 0;
    }
    let count = 0;
    for (const entry of displayedEntries) {
      if (selectedSet.has(entry.path)) count += 1;
    }
    return count;
  }, [displayedEntries, pane.selectedPaths.length, selectedSet]);

  const allVisibleSelected =
    displayedEntries.length > 0 &&
    visibleSelectedCount === displayedEntries.length;
  const someVisibleSelected =
    visibleSelectedCount > 0 && visibleSelectedCount < displayedEntries.length;

  const cutSet = useMemo(() => {
    if (clipboard.action !== "cut" || clipboard.paths.length === 0) {
      return new Set<string>();
    }
    return new Set(clipboard.paths);
  }, [clipboard.action, clipboard.paths]);

  const draggingSet = useMemo(() => new Set(draggingPaths), [draggingPaths]);

  const columns = useMemo(() => {
    if (viewMode === "details") return 1;
    if (viewMode === "list") {
      return Math.max(1, Math.floor(containerWidth / LIST_COL_MIN_WIDTH));
    }
    if (viewMode === "medium-icons") {
      return Math.max(1, Math.floor(containerWidth / MEDIUM_TILE_MIN_WIDTH));
    }
    return Math.max(1, Math.floor(containerWidth / LARGE_TILE_MIN_WIDTH));
  }, [viewMode, containerWidth]);

  const rowHeight = useMemo(() => {
    switch (viewMode) {
      case "details":
        return DETAILS_ROW_HEIGHT;
      case "list":
        return LIST_ROW_HEIGHT;
      case "medium-icons":
        return MEDIUM_ROW_HEIGHT;
      case "large-icons":
        return LARGE_ROW_HEIGHT;
    }
  }, [viewMode]);

  const rowCount =
    viewMode === "details"
      ? displayedEntries.length
      : Math.ceil(displayedEntries.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => rowHeight,
    overscan: viewMode === "details" || viewMode === "list" ? 16 : 6,
  });

  // Reset scroll position to top when navigating to a different folder or switching tabs
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [pane.currentPath, pane.tabId]);

  // Recalculate cached virtual row heights whenever viewMode, rowHeight, or columns change
  useEffect(() => {
    virtualizer.measure();
  }, [viewMode, rowHeight, columns, virtualizer]);

  const isRenamingHere = renamingPaneId === paneId && renamingPath !== null;

  // Keep focused/single-selected item (e.g. ArrowUp/ArrowDown, New Folder, F2) scrolled into view
  const singleFocusPath =
    isRenamingHere && renamingPath
      ? renamingPath
      : pane.selectedPaths.length === 1
        ? pane.selectedPaths[0]
        : null;

  useEffect(() => {
    if (!singleFocusPath) return;
    const idx = displayedEntries.findIndex((e) => e.path === singleFocusPath);
    if (idx === -1) return;
    const targetRow =
      viewMode === "details" ? idx : Math.floor(idx / columns);
    virtualizer.scrollToIndex(targetRow, { align: "auto" });
  }, [
    singleFocusPath,
    displayedEntries,
    viewMode,
    columns,
    virtualizer,
  ]);

  const activateThisPane = () => {
    if (dualPane && activePane !== paneId) {
      setActivePane(paneId);
    }
  };

  const isBrowsableContainer = (entry: FileEntry) =>
    (entry.is_dir && !entry.name.toLowerCase().endsWith(".app")) ||
    isZipFileEntry(entry);

  const isRealDropFolder = (entry: FileEntry) =>
    entry.is_dir &&
    !entry.name.toLowerCase().endsWith(".app") &&
    !isZipVirtualPath(entry.path);

  const handleItemMouseDown = (e: React.MouseEvent, entry: FileEntry) => {
    // Middle-click on any folder or .zip archive opens it quickly in a new tab
    if (e.button === 1 && isBrowsableContainer(entry)) {
      e.preventDefault();
      e.stopPropagation();
      dismissFolderHover();
      closeContextMenu();
      const targetTabPath = isZipFileEntry(entry)
        ? `${entry.path}::`
        : entry.path;
      addTab(targetTabPath);
      return;
    }

    // Left-button press: arm native macOS Finder-style drag after 5px pointer movement
    if (e.button !== 0) return;
    if (isRenamingHere && renamingPath === entry.path) return;
    if (e.detail >= 2) return; // Don't arm drag on double-click

    const startX = e.clientX;
    const startY = e.clientY;
    didNativeDragRef.current = false;

    const cleanup = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("blur", handleUp);
    };

    const handleMove = (moveEv: MouseEvent) => {
      if ((moveEv.buttons & 1) === 0) {
        cleanup();
        return;
      }
      const dist = Math.hypot(
        moveEv.clientX - startX,
        moveEv.clientY - startY
      );
      if (dist < 5) return;

      cleanup();
      didNativeDragRef.current = true;
      dismissFolderHover();
      closeContextMenu();

      // Finder/Explorer convention: dragging a selected item drags the entire selection;
      // dragging an unselected item selects and drags just that item.
      const pathsToDrag = selectedSet.has(entry.path)
        ? [...pane.selectedPaths]
        : [entry.path];

      if (!selectedSet.has(entry.path)) {
        setSelectedPaths([entry.path], entry.path, paneId);
      }

      void beginNativeFileDrag(pathsToDrag);
    };

    const handleUp = () => {
      cleanup();
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("blur", handleUp);
  };

  const handleItemAuxClick = (e: React.MouseEvent, entry: FileEntry) => {
    if (e.button === 1 && isBrowsableContainer(entry)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleItemClick = (
    e: React.MouseEvent,
    entry: FileEntry,
    index: number
  ) => {
    e.stopPropagation();
    dismissFolderHover();
    closeContextMenu();

    if (didNativeDragRef.current) {
      didNativeDragRef.current = false;
      return;
    }

    if (isRenamingHere && renamingPath === entry.path) return;

    if (e.shiftKey && pane.lastSelectedPath) {
      const anchorIdx = displayedEntries.findIndex(
        (item) => item.path === pane.lastSelectedPath
      );
      if (anchorIdx !== -1) {
        const start = Math.min(anchorIdx, index);
        const end = Math.max(anchorIdx, index);
        const rangePaths = displayedEntries
          .slice(start, end + 1)
          .map((item) => item.path);
        setSelectedPaths(rangePaths, undefined, paneId);
        return;
      }
    }

    if (e.metaKey || e.ctrlKey) {
      toggleSelectPath(entry.path, paneId);
      return;
    }

    setSelectedPaths([entry.path], entry.path, paneId);
  };

  const handleItemContextMenu = (
    e: React.MouseEvent,
    entry: FileEntry
  ) => {
    e.preventDefault();
    e.stopPropagation();
    dismissFolderHover();

    // Keep multi-selection if right-clicking an already-selected item; otherwise select this item
    if (!selectedSet.has(entry.path)) {
      setSelectedPaths([entry.path], entry.path, paneId);
    }
    openContextMenu(e.clientX, e.clientY, entry, paneId);
  };

  const handleBackgroundContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearSelection(paneId);
    openContextMenu(e.clientX, e.clientY, null, paneId);
  };

  const handleBackgroundClick = () => {
    closeContextMenu();
    clearSelection(paneId);
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDirection === "asc" ? (
      <ArrowUp
        size={12}
        className="shrink-0 text-[#0067c0] dark:text-[#60cdff]"
      />
    ) : (
      <ArrowDown
        size={12}
        className="shrink-0 text-[#0067c0] dark:text-[#60cdff]"
      />
    );
  };

  const zipContext = useMemo(
    () => splitZipVirtualPath(pane.currentPath),
    [pane.currentPath]
  );

  // Responsive Details view columns (gracefully adapts when Dual Pane narrows a pane)
  const isCompactDetails = containerWidth < 520;
  const detailsGridCols = showCheckboxes
    ? isCompactDetails
      ? "grid-cols-[26px_minmax(130px,1fr)_104px_70px]"
      : "grid-cols-[28px_minmax(200px,1fr)_144px_138px_90px]"
    : isCompactDetails
      ? "grid-cols-[minmax(140px,1fr)_110px_72px]"
      : "grid-cols-[minmax(220px,1fr)_150px_150px_96px]";

  const canGoBack = pane.historyIndex > 0;
  const canGoForward = pane.historyIndex < pane.history.length - 1;
  const canGoUp = getParentPath(pane.currentPath || "/") !== null;

  const paneNavBtnClass = (enabled: boolean) =>
    `flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[4px] transition-colors ${
      enabled
        ? "text-[#1f1f1f] hover:bg-black/[0.06] active:bg-black/[0.1] dark:text-[#ececec] dark:hover:bg-white/[0.08] dark:active:bg-white/[0.12]"
        : "cursor-default text-[#a3a3a3] dark:text-[#5c5c5c]"
    }`;

  const renderPaneHeader = () => {
    if (!showPaneHeader) return null;

    return (
      <div
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        className={`flex shrink-0 flex-col border-b transition-colors select-none ${
          isActivePane
            ? "border-[#0067c0]/25 bg-[#f4f8fc] dark:border-[#60cdff]/25 dark:bg-[#252a30]"
            : "border-black/[0.08] bg-[#f7f8fa] dark:border-white/[0.08] dark:bg-[#222222]"
        }`}
      >
        {/* Subtle top accent indicator showing which pane is active */}
        <div
          className={`h-[2px] w-full transition-colors ${
            isActivePane
              ? "bg-[#0067c0] dark:bg-[#60cdff]"
              : "bg-transparent"
          }`}
        />
        <div className="flex h-[38px] items-center gap-1.5 px-2">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => goBack(paneId)}
              disabled={!canGoBack}
              title="Back (⌘[)"
              aria-label="Back"
              className={paneNavBtnClass(canGoBack)}
            >
              <ArrowLeft size={14} strokeWidth={1.9} />
            </button>
            <button
              type="button"
              onClick={() => goForward(paneId)}
              disabled={!canGoForward}
              title="Forward (⌘])"
              aria-label="Forward"
              className={paneNavBtnClass(canGoForward)}
            >
              <ArrowRight size={14} strokeWidth={1.9} />
            </button>
            <button
              type="button"
              onClick={() => goUp(paneId)}
              disabled={!canGoUp}
              title="Up one level (⌘↑)"
              aria-label="Up one level"
              className={paneNavBtnClass(canGoUp)}
            >
              <ArrowUp size={14} strokeWidth={1.9} />
            </button>
            <button
              type="button"
              onClick={() => void refresh(paneId)}
              title="Refresh (⌘R)"
              aria-label="Refresh"
              className={paneNavBtnClass(true)}
            >
              <RotateCw
                size={13}
                strokeWidth={1.9}
                className={
                  pane.isLoading || pane.isSearching ? "animate-spin" : ""
                }
              />
            </button>
          </div>

          <AddressBar paneId={paneId} compact />

          {paneSearchOpen ? (
            <div
              className={`flex h-[28px] w-[148px] shrink-0 items-center gap-1 rounded-[5px] border px-2 transition-colors ${
                pane.spotlightActive
                  ? "border-[#0067c0]/60 bg-white dark:border-[#60cdff]/60 dark:bg-[#1f1f1f]"
                  : "border-black/[0.08] bg-white focus-within:border-[#0067c0] dark:border-white/[0.1] dark:bg-[#1f1f1f] dark:focus-within:border-[#60cdff]"
              }`}
            >
              {pane.isSearching ? (
                <Loader2
                  size={12}
                  className="shrink-0 animate-spin text-[#0067c0] dark:text-[#60cdff]"
                />
              ) : pane.spotlightActive ? (
                <Sparkles
                  size={12}
                  className="shrink-0 text-[#0067c0] dark:text-[#60cdff]"
                />
              ) : (
                <Search
                  size={12}
                  className="shrink-0 text-neutral-400 dark:text-neutral-500"
                />
              )}
              <input
                ref={paneSearchInputRef}
                type="text"
                value={pane.searchQuery}
                onChange={(e) => setSearchQuery(e.target.value, paneId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runSpotlightSearch(pane.searchQuery, paneId);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    clearSpotlightSearch(paneId);
                    setPaneSearchOpen(false);
                  }
                }}
                onBlur={() => {
                  if (!pane.searchQuery && !pane.spotlightActive) {
                    setPaneSearchOpen(false);
                  }
                }}
                placeholder="Filter / ↵"
                spellCheck={false}
                aria-label={`Search ${pane.title}`}
                className="h-full min-w-0 flex-1 bg-transparent text-[11.5px] text-[#1a1a1a] placeholder:text-neutral-400 outline-none dark:text-[#f3f3f3] dark:placeholder:text-neutral-500"
              />
              <button
                type="button"
                onClick={() => {
                  clearSpotlightSearch(paneId);
                  setPaneSearchOpen(false);
                }}
                aria-label="Clear search"
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-black/[0.06] hover:text-neutral-700 dark:hover:bg-white/[0.1] dark:hover:text-neutral-200"
              >
                <X size={10} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPaneSearchOpen(true)}
              title={`Search ${pane.title}`}
              aria-label={`Search ${pane.title}`}
              className={paneNavBtnClass(true)}
            >
              <Search size={13} strokeWidth={1.9} />
            </button>
          )}

          {onCloseSplit && (
            <button
              type="button"
              onClick={onCloseSplit}
              title="Close Split View (⌘\)"
              aria-label="Close Split View"
              className={paneNavBtnClass(true)}
            >
              <X size={14} strokeWidth={1.9} />
            </button>
          )}
        </div>
      </div>
    );
  };

  const activeRingClass = dualPane
    ? isActivePane
      ? "ring-1 ring-inset ring-[#0067c0]/40 dark:ring-[#60cdff]/40"
      : "opacity-[0.94]"
    : "";

  if (pane.error) {
    return (
      <main
        onMouseDownCapture={activateThisPane}
        onContextMenu={(e) => e.preventDefault()}
        className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-[#191919] ${activeRingClass}`}
      >
        {renderPaneHeader()}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <AlertCircle size={36} className="text-amber-500" />
          <div className="max-w-md">
            <p className="text-[13.5px] font-medium text-[#1a1a1a] dark:text-[#f3f3f3]">
              Unable to open this folder
            </p>
            <p className="mt-1 break-all text-[12px] text-neutral-500 dark:text-neutral-400">
              {pane.error}
            </p>
          </div>
          <div className="mt-1 flex items-center gap-2">
            {pane.historyIndex > 0 && (
              <button
                type="button"
                onClick={() => goBack(paneId)}
                className="rounded-[5px] border border-black/[0.1] bg-[#f3f4f6] px-3 py-1.5 text-[12px] font-medium text-[#1a1a1a] hover:bg-black/[0.06] dark:border-white/[0.12] dark:bg-[#2c2c2c] dark:text-[#f3f3f3] dark:hover:bg-white/[0.1]"
              >
                Go back
              </button>
            )}
            <button
              type="button"
              onClick={() => void refresh(paneId)}
              className="rounded-[5px] bg-[#0067c0] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#005aa8] dark:bg-[#60cdff] dark:text-[#141414] dark:hover:bg-[#7ad5ff]"
            >
              Try again
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      onMouseDownCapture={activateThisPane}
      onClick={handleBackgroundClick}
      onContextMenu={handleBackgroundContextMenu}
      className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-[#191919] ${activeRingClass}`}
    >
      {/* Pane-local Navigation & Address Bar (shown in Dual Pane mode) */}
      {renderPaneHeader()}

      {/* ZIP Archive Viewing Banner */}
      {zipContext && (
        <div
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className="flex h-[36px] shrink-0 items-center justify-between gap-2 border-b border-amber-500/25 bg-amber-50/90 px-3 text-[12px] select-none dark:border-amber-400/20 dark:bg-amber-500/[0.11]"
        >
          <div className="flex min-w-0 items-center gap-2">
            <FileArchive
              size={14}
              className="shrink-0 text-amber-600 dark:text-amber-400"
            />
            <span className="truncate text-[#4a3208] dark:text-amber-100">
              Viewing inside ZIP archive{" "}
              <strong className="font-semibold">
                {getPathTitle(zipContext.zipPath)}
              </strong>
            </span>
            <span className="hidden shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-800 sm:inline dark:bg-amber-400/15 dark:text-amber-300">
              Read-only
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              disabled={isExtractingZip}
              onClick={() => void extractZipAll(zipContext.zipPath)}
              title="Extract entire archive into a folder with the same name"
              className="flex h-[24px] items-center gap-1.5 rounded-[5px] bg-amber-600 px-2.5 text-[11.5px] font-medium text-white shadow-xs transition-colors hover:bg-amber-700 disabled:opacity-60 dark:bg-amber-500 dark:text-[#1a1a1a] dark:hover:bg-amber-400"
            >
              {isExtractingZip ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <FolderOutput size={12} />
              )}
              <span>{isExtractingZip ? "Extracting..." : "Extract All..."}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const parent = getParentPath(zipContext.zipPath);
                if (parent) navigateTo(parent, paneId);
              }}
              title="Exit ZIP archive"
              aria-label="Exit ZIP archive"
              className="flex h-[24px] items-center gap-1 rounded-[5px] px-2 text-[11.5px] font-medium text-amber-800 transition-colors hover:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-400/15"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Spotlight Search Results Banner */}
      {pane.spotlightActive && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex h-[32px] shrink-0 items-center justify-between gap-2 border-b border-[#0067c0]/15 bg-[#0067c0]/[0.06] px-3 text-[12px] select-none dark:border-[#60cdff]/15 dark:bg-[#60cdff]/[0.08]"
        >
          <div className="flex min-w-0 items-center gap-2">
            {pane.isSearching ? (
              <Loader2
                size={13}
                className="shrink-0 animate-spin text-[#0067c0] dark:text-[#60cdff]"
              />
            ) : (
              <Sparkles
                size={13}
                className="shrink-0 text-[#0067c0] dark:text-[#60cdff]"
              />
            )}
            <span className="truncate text-[#1f1f1f] dark:text-[#ececec]">
              {pane.isSearching ? (
                <>
                  Searching Spotlight for{" "}
                  <strong>&ldquo;{pane.spotlightQuery}&rdquo;</strong> in{" "}
                  <span className="font-medium">
                    {getPathTitle(pane.spotlightScopeDir)}
                  </span>
                  ...
                </>
              ) : (
                <>
                  Spotlight results for{" "}
                  <strong>&ldquo;{pane.spotlightQuery}&rdquo;</strong> in{" "}
                  <span className="font-medium">
                    {getPathTitle(pane.spotlightScopeDir)}
                  </span>{" "}
                  ({displayedEntries.length}{" "}
                  {displayedEntries.length === 1 ? "item" : "items"})
                </>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => clearSpotlightSearch(paneId)}
            className="flex h-[22px] shrink-0 items-center gap-1 rounded-[4px] px-2 text-[11.5px] font-medium text-[#0067c0] transition-colors hover:bg-[#0067c0]/12 dark:text-[#60cdff] dark:hover:bg-[#60cdff]/15"
          >
            <X size={12} />
            <span>Clear</span>
          </button>
        </div>
      )}

      {/* Details View Column Header (with optional Select All checkbox) */}
      {viewMode === "details" && (
        <div
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className={`grid h-[32px] shrink-0 ${detailsGridCols} items-center border-b border-black/[0.07] bg-white px-3 text-[12px] font-medium text-neutral-500 select-none dark:border-white/[0.07] dark:bg-[#191919] dark:text-neutral-400`}
        >
          {showCheckboxes && (
            <div className="flex items-center justify-start">
              <SelectionCheckbox
                checked={allVisibleSelected}
                indeterminate={someVisibleSelected}
                ariaLabel="Select all items"
                onToggle={() => toggleSelectAll(paneId)}
              />
            </div>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSort("name");
            }}
            className="flex h-full items-center gap-1.5 pr-2 text-left hover:text-[#1a1a1a] dark:hover:text-[#f3f3f3]"
          >
            <span>Name</span>
            {renderSortIcon("name")}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSort("modified");
            }}
            className="flex h-full items-center gap-1.5 border-l border-black/[0.06] pl-2.5 text-left hover:text-[#1a1a1a] dark:border-white/[0.06] dark:hover:text-[#f3f3f3]"
          >
            <span className="truncate">Date modified</span>
            {renderSortIcon("modified")}
          </button>
          {!isCompactDetails && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSort("type");
              }}
              className="flex h-full items-center gap-1.5 border-l border-black/[0.06] pl-2.5 text-left hover:text-[#1a1a1a] dark:border-white/[0.06] dark:hover:text-[#f3f3f3]"
            >
              <span>Type</span>
              {renderSortIcon("type")}
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSort("size");
            }}
            className="flex h-full items-center justify-end gap-1.5 border-l border-black/[0.06] pl-2.5 text-right hover:text-[#1a1a1a] dark:border-white/[0.06] dark:hover:text-[#f3f3f3]"
          >
            {renderSortIcon("size")}
            <span>Size</span>
          </button>
        </div>
      )}

      {/* Select All Header Bar for List / Medium Icons / Large Icons when Item Checkboxes are enabled */}
      {viewMode !== "details" && showCheckboxes && (
        <div
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className="flex h-[30px] shrink-0 items-center justify-between border-b border-black/[0.07] bg-white px-3 text-[12px] text-neutral-600 select-none dark:border-white/[0.07] dark:bg-[#191919] dark:text-neutral-300"
        >
          <div className="flex items-center gap-2">
            <SelectionCheckbox
              checked={allVisibleSelected}
              indeterminate={someVisibleSelected}
              ariaLabel="Select all items"
              onToggle={() => toggleSelectAll(paneId)}
            />
            <button
              type="button"
              onClick={() => toggleSelectAll(paneId)}
              className="font-medium hover:text-[#1a1a1a] dark:hover:text-white"
            >
              Select all
            </button>
            {visibleSelectedCount > 0 && (
              <span className="text-[11.5px] text-neutral-400 dark:text-neutral-500">
                ({visibleSelectedCount} selected)
              </span>
            )}
          </div>
          {visibleSelectedCount > 0 && (
            <button
              type="button"
              onClick={() => clearSelection(paneId)}
              className="rounded px-1.5 py-0.5 text-[11.5px] text-[#0067c0] hover:bg-[#0067c0]/10 dark:text-[#60cdff] dark:hover:bg-[#60cdff]/14"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Virtualized Scrollable Area */}
      <div
        ref={scrollContainerRef}
        onScroll={dismissFolderHover}
        onMouseLeave={dismissFolderHover}
        className="relative min-h-0 flex-1 overflow-y-auto px-2 py-1"
      >
        {(pane.isLoading && pane.entries.length === 0) ||
        (pane.spotlightActive && pane.isSearching) ? (
          <div className="flex h-full items-center justify-center gap-2 text-[13px] text-neutral-500 dark:text-neutral-400">
            <Loader2 size={16} className="animate-spin" />
            <span>
              {pane.spotlightActive
                ? "Searching with Spotlight..."
                : "Loading..."}
            </span>
          </div>
        ) : displayedEntries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-400 dark:text-neutral-500">
            <FolderOpen size={34} strokeWidth={1.5} />
            <span className="text-[13px]">
              {pane.spotlightActive
                ? `No Spotlight results for "${pane.spotlightQuery}"`
                : pane.searchQuery
                  ? `No items match "${pane.searchQuery}"`
                  : "This folder is empty."}
            </span>
          </div>
        ) : viewMode === "details" ? (
          /* ======================== DETAILS VIEW ======================== */
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const entry = displayedEntries[virtualRow.index];
              if (!entry) return null;

              const isSelected = selectedSet.has(entry.path);
              const isCut = cutSet.has(entry.path);
              const isDragging = draggingSet.has(entry.path);
              const isDropTarget =
                isRealDropFolder(entry) && dropTargetFolder === entry.path;
              const isRenaming = isRenamingHere && renamingPath === entry.path;

              return (
                <div
                  key={entry.path}
                  data-drop-folder={
                    isRealDropFolder(entry) ? entry.path : undefined
                  }
                  onMouseDown={(e) => handleItemMouseDown(e, entry)}
                  onAuxClick={(e) => handleItemAuxClick(e, entry)}
                  onClick={(e) => handleItemClick(e, entry, virtualRow.index)}
                  onDoubleClick={() => {
                    dismissFolderHover();
                    if (!isRenaming) {
                      void openEntry(entry, paneId);
                    }
                  }}
                  onContextMenu={(e) => handleItemContextMenu(e, entry)}
                  onMouseEnter={(e) => handleFolderMouseEnter(e, entry)}
                  onMouseMove={(e) => handleFolderMouseMove(e, entry)}
                  onMouseLeave={dismissFolderHover}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className={`grid cursor-default ${detailsGridCols} items-center rounded-[5px] px-1.5 text-[12.5px] transition-colors ${
                    isDropTarget
                      ? dropCopyMode
                        ? "bg-emerald-500/18 text-emerald-900 ring-2 ring-inset ring-emerald-500 dark:bg-emerald-400/20 dark:text-emerald-100 dark:ring-emerald-400"
                        : "bg-[#0067c0]/18 text-[#0067c0] ring-2 ring-inset ring-[#0067c0] dark:bg-[#60cdff]/20 dark:text-white dark:ring-[#60cdff]"
                      : isSelected
                        ? "bg-[#0067c0]/12 text-[#1a1a1a] ring-1 ring-inset ring-[#0067c0]/30 dark:bg-[#60cdff]/16 dark:text-[#ffffff] dark:ring-[#60cdff]/30"
                        : "text-[#1f1f1f] hover:bg-black/[0.04] dark:text-[#e6e6e6] dark:hover:bg-white/[0.055]"
                  } ${isCut || isDragging ? "opacity-50" : entry.is_hidden ? "opacity-60" : ""}`}
                >
                  {showCheckboxes && (
                    <div className="flex items-center justify-start">
                      <SelectionCheckbox
                        checked={isSelected}
                        ariaLabel={`Select ${entry.name}`}
                        onToggle={() => toggleSelectPath(entry.path, paneId)}
                      />
                    </div>
                  )}
                  <div className="flex min-w-0 items-center gap-2.5 pr-2">
                    <FileIcon entry={entry} size={17} />
                    {isRenaming ? (
                      <InlineRenameInput entry={entry} align="left" />
                    ) : (
                      <div className="flex min-w-0 flex-1 items-baseline gap-2">
                        <span className="truncate">{entry.name}</span>
                        {pane.spotlightActive && (
                          <span
                            title={entry.path}
                            className="hidden truncate text-[11px] text-neutral-400 md:inline dark:text-neutral-500"
                          >
                            {getParentPath(entry.path)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="truncate pl-2.5 text-[12px] text-neutral-500 dark:text-neutral-400">
                    {formatModifiedDate(entry.modified_timestamp)}
                  </div>
                  {!isCompactDetails && (
                    <div className="truncate pl-2.5 text-[12px] text-neutral-500 dark:text-neutral-400">
                      {getFileTypeLabel(entry)}
                    </div>
                  )}
                  <div className="truncate pl-2.5 text-right text-[12px] tabular-nums text-neutral-500 dark:text-neutral-400">
                    {entry.is_dir ? "" : formatFileSize(entry.size)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : viewMode === "list" ? (
          /* ======================== LIST VIEW (Compact Multi-Column) ======================== */
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const rowStartIndex = virtualRow.index * columns;
              const rowItems = displayedEntries.slice(
                rowStartIndex,
                rowStartIndex + columns
              );

              return (
                <div
                  key={virtualRow.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  }}
                  className="grid gap-1 px-0.5"
                >
                  {rowItems.map((entry, offset) => {
                    const globalIndex = rowStartIndex + offset;
                    const isSelected = selectedSet.has(entry.path);
                    const isCut = cutSet.has(entry.path);
                    const isDragging = draggingSet.has(entry.path);
                    const isDropTarget =
                      isRealDropFolder(entry) &&
                      dropTargetFolder === entry.path;
                    const isRenaming =
                      isRenamingHere && renamingPath === entry.path;

                    return (
                      <div
                        key={entry.path}
                        data-drop-folder={
                          isRealDropFolder(entry) ? entry.path : undefined
                        }
                        onMouseDown={(e) => handleItemMouseDown(e, entry)}
                        onAuxClick={(e) => handleItemAuxClick(e, entry)}
                        onClick={(e) => handleItemClick(e, entry, globalIndex)}
                        onDoubleClick={() => {
                          dismissFolderHover();
                          if (!isRenaming) {
                            void openEntry(entry, paneId);
                          }
                        }}
                        onContextMenu={(e) => handleItemContextMenu(e, entry)}
                        onMouseEnter={(e) => handleFolderMouseEnter(e, entry)}
                        onMouseMove={(e) => handleFolderMouseMove(e, entry)}
                        onMouseLeave={dismissFolderHover}
                        title={entry.is_dir ? undefined : entry.name}
                        className={`flex h-full min-w-0 cursor-default items-center gap-2 rounded-[5px] px-2 text-[12.5px] transition-colors ${
                          isDropTarget
                            ? dropCopyMode
                              ? "bg-emerald-500/18 text-emerald-900 ring-2 ring-inset ring-emerald-500 dark:bg-emerald-400/20 dark:text-emerald-100 dark:ring-emerald-400"
                              : "bg-[#0067c0]/18 text-[#0067c0] ring-2 ring-inset ring-[#0067c0] dark:bg-[#60cdff]/20 dark:text-white dark:ring-[#60cdff]"
                            : isSelected
                              ? "bg-[#0067c0]/12 text-[#1a1a1a] ring-1 ring-inset ring-[#0067c0]/30 dark:bg-[#60cdff]/16 dark:text-white dark:ring-[#60cdff]/30"
                              : "text-[#1f1f1f] hover:bg-black/[0.04] dark:text-[#e6e6e6] dark:hover:bg-white/[0.055]"
                        } ${isCut || isDragging ? "opacity-50" : entry.is_hidden ? "opacity-60" : ""}`}
                      >
                        {showCheckboxes && (
                          <SelectionCheckbox
                            checked={isSelected}
                            ariaLabel={`Select ${entry.name}`}
                            onToggle={() => toggleSelectPath(entry.path, paneId)}
                          />
                        )}
                        <FileIcon entry={entry} size={16} />
                        {isRenaming ? (
                          <InlineRenameInput entry={entry} align="left" />
                        ) : (
                          <span className="min-w-0 flex-1 truncate">
                            {entry.name}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : (
          /* ======================== MEDIUM & LARGE ICONS VIEW ======================== */
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const rowStartIndex = virtualRow.index * columns;
              const rowItems = displayedEntries.slice(
                rowStartIndex,
                rowStartIndex + columns
              );
              const isLarge = viewMode === "large-icons";

              return (
                <div
                  key={virtualRow.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  }}
                  className="grid gap-1.5 px-1 py-1"
                >
                  {rowItems.map((entry, offset) => {
                    const globalIndex = rowStartIndex + offset;
                    const isSelected = selectedSet.has(entry.path);
                    const isCut = cutSet.has(entry.path);
                    const isDragging = draggingSet.has(entry.path);
                    const isDropTarget =
                      isRealDropFolder(entry) &&
                      dropTargetFolder === entry.path;
                    const isRenaming =
                      isRenamingHere && renamingPath === entry.path;

                    return (
                      <div
                        key={entry.path}
                        data-drop-folder={
                          isRealDropFolder(entry) ? entry.path : undefined
                        }
                        onMouseDown={(e) => handleItemMouseDown(e, entry)}
                        onAuxClick={(e) => handleItemAuxClick(e, entry)}
                        onClick={(e) => handleItemClick(e, entry, globalIndex)}
                        onDoubleClick={() => {
                          dismissFolderHover();
                          if (!isRenaming) {
                            void openEntry(entry, paneId);
                          }
                        }}
                        onContextMenu={(e) => handleItemContextMenu(e, entry)}
                        onMouseEnter={(e) => handleFolderMouseEnter(e, entry)}
                        onMouseMove={(e) => handleFolderMouseMove(e, entry)}
                        onMouseLeave={dismissFolderHover}
                        title={entry.is_dir ? undefined : entry.name}
                        className={`group relative flex h-full cursor-default flex-col items-center justify-start gap-1.5 rounded-[6px] px-2 py-2 text-center transition-colors ${
                          isDropTarget
                            ? dropCopyMode
                              ? "bg-emerald-500/18 text-emerald-900 ring-2 ring-inset ring-emerald-500 dark:bg-emerald-400/20 dark:text-emerald-100 dark:ring-emerald-400"
                              : "bg-[#0067c0]/18 text-[#0067c0] ring-2 ring-inset ring-[#0067c0] dark:bg-[#60cdff]/20 dark:text-white dark:ring-[#60cdff]"
                            : isSelected
                              ? "bg-[#0067c0]/14 text-[#1a1a1a] ring-1 ring-inset ring-[#0067c0]/35 dark:bg-[#60cdff]/18 dark:text-white dark:ring-[#60cdff]/35"
                              : "text-[#1f1f1f] hover:bg-black/[0.045] dark:text-[#e6e6e6] dark:hover:bg-white/[0.06]"
                        } ${isCut || isDragging ? "opacity-50" : entry.is_hidden ? "opacity-60" : ""}`}
                      >
                        {showCheckboxes && (
                          <div className="absolute top-1.5 left-1.5 z-10">
                            <SelectionCheckbox
                              checked={isSelected}
                              ariaLabel={`Select ${entry.name}`}
                              onToggle={() =>
                                toggleSelectPath(entry.path, paneId)
                              }
                            />
                          </div>
                        )}

                        {isLarge ? (
                          <FileThumbnail
                            entry={entry}
                            iconSize={58}
                            maxThumbSize={256}
                            className="h-[92px] w-[116px]"
                          />
                        ) : (
                          <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center">
                            <FileIcon entry={entry} size={42} />
                          </div>
                        )}

                        {isRenaming ? (
                          <InlineRenameInput entry={entry} align="center" />
                        ) : (
                          <span className="line-clamp-2 w-full break-words text-[12px] leading-[1.3]">
                            {entry.name}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <FolderHoverPopup target={hoverTarget} />

      {isExternalDragOver && !dropTargetFolder && (
        <div
          className={`pointer-events-none absolute inset-1 z-30 flex items-end justify-center rounded-[7px] border-2 border-dashed p-3 transition-colors ${
            dropCopyMode
              ? "border-emerald-500/80 bg-emerald-500/[0.04] dark:border-emerald-400/80 dark:bg-emerald-400/[0.05]"
              : "border-[#0067c0]/80 bg-[#0067c0]/[0.04] dark:border-[#60cdff]/80 dark:bg-[#60cdff]/[0.05]"
          }`}
        >
          <div
            className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[12px] font-medium shadow-md backdrop-blur-md ${
              dropCopyMode
                ? "border-emerald-500/40 bg-emerald-50/95 text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-950/90 dark:text-emerald-200"
                : "border-[#0067c0]/35 bg-white/95 text-[#0067c0] dark:border-[#60cdff]/35 dark:bg-[#1f2933]/95 dark:text-[#60cdff]"
            }`}
          >
            <Upload size={13} />
            <span>
              {dropCopyMode
                ? `Copy into ${pane.title}`
                : `Move into ${pane.title}`}
            </span>
            <span className="text-[10.5px] opacity-65">
              {dropCopyMode ? "(⌥)" : "(hold ⌥ to Copy)"}
            </span>
          </div>
        </div>
      )}
    </main>
  );
}
