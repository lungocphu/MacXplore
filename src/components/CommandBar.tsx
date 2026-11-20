import { useEffect, useRef, useState } from "react";
import {
  Check,
  CheckSquare,
  ChevronDown,
  ClipboardPaste,
  Columns2,
  Copy,
  Eye,
  EyeOff,
  FileCode2,
  FileText,
  FolderPlus,
  Grid2x2,
  LayoutGrid,
  LayoutList,
  List,
  Network,
  Pencil,
  Redo2,
  Scissors,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  useActivePane,
  useExplorerStore,
  type ViewMode,
} from "../store/useExplorerStore";
import { isZipVirtualPath } from "../lib/format";

interface ViewOption {
  mode: ViewMode;
  label: string;
  icon: React.ReactNode;
}

const VIEW_OPTIONS: ViewOption[] = [
  {
    mode: "large-icons",
    label: "Large icons",
    icon: <Grid2x2 size={15} strokeWidth={1.8} />,
  },
  {
    mode: "medium-icons",
    label: "Medium icons",
    icon: <LayoutGrid size={15} strokeWidth={1.8} />,
  },
  {
    mode: "list",
    label: "List",
    icon: <List size={15} strokeWidth={1.8} />,
  },
  {
    mode: "details",
    label: "Details",
    icon: <LayoutList size={15} strokeWidth={1.8} />,
  },
];

function getViewIcon(mode: ViewMode) {
  switch (mode) {
    case "large-icons":
      return <Grid2x2 size={15} strokeWidth={1.8} />;
    case "medium-icons":
      return <LayoutGrid size={15} strokeWidth={1.8} />;
    case "list":
      return <List size={15} strokeWidth={1.8} />;
    case "details":
    default:
      return <LayoutList size={15} strokeWidth={1.8} />;
  }
}

