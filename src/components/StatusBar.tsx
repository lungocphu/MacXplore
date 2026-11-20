import { useMemo } from "react";
import {
  Columns2,
  FileArchive,
  Grid2x2,
  LayoutGrid,
  LayoutList,
  List,
  Network,
} from "lucide-react";
import {
  findNetworkDriveForPath,
  useActivePane,
  useExplorerStore,
  type ViewMode,
} from "../store/useExplorerStore";
import { formatFileSize, isZipVirtualPath } from "../lib/format";

const QUICK_VIEWS: Array<{
  mode: ViewMode;
  title: string;
  icon: React.ReactNode;
}> = [
  { mode: "details", title: "Details view", icon: <LayoutList size={12} /> },
  { mode: "list", title: "List view", icon: <List size={12} /> },
  {
    mode: "medium-icons",
    title: "Medium icons",
    icon: <LayoutGrid size={12} />,
  },
  { mode: "large-icons", title: "Large icons", icon: <Grid2x2 size={12} /> },
];

export function StatusBar() {
  const activePane = useActivePane();
  const dualPane = useExplorerStore((s) => s.dualPane);
  const networkDrives = useExplorerStore((s) => s.networkDrives);
  const viewMode = useExplorerStore((s) => s.viewMode);
  const showHidden = useExplorerStore((s) => s.showHidden);
  const clipboard = useExplorerStore((s) => s.clipboard);
  const setViewMode = useExplorerStore((s) => s.setViewMode);

  const activeLanDrive = findNetworkDriveForPath(
    activePane.currentPath,
    networkDrives
  );
  const isInZip = isZipVirtualPath(activePane.currentPath);

  const sourceEntries = activePane.spotlightActive
    ? activePane.spotlightResults
    : activePane.entries;

  const visibleCount = useMemo(() => {
    if (activePane.spotlightActive) return activePane.spotlightResults.length;
    const q = activePane.searchQuery.trim().toLowerCase();
    if (!q) return activePane.entries.length;
    return activePane.entries.filter((e) =>
      e.name.toLowerCase().includes(q)
    ).length;
  }, [
    activePane.spotlightActive,
    activePane.spotlightResults.length,
    activePane.entries,
    activePane.searchQuery,
  ]);

  const selectedStats = useMemo(() => {
    if (activePane.selectedPaths.length === 0) {
      return { count: 0, totalBytes: 0, hasFiles: false };
    }
    const selectedSet = new Set(activePane.selectedPaths);
    let totalBytes = 0;
    let hasFiles = false;
    for (const entry of sourceEntries) {
      if (selectedSet.has(entry.path) && !entry.is_dir) {
        totalBytes += entry.size;
        hasFiles = true;
      }
    }
    return {
      count: activePane.selectedPaths.length,
      totalBytes,
      hasFiles,
    };
  }, [activePane.selectedPaths, sourceEntries]);

  return (
    <footer className="flex h-[26px] shrink-0 items-center justify-between border-t border-black/[0.08] bg-[#f3f5f8] px-3 text-[11.5px] text-neutral-600 select-none dark:border-white/[0.08] dark:bg-[#202020] dark:text-neutral-400">
      <div className="flex items-center gap-3 overflow-hidden">
        {dualPane && (
          <>
            <span className="flex items-center gap-1 font-medium text-[#0067c0] dark:text-[#60cdff]">
              <Columns2 size={11} />
              <span>
                {activePane.paneId === "left" ? "Left Pane" : "Right Pane"}
              </span>
            </span>
            <span className="h-3 w-[1px] bg-black/[0.14] dark:bg-white/[0.14]" />
          </>
        )}

        {isInZip && (
          <>
            <span className="flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
              <FileArchive size={11} />
              <span>ZIP Archive (Read-only)</span>
            </span>
            <span className="h-3 w-[1px] bg-black/[0.14] dark:bg-white/[0.14]" />
          </>
        )}

        {activeLanDrive && (
          <>
            <span
              title={activeLanDrive.remote_url}
              className="flex items-center gap-1 font-medium text-teal-700 dark:text-teal-400"
            >
              <Network size={11} />
              <span>
                LAN &bull; {activeLanDrive.protocol}
                {activeLanDrive.host ? ` (${activeLanDrive.host})` : ""}
              </span>
            </span>
            <span className="h-3 w-[1px] bg-black/[0.14] dark:bg-white/[0.14]" />
          </>
        )}

        <span>
          {visibleCount} {visibleCount === 1 ? "item" : "items"}
        </span>

        {selectedStats.count > 0 && (
          <>
            <span className="h-3 w-[1px] bg-black/[0.14] dark:bg-white/[0.14]" />
            <span>
              {selectedStats.count}{" "}
              {selectedStats.count === 1 ? "item" : "items"} selected
              {selectedStats.hasFiles
                ? ` (${formatFileSize(selectedStats.totalBytes)})`
                : ""}
            </span>
          </>
        )}

        {clipboard.action && clipboard.paths.length > 0 && (
          <>
            <span className="h-3 w-[1px] bg-black/[0.14] dark:bg-white/[0.14]" />
            <span className="text-[#0067c0] dark:text-[#60cdff]">
              {clipboard.paths.length}{" "}
              {clipboard.action === "cut" ? "cut" : "copied"}
            </span>
          </>
        )}

        {showHidden && (
          <>
            <span className="h-3 w-[1px] bg-black/[0.14] dark:bg-white/[0.14]" />
            <span>Hidden items shown</span>
          </>
        )}
      </div>

      {/* Bottom-right Windows 11 quick view switcher */}
      <div className="flex items-center gap-0.5">
        {QUICK_VIEWS.map((item) => (
          <button
            key={item.mode}
            type="button"
            onClick={() => setViewMode(item.mode)}
            title={item.title}
            aria-label={item.title}
            className={`flex h-[20px] w-[22px] items-center justify-center rounded-[3px] transition-colors ${
              viewMode === item.mode
                ? "bg-black/[0.1] text-[#0067c0] dark:bg-white/[0.14] dark:text-[#60cdff]"
                : "hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
            }`}
          >
            {item.icon}
          </button>
        ))}
      </div>
    </footer>
  );
}
