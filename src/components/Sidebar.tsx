import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  AppWindow,
  Cloud,
  Download,
  FileText,
  Film,
  Folder,
  HardDrive,
  Home,
  Image,
  Inbox,
  Monitor,
  Music,
  Network,
  Pin,
  Plus,
  RotateCw,
  Unplug,
} from "lucide-react";
import {
  loadCustomInboxPath,
  loadPinnedFolders,
  type PinnedCabinetFolder,
} from "../lib/cabinetStorage";
import {
  useActivePane,
  useExplorerStore,
} from "../store/useExplorerStore";
import { TreeNode } from "./TreeNode";

interface QuickAccessItem {
  label: string;
  path: string;
  icon: React.ReactNode;
}

export function Sidebar() {
  const specialPaths = useExplorerStore((s) => s.specialPaths);
  const networkDrives = useExplorerStore((s) => s.networkDrives);
  const isLoadingNetworkDrives = useExplorerStore(
    (s) => s.isLoadingNetworkDrives
  );
  const activePane = useActivePane();
  const dropTargetFolder = useExplorerStore((s) => s.dropTargetFolder);
  const dropCopyMode = useExplorerStore((s) => s.dropCopyMode);
  const navigateTo = useExplorerStore((s) => s.navigateTo);
  const addTab = useExplorerStore((s) => s.addTab);
  const openNetworkModal = useExplorerStore((s) => s.openNetworkModal);
  const refreshNetworkDrives = useExplorerStore((s) => s.refreshNetworkDrives);
  const disconnectLanDrive = useExplorerStore((s) => s.disconnectLanDrive);

  const [width, setWidth] = useState(244);
  const [pinnedFolders, setPinnedFolders] = useState<PinnedCabinetFolder[]>(() =>
    loadPinnedFolders()
  );
  const [customInboxPath, setCustomInboxPath] = useState<string | null>(() =>
    loadCustomInboxPath()
  );
  const isResizingRef = useRef(false);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen("mxplore:sync-cabinet", () => {
      setPinnedFolders(loadPinnedFolders());
      setCustomInboxPath(loadCustomInboxPath());
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return;
      const nextWidth = Math.min(
        400,
        Math.max(180, startWidth + (moveEvent.clientX - startX))
      );
      setWidth(nextWidth);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleMiddleClickOpenTab = (
    e: React.MouseEvent,
    path: string
  ) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      addTab(path);
    }
  };

  const handleAuxClickPrevent = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const quickAccessItems: QuickAccessItem[] = [];
  const effectiveInboxPath = customInboxPath ?? specialPaths?.inbox ?? null;
  if (effectiveInboxPath) {
    quickAccessItems.push({
      label: "Inbox (Unsorted)",
      path: effectiveInboxPath,
      icon: (
        <Inbox
          size={15}
          className="shrink-0 text-amber-500 dark:text-amber-400"
        />
      ),
    });
  }
  if (specialPaths?.home) {
    quickAccessItems.push({
      label: "Home",
      path: specialPaths.home,
      icon: <Home size={15} className="shrink-0 text-sky-600 dark:text-sky-400" />,
    });
  }
  if (specialPaths?.desktop) {
    quickAccessItems.push({
      label: "Desktop",
      path: specialPaths.desktop,
      icon: (
        <Monitor
          size={15}
          className="shrink-0 text-blue-600 dark:text-blue-400"
        />
      ),
    });
  }
  if (specialPaths?.downloads) {
    quickAccessItems.push({
      label: "Downloads",
      path: specialPaths.downloads,
      icon: (
        <Download
          size={15}
          className="shrink-0 text-emerald-600 dark:text-emerald-400"
        />
      ),
    });
  }
  if (specialPaths?.documents) {
    quickAccessItems.push({
      label: "Documents",
      path: specialPaths.documents,
      icon: (
        <FileText
          size={15}
          className="shrink-0 text-indigo-500 dark:text-indigo-400"
        />
      ),
    });
  }
  if (specialPaths?.pictures) {
    quickAccessItems.push({
      label: "Pictures",
      path: specialPaths.pictures,
      icon: (
        <Image
          size={15}
          className="shrink-0 text-teal-600 dark:text-teal-400"
        />
      ),
    });
  }
  if (specialPaths?.music) {
    quickAccessItems.push({
      label: "Music",
      path: specialPaths.music,
      icon: (
        <Music
          size={15}
          className="shrink-0 text-pink-600 dark:text-pink-400"
        />
      ),
    });
  }
  if (specialPaths?.videos) {
    quickAccessItems.push({
      label: "Movies",
      path: specialPaths.videos,
      icon: (
        <Film
          size={15}
          className="shrink-0 text-purple-600 dark:text-purple-400"
        />
      ),
    });
  }
  if (specialPaths?.applications) {
    quickAccessItems.push({
      label: "Applications",
      path: specialPaths.applications,
      icon: (
        <AppWindow
          size={15}
          className="shrink-0 text-amber-600 dark:text-amber-400"
        />
      ),
    });
  }

  const cloudDrives = specialPaths?.cloud_drives ?? [];

  return (
    <aside
      style={{ width }}
      className="relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-black/[0.08] bg-[#f3f5f8] select-none dark:border-white/[0.08] dark:bg-[#202020]"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {/* Quick Access */}
        <section className="mb-3">
          <div className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
            Quick access
          </div>
          <div className="flex flex-col gap-0.5">
            {quickAccessItems.map((item) => {
              const isActive = activePane.currentPath === item.path;
              const isDropTarget = dropTargetFolder === item.path;
              return (
                <button
                  key={item.path}
                  type="button"
                  data-drop-folder={item.path}
                  onClick={() => navigateTo(item.path)}
                  onMouseDown={(e) => handleMiddleClickOpenTab(e, item.path)}
                  onAuxClick={handleAuxClickPrevent}
                  title={`${item.path} (Middle-click to open in new tab)`}
                  className={`relative flex h-[30px] w-full cursor-default items-center gap-2.5 rounded-[5px] px-2.5 text-left text-[12.5px] transition-colors ${
                    isDropTarget
                      ? dropCopyMode
                        ? "bg-emerald-500/18 font-medium text-emerald-800 ring-2 ring-inset ring-emerald-500 dark:bg-emerald-400/20 dark:text-emerald-200 dark:ring-emerald-400"
                        : "bg-[#0067c0]/18 font-medium text-[#0067c0] ring-2 ring-inset ring-[#0067c0] dark:bg-[#60cdff]/20 dark:text-[#60cdff] dark:ring-[#60cdff]"
                      : isActive
                        ? "bg-black/[0.07] font-medium text-[#1a1a1a] dark:bg-white/[0.09] dark:text-[#ffffff]"
                        : "text-[#2c2c2c] hover:bg-black/[0.045] dark:text-[#dcdcdc] dark:hover:bg-white/[0.055]"
                  }`}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-[#0067c0] dark:bg-[#60cdff]" />
                  )}
                  {item.icon}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Pinned to Quick Cabinet */}
        {pinnedFolders.length > 0 && (
          <section className="mb-3 border-t border-black/[0.06] pt-2.5 dark:border-white/[0.06]">
            <div className="flex items-center gap-1 px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
              <Pin size={10} />
              <span>Pinned Cabinet</span>
            </div>
            <div className="flex flex-col gap-0.5">
              {pinnedFolders.map((item) => {
                const isActive = activePane.currentPath === item.path;
                const isDropTarget = dropTargetFolder === item.path;
                return (
                  <button
                    key={item.path}
                    type="button"
                    data-drop-folder={item.path}
                    onClick={() => navigateTo(item.path)}
                    onMouseDown={(e) => handleMiddleClickOpenTab(e, item.path)}
                    onAuxClick={handleAuxClickPrevent}
                    title={`${item.path} (Middle-click to open in new tab)`}
                    className={`relative flex h-[30px] w-full cursor-default items-center gap-2.5 rounded-[5px] px-2.5 text-left text-[12.5px] transition-colors ${
                      isDropTarget
                        ? dropCopyMode
                          ? "bg-emerald-500/18 font-medium text-emerald-800 ring-2 ring-inset ring-emerald-500 dark:bg-emerald-400/20 dark:text-emerald-200 dark:ring-emerald-400"
                          : "bg-[#0067c0]/18 font-medium text-[#0067c0] ring-2 ring-inset ring-[#0067c0] dark:bg-[#60cdff]/20 dark:text-[#60cdff] dark:ring-[#60cdff]"
                        : isActive
                          ? "bg-black/[0.07] font-medium text-[#1a1a1a] dark:bg-white/[0.09] dark:text-[#ffffff]"
                          : "text-[#2c2c2c] hover:bg-black/[0.045] dark:text-[#dcdcdc] dark:hover:bg-white/[0.055]"
                    }`}
                  >
                    {isActive && (
                      <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-[#0067c0] dark:bg-[#60cdff]" />
                    )}
                    <Folder
                      size={15}
                      className="shrink-0 fill-amber-400/90 text-amber-500 dark:fill-amber-400/85 dark:text-amber-300"
                    />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Cloud Drives */}
        {cloudDrives.length > 0 && (
          <section className="mb-3 border-t border-black/[0.06] pt-2.5 dark:border-white/[0.06]">
            <div className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
              Cloud drives
            </div>
            <div role="tree" className="flex flex-col gap-0.5">
              {cloudDrives.map((drive) => (
                <TreeNode
                  key={drive.path}
                  name={drive.name}
                  path={drive.path}
                  icon={
                    <Cloud
                      size={15}
                      className="shrink-0 text-sky-500 dark:text-sky-400"
                    />
                  }
                />
              ))}
            </div>
          </section>
        )}

        {/* Network (LAN) Drives */}
        <section className="mb-3 border-t border-black/[0.06] pt-2.5 dark:border-white/[0.06]">
          <div className="flex items-center justify-between px-2.5 pb-1">
            <span className="text-[11px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
              Network (LAN)
            </span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => openNetworkModal()}
                title="Connect to LAN drive (⌘K)"
                aria-label="Connect to LAN drive"
                className="flex h-5 w-5 items-center justify-center rounded-[4px] text-neutral-500 transition-colors hover:bg-black/[0.07] hover:text-[#1a1a1a] dark:text-neutral-400 dark:hover:bg-white/[0.09] dark:hover:text-white"
              >
                <Plus size={12} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                onClick={() => void refreshNetworkDrives()}
                title="Refresh mounted LAN drives"
                aria-label="Refresh mounted LAN drives"
                className="flex h-5 w-5 items-center justify-center rounded-[4px] text-neutral-500 transition-colors hover:bg-black/[0.07] hover:text-[#1a1a1a] dark:text-neutral-400 dark:hover:bg-white/[0.09] dark:hover:text-white"
              >
                <RotateCw
                  size={11}
                  className={isLoadingNetworkDrives ? "animate-spin" : ""}
                />
              </button>
            </div>
          </div>

          {networkDrives.length > 0 ? (
            <div role="tree" className="flex flex-col gap-0.5">
              {networkDrives.map((drive) => (
                <TreeNode
                  key={drive.path}
                  name={drive.name}
                  path={drive.path}
                  tooltip={`${drive.protocol} • ${drive.remote_url} (${drive.path})`}
                  icon={
                    <Network
                      size={15}
                      className="shrink-0 text-teal-600 dark:text-teal-400"
                    />
                  }
                  trailingAction={
                    <button
                      type="button"
                      onClick={() => void disconnectLanDrive(drive.path)}
                      title={`Disconnect ${drive.name}`}
                      aria-label={`Disconnect ${drive.name}`}
                      className="flex h-5 w-5 items-center justify-center rounded-[4px] text-neutral-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-500/12 hover:text-red-600 dark:hover:text-red-400"
                    >
                      <Unplug size={12} />
                    </button>
                  }
                />
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => openNetworkModal()}
              className="flex h-[30px] w-full items-center gap-2 rounded-[5px] px-2.5 text-left text-[12px] text-neutral-500 transition-colors hover:bg-black/[0.045] hover:text-[#1a1a1a] dark:text-neutral-400 dark:hover:bg-white/[0.055] dark:hover:text-white"
            >
              <Network
                size={14}
                className="shrink-0 text-teal-600 dark:text-teal-400"
              />
              <span className="min-w-0 flex-1 truncate">
                Connect LAN drive...
              </span>
              <span className="shrink-0 text-[10.5px] opacity-60">⌘K</span>
            </button>
          )}
        </section>

        {/* This Mac / Drive Tree View */}
        <section className="border-t border-black/[0.06] pt-2.5 dark:border-white/[0.06]">
          <div className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
            This Mac
          </div>
          <div role="tree" className="flex flex-col gap-0.5">
            {specialPaths?.home && (
              <TreeNode
                name={
                  specialPaths.home.split("/").filter(Boolean).pop() ?? "Home"
                }
                path={specialPaths.home}
                icon={
                  <Home
                    size={15}
                    className="shrink-0 text-sky-600 dark:text-sky-400"
                  />
                }
              />
            )}
            <TreeNode
              name="Macintosh HD"
              path="/"
              icon={
                <HardDrive
                  size={15}
                  className="shrink-0 text-neutral-600 dark:text-neutral-300"
                />
              }
            />
          </div>
        </section>
      </div>

      {/* Resizable right edge handle */}
      <div
        onMouseDown={startResize}
        className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize transition-colors hover:bg-[#0067c0]/40 dark:hover:bg-[#60cdff]/40"
      />
    </aside>
  );
}