export function CommandBar() {
  const activePaneData = useActivePane();
  const clipboard = useExplorerStore((s) => s.clipboard);
  const viewMode = useExplorerStore((s) => s.viewMode);
  const showHidden = useExplorerStore((s) => s.showHidden);
  const showCheckboxes = useExplorerStore((s) => s.showCheckboxes);
  const dualPane = useExplorerStore((s) => s.dualPane);
  const networkDriveCount = useExplorerStore((s) => s.networkDrives.length);
  const undoStack = useExplorerStore((s) => s.undoStack);
  const redoStack = useExplorerStore((s) => s.redoStack);
  const isUndoing = useExplorerStore((s) => s.isUndoing);

  const createNewFolder = useExplorerStore((s) => s.createNewFolder);
  const createNewFile = useExplorerStore((s) => s.createNewFile);
  const cutSelected = useExplorerStore((s) => s.cutSelected);
  const copySelected = useExplorerStore((s) => s.copySelected);
  const pasteClipboard = useExplorerStore((s) => s.pasteClipboard);
  const startRenaming = useExplorerStore((s) => s.startRenaming);
  const deleteSelected = useExplorerStore((s) => s.deleteSelected);
  const undoLastAction = useExplorerStore((s) => s.undoLastAction);
  const redoLastAction = useExplorerStore((s) => s.redoLastAction);
  const setViewMode = useExplorerStore((s) => s.setViewMode);
  const toggleShowHidden = useExplorerStore((s) => s.toggleShowHidden);
  const toggleShowCheckboxes = useExplorerStore((s) => s.toggleShowCheckboxes);
  const toggleDualPane = useExplorerStore((s) => s.toggleDualPane);
  const openNetworkModal = useExplorerStore((s) => s.openNetworkModal);

  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const newMenuRef = useRef<HTMLDivElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!newMenuOpen && !viewMenuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        newMenuOpen &&
        newMenuRef.current &&
        !newMenuRef.current.contains(target)
      ) {
        setNewMenuOpen(false);
      }
      if (
        viewMenuOpen &&
        viewMenuRef.current &&
        !viewMenuRef.current.contains(target)
      ) {
        setViewMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setNewMenuOpen(false);
        setViewMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [newMenuOpen, viewMenuOpen]);

  const isInZip = isZipVirtualPath(activePaneData.currentPath);
  const hasSelection = activePaneData.selectedPaths.length > 0;
  const canCut = hasSelection && !isInZip;
  const canRename = activePaneData.selectedPaths.length === 1 && !isInZip;
  const canDelete = hasSelection && !isInZip;
  const canPaste =
    !isInZip && clipboard.action !== null && clipboard.paths.length > 0;
  const lastUndo = undoStack[undoStack.length - 1];
  const lastRedo = redoStack[redoStack.length - 1];
  const canUndo = Boolean(lastUndo) && !isUndoing;
  const canRedo = Boolean(lastRedo) && !isUndoing;

  const iconBtnClass = (enabled: boolean) =>
    `flex h-[32px] items-center gap-1.5 rounded-[5px] px-2 text-[12.5px] transition-colors ${
      enabled
        ? "text-[#1f1f1f] hover:bg-black/[0.06] active:bg-black/[0.1] dark:text-[#ececec] dark:hover:bg-white/[0.08] dark:active:bg-white/[0.12]"
        : "cursor-default text-[#a3a3a3] dark:text-[#5c5c5c]"
    }`;

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      className="flex h-[44px] shrink-0 items-center justify-between gap-2 border-b border-black/[0.08] bg-[#f3f5f8] px-2.5 select-none dark:border-white/[0.08] dark:bg-[#242424]"
    >
      {/* Left: File Actions (always target Active Pane) */}
      <div className="flex items-center gap-1">
        {/* New Folder + Quick New Dropdown */}
        <div ref={newMenuRef} className="relative flex items-center">
          <button
            type="button"
            disabled={isInZip}
            onClick={() => void createNewFolder()}
            title={isInZip ? "Cannot create items inside a ZIP archive" : "New folder (⌘⇧N)"}
            className={`flex h-[32px] items-center gap-1.5 rounded-l-[5px] px-2.5 text-[12.5px] font-medium transition-colors ${
              isInZip
                ? "cursor-default text-[#a3a3a3] opacity-55 dark:text-[#5c5c5c]"
                : "text-[#1f1f1f] hover:bg-black/[0.06] active:bg-black/[0.1] dark:text-[#ececec] dark:hover:bg-white/[0.08] dark:active:bg-white/[0.12]"
            }`}
          >
            <FolderPlus
              size={15}
              className="text-amber-500 dark:text-amber-400"
            />
            <span>New</span>
          </button>
          <button
            type="button"
            disabled={isInZip}
            onClick={() => {
              setViewMenuOpen(false);
              setNewMenuOpen((prev) => !prev);
            }}
            title="More new item options"
            aria-label="More new item options"
            aria-expanded={newMenuOpen}
            className={`flex h-[32px] w-[22px] items-center justify-center rounded-r-[5px] transition-colors ${
              isInZip
                ? "cursor-default text-[#a3a3a3] opacity-55 dark:text-[#5c5c5c]"
                : "text-[#555555] hover:bg-black/[0.06] active:bg-black/[0.1] dark:text-[#b8b8b8] dark:hover:bg-white/[0.08] dark:active:bg-white/[0.12]"
            }`}
          >
            <ChevronDown size={13} />
          </button>

          {newMenuOpen && (
            <div className="absolute top-[36px] left-0 z-50 min-w-[200px] rounded-[8px] border border-black/[0.1] bg-white/95 p-1 shadow-xl backdrop-blur-xl dark:border-white/[0.12] dark:bg-[#2c2c2c]/95">
              <button
                type="button"
                onClick={() => {
                  setNewMenuOpen(false);
                  void createNewFolder();
                }}
                className="flex w-full items-center gap-2.5 rounded-[5px] px-2.5 py-1.5 text-left text-[12.5px] text-[#1f1f1f] hover:bg-black/[0.06] dark:text-[#f0f0f0] dark:hover:bg-white/[0.08]"
              >
                <FolderPlus
                  size={15}
                  className="text-amber-500 dark:text-amber-400"
                />
                <span>New Folder</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewMenuOpen(false);
                  void createNewFile("New Text Document", "txt");
                }}
                className="flex w-full items-center gap-2.5 rounded-[5px] px-2.5 py-1.5 text-left text-[12.5px] text-[#1f1f1f] hover:bg-black/[0.06] dark:text-[#f0f0f0] dark:hover:bg-white/[0.08]"
              >
                <FileText
                  size={15}
                  className="text-blue-600 dark:text-blue-400"
                />
                <span>New Text File (.txt)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewMenuOpen(false);
                  void createNewFile("New Document", "md");
                }}
                className="flex w-full items-center gap-2.5 rounded-[5px] px-2.5 py-1.5 text-left text-[12.5px] text-[#1f1f1f] hover:bg-black/[0.06] dark:text-[#f0f0f0] dark:hover:bg-white/[0.08]"
              >
                <FileCode2
                  size={15}
                  className="text-sky-600 dark:text-sky-400"
                />
                <span>New Markdown (.md)</span>
              </button>
            </div>
          )}
        </div>

        <div className="mx-1 h-5 w-[1px] bg-black/[0.1] dark:bg-white/[0.1]" />

        {/* Cut / Copy / Paste / Rename / Delete */}
        <button
          type="button"
          onClick={cutSelected}
          disabled={!canCut}
          title="Cut (⌘X)"
          aria-label="Cut"
          className={iconBtnClass(canCut)}
        >
          <Scissors size={15} strokeWidth={1.8} />
        </button>

        <button
          type="button"
          onClick={copySelected}
          disabled={!hasSelection}
          title="Copy (⌘C)"
          aria-label="Copy"
          className={iconBtnClass(hasSelection)}
        >
          <Copy size={15} strokeWidth={1.8} />
        </button>

        <button
          type="button"
          onClick={() => void pasteClipboard()}
          disabled={!canPaste}
          title="Paste (⌘V)"
          aria-label="Paste"
          className={iconBtnClass(canPaste)}
        >
          <ClipboardPaste size={15} strokeWidth={1.8} />
        </button>

        <button
          type="button"
          onClick={() => startRenaming()}
          disabled={!canRename}
          title="Rename (F2)"
          aria-label="Rename"
          className={iconBtnClass(canRename)}
        >
          <Pencil size={15} strokeWidth={1.8} />
        </button>

        <button
          type="button"
          onClick={() => void deleteSelected()}
          disabled={!canDelete}
          title="Move to Trash (⌘⌫)"
          aria-label="Delete"
          className={iconBtnClass(canDelete)}
        >
          <Trash2 size={15} strokeWidth={1.8} />
        </button>

        <div className="mx-1 h-5 w-[1px] bg-black/[0.1] dark:bg-white/[0.1]" />

        <button
          type="button"
          onClick={() => void undoLastAction()}
          disabled={!canUndo}
          title={lastUndo ? `Undo ${lastUndo.label} (⌘Z)` : "Undo (⌘Z)"}
          aria-label="Undo"
          className={iconBtnClass(canUndo)}
        >
          <Undo2 size={15} strokeWidth={1.8} />
        </button>

        <button
          type="button"
          onClick={() => void redoLastAction()}
          disabled={!canRedo}
          title={lastRedo ? `Redo ${lastRedo.label} (⇧⌘Z)` : "Redo (⇧⌘Z)"}
          aria-label="Redo"
          className={iconBtnClass(canRedo)}
        >
          <Redo2 size={15} strokeWidth={1.8} />
        </button>
      </div>

      {/* Right: LAN Network Drive, Split View (Dual Pane), Windows 11 View Dropdown & Show Hidden */}
      <div className="flex items-center gap-1">
        {/* Connect LAN Network Drive */}
        <button
          type="button"
          onClick={() => openNetworkModal()}
          title="Connect Network Drive (LAN) (⌘K)"
          className="relative flex h-[32px] items-center gap-1.5 rounded-[5px] px-2.5 text-[12.5px] text-[#1f1f1f] transition-colors hover:bg-black/[0.06] active:bg-black/[0.1] dark:text-[#ececec] dark:hover:bg-white/[0.08] dark:active:bg-white/[0.12]"
        >
          <Network
            size={15}
            strokeWidth={1.8}
            className="text-teal-600 dark:text-teal-400"
          />
          <span className="hidden lg:inline">LAN</span>
          {networkDriveCount > 0 && (
            <span className="flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-teal-600/15 px-1 text-[10px] font-semibold text-teal-700 dark:bg-teal-400/20 dark:text-teal-300">
              {networkDriveCount}
            </span>
          )}
        </button>

        {/* Split View / Dual Pane Toggle */}
        <button
          type="button"
          onClick={toggleDualPane}
          title={
            dualPane
              ? "Close Split View / Dual Pane (⌘\\)"
              : "Split View / Dual Pane (⌘\\)"
          }
          aria-pressed={dualPane}
          className={`flex h-[32px] items-center gap-1.5 rounded-[5px] px-2.5 text-[12.5px] transition-colors ${
            dualPane
              ? "bg-[#0067c0]/12 font-medium text-[#0067c0] hover:bg-[#0067c0]/18 dark:bg-[#60cdff]/16 dark:text-[#60cdff] dark:hover:bg-[#60cdff]/24"
              : "text-[#1f1f1f] hover:bg-black/[0.06] active:bg-black/[0.1] dark:text-[#ececec] dark:hover:bg-white/[0.08] dark:active:bg-white/[0.12]"
          }`}
        >
          <Columns2 size={15} strokeWidth={1.8} />
          <span className="hidden md:inline">Split View</span>
        </button>

        <div className="mx-0.5 h-5 w-[1px] bg-black/[0.1] dark:bg-white/[0.1]" />

        {/* Windows 11 View Dropdown Menu */}
        <div ref={viewMenuRef} className="relative">
          <button
            type="button"
            onClick={() => {
              setNewMenuOpen(false);
              setViewMenuOpen((prev) => !prev);
            }}
            title="Change view layout and options"
            aria-expanded={viewMenuOpen}
            aria-haspopup="menu"
            className={`flex h-[32px] items-center gap-1.5 rounded-[5px] px-2.5 text-[12.5px] transition-colors ${
              viewMenuOpen
                ? "bg-black/[0.08] text-[#1a1a1a] dark:bg-white/[0.12] dark:text-white"
                : "text-[#1f1f1f] hover:bg-black/[0.06] active:bg-black/[0.1] dark:text-[#ececec] dark:hover:bg-white/[0.08] dark:active:bg-white/[0.12]"
            }`}
          >
            {getViewIcon(viewMode)}
            <span className="hidden sm:inline">View</span>
            <ChevronDown size={13} className="opacity-75" />
          </button>

          {viewMenuOpen && (
            <div
              role="menu"
              className="absolute top-[36px] right-0 z-50 min-w-[216px] rounded-[8px] border border-black/[0.1] bg-white/95 p-1 shadow-[0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur-xl dark:border-white/[0.12] dark:bg-[#2c2c2c]/95 dark:shadow-[0_12px_36px_rgba(0,0,0,0.5)]"
            >
              <div className="px-2.5 pt-1 pb-0.5 text-[10.5px] font-semibold tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
                Layout
              </div>
              {VIEW_OPTIONS.map((opt) => {
                const isSelected = viewMode === opt.mode;
                return (
                  <button
                    key={opt.mode}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isSelected}
                    onClick={() => {
                      setViewMode(opt.mode);
                      setViewMenuOpen(false);
                    }}
                    className={`flex h-[32px] w-full items-center gap-2.5 rounded-[5px] px-2.5 text-left text-[12.5px] transition-colors ${
                      isSelected
                        ? "bg-[#0067c0]/10 font-medium text-[#0067c0] dark:bg-[#60cdff]/14 dark:text-[#60cdff]"
                        : "text-[#1f1f1f] hover:bg-black/[0.06] dark:text-[#f0f0f0] dark:hover:bg-white/[0.08]"
                    }`}
                  >
                    <span className="flex w-4 shrink-0 items-center justify-center">
                      {opt.icon}
                    </span>
                    <span className="min-w-0 flex-1">{opt.label}</span>
                    {isSelected && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#0067c0] dark:bg-[#60cdff]" />
                    )}
                  </button>
                );
              })}

              <div className="my-1 h-[1px] bg-black/[0.08] dark:bg-white/[0.08]" />

              <div className="px-2.5 pt-0.5 pb-0.5 text-[10.5px] font-semibold tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
                Show
              </div>

              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={showCheckboxes}
                onClick={() => {
                  toggleShowCheckboxes();
                }}
                className="flex h-[32px] w-full items-center gap-2.5 rounded-[5px] px-2.5 text-left text-[12.5px] text-[#1f1f1f] transition-colors hover:bg-black/[0.06] dark:text-[#f0f0f0] dark:hover:bg-white/[0.08]"
              >
                <span className="flex w-4 shrink-0 items-center justify-center">
                  <CheckSquare size={15} strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1">Item check boxes</span>
                {showCheckboxes && (
                  <Check
                    size={14}
                    className="shrink-0 text-[#0067c0] dark:text-[#60cdff]"
                  />
                )}
              </button>

              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={showHidden}
                onClick={() => {
                  toggleShowHidden();
                }}
                className="flex h-[32px] w-full items-center gap-2.5 rounded-[5px] px-2.5 text-left text-[12.5px] text-[#1f1f1f] transition-colors hover:bg-black/[0.06] dark:text-[#f0f0f0] dark:hover:bg-white/[0.08]"
              >
                <span className="flex w-4 shrink-0 items-center justify-center">
                  {showHidden ? (
                    <Eye size={15} strokeWidth={1.8} />
                  ) : (
                    <EyeOff size={15} strokeWidth={1.8} />
                  )}
                </span>
                <span className="min-w-0 flex-1">Hidden items</span>
                {showHidden && (
                  <Check
                    size={14}
                    className="shrink-0 text-[#0067c0] dark:text-[#60cdff]"
                  />
                )}
              </button>
            </div>
          )}
        </div>

        <div className="mx-0.5 h-5 w-[1px] bg-black/[0.1] dark:bg-white/[0.1]" />

        <button
          type="button"
          onClick={toggleShowHidden}
          title={showHidden ? "Hide hidden files" : "Show hidden files"}
          className={`flex h-[32px] items-center gap-1.5 rounded-[5px] px-2.5 text-[12.5px] transition-colors ${
            showHidden
              ? "bg-[#0067c0]/12 font-medium text-[#0067c0] hover:bg-[#0067c0]/18 dark:bg-[#60cdff]/16 dark:text-[#60cdff] dark:hover:bg-[#60cdff]/24"
              : "text-[#1f1f1f] hover:bg-black/[0.06] dark:text-[#ececec] dark:hover:bg-white/[0.08]"
          }`}
        >
          {showHidden ? (
            <Eye size={15} strokeWidth={1.8} />
          ) : (
            <EyeOff size={15} strokeWidth={1.8} />
          )}
          <span className="hidden sm:inline">Hidden</span>
        </button>
      </div>
    </div>
  );
}
