import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Cloud,
  Download,
  FileArchive,
  FileText,
  Folder,
  HardDrive,
  Home,
  Monitor,
  Network,
  Plus,
  X,
} from "lucide-react";
import { isZipVirtualPath } from "../lib/format";
import {
  findNetworkDriveForPath,
  useExplorerStore,
  type TabItem,
} from "../store/useExplorerStore";
import type { NetworkDrive, SpecialPaths } from "../lib/tauriApi";

function TabIcon({
  path,
  specialPaths,
  networkDrives,
}: {
  path: string;
  specialPaths: SpecialPaths | null;
  networkDrives: NetworkDrive[];
}) {
  if (isZipVirtualPath(path)) {
    return (
      <FileArchive
        size={14}
        className="shrink-0 text-amber-600 dark:text-amber-400"
      />
    );
  }
  if (findNetworkDriveForPath(path, networkDrives)) {
    return (
      <Network
        size={14}
        className="shrink-0 text-teal-600 dark:text-teal-400"
      />
    );
  }
  if (path === "/") {
    return (
      <HardDrive
        size={14}
        className="shrink-0 text-sky-600 dark:text-sky-400"
      />
    );
  }
  if (specialPaths?.home && path === specialPaths.home) {
    return (
      <Home size={14} className="shrink-0 text-sky-600 dark:text-sky-400" />
    );
  }
  if (specialPaths?.desktop && path === specialPaths.desktop) {
    return (
      <Monitor
        size={14}
        className="shrink-0 text-blue-600 dark:text-blue-400"
      />
    );
  }
  if (specialPaths?.downloads && path === specialPaths.downloads) {
    return (
      <Download
        size={14}
        className="shrink-0 text-emerald-600 dark:text-emerald-400"
      />
    );
  }
  if (specialPaths?.documents && path === specialPaths.documents) {
    return (
      <FileText
        size={14}
        className="shrink-0 text-indigo-500 dark:text-indigo-400"
      />
    );
  }
  if (
    specialPaths?.cloud_drives.some(
      (d) => path === d.path || path.startsWith(`${d.path}/`)
    )
  ) {
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
}

export function TabBar() {
  const tabs = useExplorerStore((s) => s.tabs);
  const activeTabId = useExplorerStore((s) => s.activeTabId);
  const specialPaths = useExplorerStore((s) => s.specialPaths);
  const networkDrives = useExplorerStore((s) => s.networkDrives);
  const dropTargetFolder = useExplorerStore((s) => s.dropTargetFolder);
  const dropCopyMode = useExplorerStore((s) => s.dropCopyMode);
  const addTab = useExplorerStore((s) => s.addTab);
  const closeTab = useExplorerStore((s) => s.closeTab);
  const setActiveTab = useExplorerStore((s) => s.setActiveTab);

  const handleTabMouseDown = (
    e: React.MouseEvent<HTMLDivElement>,
    tab: TabItem
  ) => {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(tab.id);
    }
  };

  const handleTitlebarDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      void getCurrentWindow().toggleMaximize();
    }
  };

  return (
    <div
      data-tauri-drag-region
      onDoubleClick={handleTitlebarDoubleClick}
      className="flex h-[40px] shrink-0 items-end gap-1 bg-[#e8edf5] pr-2 pl-[78px] pt-[6px] select-none dark:bg-[#202020]"
    >
      <div
        data-tauri-drag-region
        onDoubleClick={handleTitlebarDoubleClick}
        className="flex min-w-0 max-w-[calc(100%-64px)] items-end gap-0.5 overflow-x-auto no-scrollbar"
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const nextTab = tabs[index + 1];
          const showDivider = !isActive && nextTab?.id !== activeTabId;
          const canDrop = !isZipVirtualPath(tab.currentPath);
          const isDropTarget = canDrop && dropTargetFolder === tab.currentPath;

          return (
            <div key={tab.id} className="flex items-end">
              <div
                role="tab"
                data-drop-folder={canDrop ? tab.currentPath : undefined}
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                onMouseDown={(e) => handleTabMouseDown(e, tab)}
                title={tab.currentPath}
                className={`group relative flex h-[34px] w-[196px] min-w-[120px] max-w-[230px] cursor-default items-center gap-2 rounded-t-[8px] px-3 text-[12.5px] transition-colors ${
                  isDropTarget
                    ? dropCopyMode
                      ? "z-20 bg-emerald-500/20 font-medium text-emerald-800 ring-2 ring-inset ring-emerald-500 dark:bg-emerald-400/22 dark:text-emerald-200 dark:ring-emerald-400"
                      : "z-20 bg-[#0067c0]/20 font-medium text-[#0067c0] ring-2 ring-inset ring-[#0067c0] dark:bg-[#60cdff]/22 dark:text-[#60cdff] dark:ring-[#60cdff]"
                    : isActive
                      ? "z-10 border border-b-0 border-black/[0.08] bg-[#f9fafc] font-medium text-[#1a1a1a] shadow-[0_-1px_4px_rgba(0,0,0,0.03)] dark:border-white/[0.08] dark:bg-[#2c2c2c] dark:text-[#f3f3f3]"
                      : "text-[#4a4a4a] hover:bg-black/[0.05] dark:text-[#b5b5b5] dark:hover:bg-white/[0.06]"
                }`}
              >
                <TabIcon
                  path={tab.currentPath}
                  specialPaths={specialPaths}
                  networkDrives={networkDrives}
                />
                <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                <button
                  type="button"
                  aria-label={`Close ${tab.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] transition-colors ${
                    isActive
                      ? "text-[#5a5a5a] hover:bg-black/[0.08] hover:text-[#1a1a1a] dark:text-[#b0b0b0] dark:hover:bg-white/[0.1] dark:hover:text-white"
                      : "opacity-0 group-hover:opacity-100 hover:bg-black/[0.08] dark:hover:bg-white/[0.1]"
                  }`}
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </div>
              {showDivider && index < tabs.length - 1 && (
                <div className="mb-2 h-4 w-[1px] shrink-0 bg-black/[0.12] dark:bg-white/[0.12]" />
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => addTab()}
          title="New tab (⌘T)"
          aria-label="New tab"
          className="mb-[3px] ml-1 flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[6px] text-[#4a4a4a] transition-colors hover:bg-black/[0.06] active:bg-black/[0.1] dark:text-[#cfcfcf] dark:hover:bg-white/[0.08] dark:active:bg-white/[0.12]"
        >
          <Plus size={15} strokeWidth={2} />
        </button>
      </div>

      {/* Permanent draggable titlebar handle (always accessible even with many tabs open) */}
      <div
        data-tauri-drag-region
        onDoubleClick={handleTitlebarDoubleClick}
        className="h-[34px] min-w-[64px] flex-1"
      />
    </div>
  );
}
