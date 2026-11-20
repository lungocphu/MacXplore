import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Cloud,
  Columns2,
  Download,
  FileText,
  Folder,
  FolderInput,
  FolderOutput,
  FolderPlus,
  HardDrive,
  Home,
  Loader2,
  Monitor,
  Network,
  X,
} from "lucide-react";
import { tauriApi, type FileEntry } from "../lib/tauriApi";
import { getPathTitle, joinPath, normalizePath } from "../lib/format";
import {
  useActivePane,
  useExplorerStore,
  usePane,
} from "../store/useExplorerStore";

interface ModalTreeNodeProps {
  name: string;
  path: string;
  depth?: number;
  icon?: ReactNode;
  selectedPath: string;
  onSelect: (path: string) => void;
  refreshVersions: Record<string, number>;
  defaultExpanded?: boolean;
}

function ModalTreeNode({
  name,
  path,
  depth = 0,
  icon,
  selectedPath,
  onSelect,
  refreshVersions,
  defaultExpanded = false,
}: ModalTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const nodeRefreshVersion = refreshVersions[path] ?? 0;

  const loadChildren = async () => {
    setIsLoading(true);
    try {
      const subfolders = await tauriApi.getSubfolders(path);
      setChildren(subfolders);
      setHasLoaded(true);
    } catch {
      setChildren([]);
      setHasLoaded(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (defaultExpanded && !hasLoaded) {
      void loadChildren();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultExpanded]);

  // Reload children whenever a new folder was created inside this path
  useEffect(() => {
    if (nodeRefreshVersion > 0) {
      setIsExpanded(true);
      void loadChildren();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeRefreshVersion]);

  const isSelected = selectedPath === path;
  const hasKnownNoChildren =
    hasLoaded && children !== null && children.length === 0;

  const handleToggleExpand = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isExpanded) {
      setIsExpanded(false);
      return;
    }
    setIsExpanded(true);
    if (!hasLoaded) {
      await loadChildren();
    }
  };

  return (
    <div>
      <div
        role="treeitem"
        aria-expanded={hasKnownNoChildren ? undefined : isExpanded}
        aria-selected={isSelected}
        onClick={() => onSelect(path)}
        onDoubleClick={(e) => void handleToggleExpand(e)}
        title={path}
        style={{ paddingLeft: `${depth * 15 + 6}px` }}
        className={`relative flex h-[30px] cursor-default items-center gap-1 rounded-[5px] pr-2 text-[12.5px] transition-colors ${
          isSelected
            ? "bg-[#0067c0]/14 font-medium text-[#1a1a1a] dark:bg-[#60cdff]/18 dark:text-white"
            : "text-[#2c2c2c] hover:bg-black/[0.045] dark:text-[#dcdcdc] dark:hover:bg-white/[0.06]"
        }`}
      >
        {isSelected && (
          <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-[#0067c0] dark:bg-[#60cdff]" />
        )}

        <button
          type="button"
          onClick={(e) => void handleToggleExpand(e)}
          aria-label={isExpanded ? `Collapse ${name}` : `Expand ${name}`}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-neutral-500 transition-colors hover:bg-black/[0.06] dark:text-neutral-400 dark:hover:bg-white/[0.08] ${
            hasKnownNoChildren ? "pointer-events-none opacity-0" : ""
          }`}
        >
          {isLoading ? (
            <Loader2 size={11} className="animate-spin" />
          ) : isExpanded ? (
            <ChevronDown size={13} strokeWidth={2} />
          ) : (
            <ChevronRight size={13} strokeWidth={2} />
          )}
        </button>

        <span className="flex shrink-0 items-center">
          {icon ?? (
            <Folder
              size={15}
              className="fill-amber-400/90 text-amber-500 dark:fill-amber-400/85 dark:text-amber-300"
            />
          )}
        </span>

        <span className="ml-1 min-w-0 flex-1 truncate">{name}</span>
      </div>

      {isExpanded && children && children.length > 0 && (
        <div role="group">
          {children.map((child) => (
            <ModalTreeNode
              key={child.path}
              name={child.name}
              path={child.path}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              refreshVersions={refreshVersions}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface QuickPill {
  label: string;
  path: string;
  icon: ReactNode;
}

export function DestinationModal() {
  const destinationModal = useExplorerStore((s) => s.destinationModal);
  const specialPaths = useExplorerStore((s) => s.specialPaths);
  const networkDrives = useExplorerStore((s) => s.networkDrives);
  const recentDestinations = useExplorerStore((s) => s.recentDestinations);
  const dualPane = useExplorerStore((s) => s.dualPane);
  const activePane = useActivePane();
  const leftPane = usePane("left");
  const rightPane = usePane("right");
  const otherPane = activePane.paneId === "left" ? rightPane : leftPane;

  const closeDestinationModal = useExplorerStore(
    (s) => s.closeDestinationModal
  );
  const copyOrMoveToDestination = useExplorerStore(
    (s) => s.copyOrMoveToDestination
  );
  const showToast = useExplorerStore((s) => s.showToast);

  const [destPath, setDestPath] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Inline "New Folder" creation inside the selected destination
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("New folder");
  const [isCreatingPending, setIsCreatingPending] = useState(false);
  const [refreshVersions, setRefreshVersions] = useState<
    Record<string, number>
  >({});

  const newFolderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!destinationModal) return;
    const otherPanePath =
      dualPane &&
      otherPane.currentPath &&
      otherPane.currentPath !== activePane.currentPath
        ? otherPane.currentPath
        : null;
    const initial =
      otherPanePath ??
      recentDestinations[0] ??
      specialPaths?.desktop ??
      specialPaths?.home ??
      activePane.currentPath;
    setDestPath(initial);
    setIsSubmitting(false);
    setIsCreatingFolder(false);
    setNewFolderName("New folder");
    setRefreshVersions({});
  }, [
    destinationModal,
    dualPane,
    otherPane.currentPath,
    specialPaths,
    recentDestinations,
    activePane.currentPath,
  ]);

  useEffect(() => {
    if (isCreatingFolder && newFolderInputRef.current) {
      newFolderInputRef.current.focus();
      newFolderInputRef.current.select();
    }
  }, [isCreatingFolder]);

  useEffect(() => {
    if (!destinationModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (isCreatingFolder) {
          setIsCreatingFolder(false);
        } else if (!isSubmitting) {
          closeDestinationModal();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [destinationModal, isCreatingFolder, isSubmitting, closeDestinationModal]);

  const quickAccessPills = useMemo<QuickPill[]>(() => {
    const items: QuickPill[] = [];
    if (
      dualPane &&
      otherPane.currentPath &&
      otherPane.currentPath !== activePane.currentPath
    ) {
      items.push({
        label: `Other Pane (${otherPane.title})`,
        path: otherPane.currentPath,
        icon: (
          <Columns2
            size={13}
            className="text-[#0067c0] dark:text-[#60cdff]"
          />
        ),
      });
    }
    if (specialPaths?.home) {
      items.push({
        label: "Home",
        path: specialPaths.home,
        icon: <Home size={13} className="text-sky-600 dark:text-sky-400" />,
      });
    }
    if (specialPaths?.desktop) {
      items.push({
        label: "Desktop",
        path: specialPaths.desktop,
        icon: (
          <Monitor size={13} className="text-blue-600 dark:text-blue-400" />
        ),
      });
    }
    if (specialPaths?.documents) {
      items.push({
        label: "Documents",
        path: specialPaths.documents,
        icon: (
          <FileText
            size={13}
            className="text-indigo-500 dark:text-indigo-400"
          />
        ),
      });
    }
    if (specialPaths?.downloads) {
      items.push({
        label: "Downloads",
        path: specialPaths.downloads,
        icon: (
          <Download
            size={13}
            className="text-emerald-600 dark:text-emerald-400"
          />
        ),
      });
    }
    for (const drive of specialPaths?.cloud_drives ?? []) {
      items.push({
        label: drive.name,
        path: drive.path,
        icon: <Cloud size={13} className="text-sky-500 dark:text-sky-400" />,
      });
    }
    for (const drive of networkDrives) {
      items.push({
        label: `${drive.name} (LAN)`,
        path: drive.path,
        icon: <Network size={13} className="text-teal-600 dark:text-teal-400" />,
      });
    }
    return items;
  }, [
    dualPane,
    otherPane.currentPath,
    otherPane.title,
    activePane.currentPath,
    specialPaths,
    networkDrives,
  ]);

  if (!destinationModal) return null;

  const { mode, sourcePaths } = destinationModal;
  const count = sourcePaths.length;
  const normalizedSelected = normalizePath(destPath, specialPaths?.home);

  const title =
    mode === "move"
      ? `Move ${count} ${count === 1 ? "item" : "items"} to...`
      : `Copy ${count} ${count === 1 ? "item" : "items"} to...`;

  const subtitle =
    count === 1
      ? getPathTitle(sourcePaths[0], specialPaths?.home)
      : `${count} items selected`;

  const handleConfirm = async () => {
    const trimmed = destPath.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    const ok = await copyOrMoveToDestination(mode, sourcePaths, trimmed);
    setIsSubmitting(false);
    if (ok) {
      closeDestinationModal();
    }
  };

  const handleCreateNewFolderHere = async () => {
    const trimmedName = newFolderName.trim();
    if (!trimmedName || isCreatingPending) return;

    if (trimmedName.includes("/") || trimmedName.includes("\0")) {
      showToast('Folder name cannot contain "/" characters', "error");
      return;
    }

    const parent = normalizePath(destPath, specialPaths?.home);
    const newPath = joinPath(parent, trimmedName);

    setIsCreatingPending(true);
    try {
      const created = await tauriApi.createDirectory(newPath);
      setRefreshVersions((prev) => ({
        ...prev,
        [parent]: (prev[parent] ?? 0) + 1,
      }));
      setDestPath(created.path);
      setIsCreatingFolder(false);
      setNewFolderName("New folder");
      showToast(`Created folder "${created.name}"`, "info");
    } catch (err) {
      showToast(`Could not create folder: ${String(err)}`, "error");
    } finally {
      setIsCreatingPending(false);
    }
  };

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          closeDestinationModal();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px] select-none"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="destination-modal-title"
        className="flex h-[580px] max-h-[88vh] w-[580px] max-w-[94vw] flex-col overflow-hidden rounded-[10px] border border-black/[0.12] bg-[#f9fafc] text-[#1a1a1a] shadow-[0_24px_60px_rgba(0,0,0,0.35)] dark:border-white/[0.12] dark:bg-[#242424] dark:text-[#f3f3f3] dark:shadow-[0_24px_64px_rgba(0,0,0,0.65)]"
      >
        {/* Modal Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-black/[0.08] bg-white px-4 py-3 dark:border-white/[0.08] dark:bg-[#2b2b2b]">
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] ${
                mode === "move"
                  ? "bg-amber-500/12 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400"
                  : "bg-[#0067c0]/12 text-[#0067c0] dark:bg-[#60cdff]/15 dark:text-[#60cdff]"
              }`}
            >
              {mode === "move" ? (
                <FolderOutput size={17} />
              ) : (
                <FolderInput size={17} />
              )}
            </div>
            <div className="min-w-0">
              <h2
                id="destination-modal-title"
                className="truncate text-[14px] font-semibold leading-tight"
              >
                {title}
              </h2>
              <p className="mt-0.5 truncate text-[11.5px] text-neutral-500 dark:text-neutral-400">
                {subtitle}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={closeDestinationModal}
            aria-label="Close dialog"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] text-neutral-500 transition-colors hover:bg-black/[0.06] hover:text-[#1a1a1a] dark:text-neutral-400 dark:hover:bg-white/[0.08] dark:hover:text-white"
          >
            <X size={15} />
          </button>
        </div>

        {/* Quick Suggestions: Quick Access, Cloud Drives & Recent Destinations */}
        <div className="shrink-0 space-y-2 border-b border-black/[0.08] bg-[#f3f5f8] px-4 py-2.5 dark:border-white/[0.08] dark:bg-[#202020]">
          {quickAccessPills.length > 0 && (
            <div>
              <div className="mb-1.5 text-[10.5px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                Quick access &amp; Cloud
              </div>
              <div className="flex flex-wrap gap-1.5">
                {quickAccessPills.map((pill) => {
                  const isActive = normalizedSelected === pill.path;
                  return (
                    <button
                      key={pill.path}
                      type="button"
                      title={pill.path}
                      onClick={() => setDestPath(pill.path)}
                      className={`flex h-[27px] max-w-[180px] items-center gap-1.5 rounded-[5px] border px-2 text-[12px] transition-colors ${
                        isActive
                          ? "border-[#0067c0]/50 bg-[#0067c0]/12 font-medium text-[#0067c0] dark:border-[#60cdff]/50 dark:bg-[#60cdff]/16 dark:text-[#60cdff]"
                          : "border-black/[0.08] bg-white text-[#2a2a2a] hover:bg-black/[0.04] dark:border-white/[0.08] dark:bg-[#2c2c2c] dark:text-[#e2e2e2] dark:hover:bg-white/[0.08]"
                      }`}
                    >
                      <span className="shrink-0">{pill.icon}</span>
                      <span className="truncate">{pill.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {recentDestinations.length > 0 && (
            <div>
              <div className="mb-1.5 text-[10.5px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                Recent locations
              </div>
              <div className="flex flex-wrap gap-1.5">
                {recentDestinations.slice(0, 5).map((recentPath) => {
                  const isActive = normalizedSelected === recentPath;
                  const label = getPathTitle(recentPath, specialPaths?.home);
                  return (
                    <button
                      key={recentPath}
                      type="button"
                      title={recentPath}
                      onClick={() => setDestPath(recentPath)}
                      className={`flex h-[26px] max-w-[200px] items-center gap-1.5 rounded-[5px] border px-2 text-[11.5px] transition-colors ${
                        isActive
                          ? "border-[#0067c0]/50 bg-[#0067c0]/12 font-medium text-[#0067c0] dark:border-[#60cdff]/50 dark:bg-[#60cdff]/16 dark:text-[#60cdff]"
                          : "border-black/[0.08] bg-white/80 text-[#3a3a3a] hover:bg-black/[0.04] dark:border-white/[0.08] dark:bg-[#2a2a2a] dark:text-[#d6d6d6] dark:hover:bg-white/[0.08]"
                      }`}
                    >
                      <Clock
                        size={12}
                        className="shrink-0 text-neutral-400 dark:text-neutral-500"
                      />
                      <span className="truncate">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Direct Path Input */}
        <div className="shrink-0 border-b border-black/[0.07] bg-white px-4 py-2.5 dark:border-white/[0.07] dark:bg-[#1f1f1f]">
          <label
            htmlFor="dest-path-input"
            className="mb-1 block text-[11px] font-medium text-neutral-500 dark:text-neutral-400"
          >
            Destination folder path
          </label>
          <div className="flex h-[32px] items-center gap-2 rounded-[6px] border border-black/[0.1] bg-[#f3f4f6] px-2.5 transition-colors focus-within:border-[#0067c0] focus-within:bg-white focus-within:ring-1 focus-within:ring-[#0067c0]/30 dark:border-white/[0.1] dark:bg-[#272727] dark:focus-within:border-[#60cdff] dark:focus-within:bg-[#1c1c1c] dark:focus-within:ring-[#60cdff]/25">
            <Folder
              size={14}
              className="shrink-0 fill-amber-400/90 text-amber-500 dark:fill-amber-400/85 dark:text-amber-300"
            />
            <input
              id="dest-path-input"
              type="text"
              value={destPath}
              onChange={(e) => setDestPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isCreatingFolder) {
                  e.preventDefault();
                  void handleConfirm();
                }
              }}
              placeholder="/Users/... or ~/Documents"
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] text-[#1a1a1a] outline-none selection:bg-[#0067c0]/25 dark:text-[#f3f3f3] dark:selection:bg-[#60cdff]/30"
            />
          </div>
        </div>

        {/* Folder Tree Browser */}
        <div
          role="tree"
          className="min-h-0 flex-1 overflow-y-auto bg-white px-3 py-2 dark:bg-[#191919]"
        >
          {specialPaths?.home && (
            <ModalTreeNode
              name={specialPaths.home.split("/").filter(Boolean).pop() ?? "Home"}
              path={specialPaths.home}
              selectedPath={normalizedSelected}
              onSelect={setDestPath}
              refreshVersions={refreshVersions}
              defaultExpanded
              icon={
                <Home
                  size={15}
                  className="shrink-0 text-sky-600 dark:text-sky-400"
                />
              }
            />
          )}

          {(specialPaths?.cloud_drives ?? []).map((drive) => (
            <ModalTreeNode
              key={drive.path}
              name={drive.name}
              path={drive.path}
              selectedPath={normalizedSelected}
              onSelect={setDestPath}
              refreshVersions={refreshVersions}
              icon={
                <Cloud
                  size={15}
                  className="shrink-0 text-sky-500 dark:text-sky-400"
                />
              }
            />
          ))}

          {networkDrives.map((drive) => (
            <ModalTreeNode
              key={drive.path}
              name={`${drive.name} (${drive.protocol})`}
              path={drive.path}
              selectedPath={normalizedSelected}
              onSelect={setDestPath}
              refreshVersions={refreshVersions}
              icon={
                <Network
                  size={15}
                  className="shrink-0 text-teal-600 dark:text-teal-400"
                />
              }
            />
          ))}

          <ModalTreeNode
            name="Macintosh HD"
            path="/"
            selectedPath={normalizedSelected}
            onSelect={setDestPath}
            refreshVersions={refreshVersions}
            icon={
              <HardDrive
                size={15}
                className="shrink-0 text-neutral-600 dark:text-neutral-300"
              />
            }
          />
        </div>

        {/* Inline New Folder Creation Bar */}
        {isCreatingFolder && (
          <div className="flex shrink-0 items-center gap-2 border-t border-black/[0.08] bg-[#f3f5f8] px-4 py-2 dark:border-white/[0.08] dark:bg-[#202020]">
            <FolderPlus
              size={15}
              className="shrink-0 text-amber-500 dark:text-amber-400"
            />
            <input
              ref={newFolderInputRef}
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreateNewFolderHere();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setIsCreatingFolder(false);
                }
              }}
              placeholder="New folder name"
              spellCheck={false}
              className="h-[28px] min-w-0 flex-1 rounded-[5px] border border-[#0067c0] bg-white px-2 text-[12.5px] text-[#1a1a1a] outline-none dark:border-[#60cdff] dark:bg-[#191919] dark:text-white"
            />
            <button
              type="button"
              disabled={isCreatingPending || !newFolderName.trim()}
              onClick={() => void handleCreateNewFolderHere()}
              className="flex h-[28px] items-center gap-1 rounded-[5px] bg-[#0067c0] px-2.5 text-[12px] font-medium text-white transition-colors hover:bg-[#005aa8] disabled:opacity-50 dark:bg-[#60cdff] dark:text-[#141414] dark:hover:bg-[#7ad5ff]"
            >
              {isCreatingPending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Check size={13} />
              )}
              <span>Create</span>
            </button>
            <button
              type="button"
              onClick={() => setIsCreatingFolder(false)}
              className="flex h-[28px] items-center rounded-[5px] px-2 text-[12px] text-neutral-500 hover:bg-black/[0.06] dark:text-neutral-400 dark:hover:bg-white/[0.08]"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Modal Footer Action Buttons */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-black/[0.08] bg-[#f3f5f8] px-4 py-3 dark:border-white/[0.08] dark:bg-[#2b2b2b]">
          <button
            type="button"
            disabled={isSubmitting || !destPath.trim()}
            onClick={() => {
              setNewFolderName("New folder");
              setIsCreatingFolder(true);
            }}
            className="flex h-[32px] items-center gap-1.5 rounded-[5px] border border-black/[0.1] bg-white px-3 text-[12.5px] font-medium text-[#1f1f1f] transition-colors hover:bg-black/[0.04] disabled:opacity-50 dark:border-white/[0.1] dark:bg-[#333333] dark:text-[#f0f0f0] dark:hover:bg-[#3c3c3c]"
          >
            <FolderPlus
              size={14}
              className="text-amber-500 dark:text-amber-400"
            />
            <span>New Folder</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={closeDestinationModal}
              className="flex h-[32px] items-center justify-center rounded-[5px] border border-black/[0.1] bg-white px-4 text-[12.5px] font-medium text-[#1f1f1f] transition-colors hover:bg-black/[0.04] disabled:opacity-50 dark:border-white/[0.1] dark:bg-[#333333] dark:text-[#f0f0f0] dark:hover:bg-[#3c3c3c]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSubmitting || !destPath.trim()}
              onClick={() => void handleConfirm()}
              className="flex h-[32px] min-w-[104px] items-center justify-center gap-1.5 rounded-[5px] bg-[#0067c0] px-4 text-[12.5px] font-medium text-white transition-colors hover:bg-[#005aa8] active:bg-[#004e92] disabled:opacity-50 dark:bg-[#60cdff] dark:text-[#141414] dark:hover:bg-[#7ad5ff] dark:active:bg-[#4ec0f5]"
            >
              {isSubmitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : mode === "move" ? (
                <FolderOutput size={14} />
              ) : (
                <FolderInput size={14} />
              )}
              <span>{mode === "move" ? "Move Here" : "Copy Here"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
