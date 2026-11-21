import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FolderOpen,
  Search,
  Undo2,
  X,
} from "lucide-react";
import { TabBar } from "./components/TabBar";
import { NavigationBar } from "./components/NavigationBar";
import { CommandBar } from "./components/CommandBar";
import { Sidebar } from "./components/Sidebar";
import { FilePane } from "./components/FilePane";
import { StatusBar } from "./components/StatusBar";
import { ContextMenu } from "./components/ContextMenu";
import { DestinationModal } from "./components/DestinationModal";
import { NetworkDriveModal } from "./components/NetworkDriveModal";
import { SystemIntegrationModal } from "./components/SystemIntegrationModal";
import { useExplorerShortcuts } from "./hooks/useExplorerShortcuts";
import {
  formatFileSize,
  getParentPath,
  isZipVirtualPath,
  normalizePath,
} from "./lib/format";
import {
  tauriApi,
  type DownloadCompletedEvent,
  type RevealTarget,
} from "./lib/tauriApi";
import {
  getPaneSnapshot,
  useExplorerStore,
  type PaneId,
} from "./store/useExplorerStore";

interface NativeDragEndedEvent {
  paths: string[];
  operation: string;
}

const SPRING_LOAD_DELAY_MS = 750;

function findDropFolderAtLogicalPoint(
  cx: number,
  cy: number,
  leftEl: HTMLElement | null,
  rightEl: HTMLElement | null
): { folderPath: string; paneId: PaneId | null } | null {
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
      let paneId: PaneId | null = null;
      if (rightEl?.contains(target)) {
        paneId = "right";
      } else if (leftEl?.contains(target)) {
        paneId = "left";
      }
      return { folderPath: target.dataset.dropFolder, paneId };
    }
  }
  return null;
}

function detectPaneAtLogicalPoint(
  cx: number,
  cy: number,
  leftEl: HTMLElement | null,
  rightEl: HTMLElement | null
): PaneId | null {
  const rightRect = rightEl?.getBoundingClientRect();
  const leftRect = leftEl?.getBoundingClientRect();

  if (
    rightRect &&
    cx >= rightRect.left &&
    cx <= rightRect.right &&
    cy >= rightRect.top &&
    cy <= rightRect.bottom
  ) {
    return "right";
  }
  if (
    leftRect &&
    cx >= leftRect.left &&
    cx <= leftRect.right &&
    cy >= leftRect.top &&
    cy <= leftRect.bottom
  ) {
    return "left";
  }

  return null;
}

function isSelfOrDescendantDrop(
  draggedPaths: string[],
  targetFolder: string
): boolean {
  if (draggedPaths.length === 0) return false;
  const normTarget = normalizePath(targetFolder);
  return draggedPaths.some((src) => {
    const normSrc = normalizePath(src);
    return normTarget === normSrc || normTarget.startsWith(`${normSrc}/`);
  });
}

export function App() {
  const initExplorer = useExplorerStore((s) => s.initExplorer);
  const navigateTo = useExplorerStore((s) => s.navigateTo);
  const revealTargetInPane = useExplorerStore((s) => s.revealTargetInPane);
  const revealPath = useExplorerStore((s) => s.revealPath);
  const revealInFinder = useExplorerStore((s) => s.revealInFinder);
  const openIntegrationModal = useExplorerStore((s) => s.openIntegrationModal);
  const recentDownloadNotice = useExplorerStore((s) => s.recentDownloadNotice);
  const setRecentDownloadNotice = useExplorerStore(
    (s) => s.setRecentDownloadNotice
  );
  const toast = useExplorerStore((s) => s.toast);
  const clearToast = useExplorerStore((s) => s.clearToast);
  const undoLastAction = useExplorerStore((s) => s.undoLastAction);
  const undoCount = useExplorerStore((s) => s.undoStack.length);
  const isUndoing = useExplorerStore((s) => s.isUndoing);

  const dualPane = useExplorerStore((s) => s.dualPane);
  const activePane = useExplorerStore((s) => s.activePane);
  const dualPaneSplitRatio = useExplorerStore((s) => s.dualPaneSplitRatio);
  const setDualPaneSplitRatio = useExplorerStore(
    (s) => s.setDualPaneSplitRatio
  );
  const toggleDualPane = useExplorerStore((s) => s.toggleDualPane);

  const splitContainerRef = useRef<HTMLDivElement>(null);
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const rightPaneRef = useRef<HTMLDivElement>(null);
  const dragEventSeqRef = useRef<number>(0);
  const springTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const springTargetRef = useRef<string | null>(null);
  const downloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);
  const [dragOverPane, setDragOverPane] = useState<PaneId | null>(null);

  useExplorerShortcuts();

  useEffect(() => {
    void (async () => {
      await initExplorer();
      try {
        const pending = await tauriApi.takePendingRevealPath();
        if (pending) {
          await useExplorerStore.getState().revealTargetInPane(pending);
        }
      } catch {
        // Ignore if running outside Tauri
      }
    })();
  }, [initExplorer]);

  // Listen to navigation, "Show in MXplore" reveal, integration modal, and completed download events
  useEffect(() => {
    let unlistenNav: (() => void) | null = null;
    let unlistenReveal: (() => void) | null = null;
    let unlistenModal: (() => void) | null = null;
    let unlistenDownload: (() => void) | null = null;

    void listen<string>("mxplore:navigate", (event) => {
      if (typeof event.payload === "string" && event.payload.trim()) {
        navigateTo(event.payload);
      }
    }).then((fn) => {
      unlistenNav = fn;
    });

    void listen<RevealTarget>("mxplore:reveal", (event) => {
      if (event.payload && event.payload.directory) {
        void revealTargetInPane(event.payload);
      }
    }).then((fn) => {
      unlistenReveal = fn;
    });

    void listen("mxplore:open-integration-modal", () => {
      openIntegrationModal();
    }).then((fn) => {
      unlistenModal = fn;
    });

    void listen<DownloadCompletedEvent>(
      "mxplore:download-completed",
      (event) => {
        const payload = event.payload;
        if (!payload?.path) return;

        const state = useExplorerStore.getState();
        void state.refreshPathIfOpen(payload.directory);

        if (state.downloadNotificationsEnabled) {
          state.setRecentDownloadNotice(payload);
          if (downloadTimerRef.current) {
            clearTimeout(downloadTimerRef.current);
          }
          downloadTimerRef.current = setTimeout(() => {
            useExplorerStore.getState().setRecentDownloadNotice(null);
            downloadTimerRef.current = null;
          }, 14000);
        }
      }
    ).then((fn) => {
      unlistenDownload = fn;
    });

    return () => {
      unlistenNav?.();
      unlistenReveal?.();
      unlistenModal?.();
      unlistenDownload?.();
      if (downloadTimerRef.current) {
        clearTimeout(downloadTimerRef.current);
        downloadTimerRef.current = null;
      }
    };
  }, [navigateTo, revealTargetInPane, openIntegrationModal]);

  // Refresh source folders when a native drag-out to Finder/Desktop/another app finishes
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<NativeDragEndedEvent>("mxplore:native-drag-ended", (event) => {
      const state = useExplorerStore.getState();
      dragEventSeqRef.current += 1;
      if (springTimerRef.current) {
        clearTimeout(springTimerRef.current);
        springTimerRef.current = null;
      }
      springTargetRef.current = null;
      setDragOverPane(null);
      state.clearDragState();

      const payload = event.payload;
      if (!payload || payload.operation === "none") return;

      const parents = new Set(
        (payload.paths ?? [])
          .map((p) => getParentPath(p))
          .filter((p): p is string => p !== null && !isZipVirtualPath(p))
      );
      for (const dir of parents) {
        void state.refreshPathIfOpen(dir);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // Unified native Drag & Drop listener using EXACT live AppKit cursor coordinates + Spring-Loaded Folders
  useEffect(() => {
    const cancelSpringLoad = () => {
      if (springTimerRef.current) {
        clearTimeout(springTimerRef.current);
        springTimerRef.current = null;
      }
      springTargetRef.current = null;
    };

    const scheduleSpringLoad = (folderPath: string, paneId: PaneId | null) => {
      if (springTargetRef.current === folderPath) return;
      cancelSpringLoad();
      springTargetRef.current = folderPath;

      springTimerRef.current = setTimeout(() => {
        springTimerRef.current = null;
        if (springTargetRef.current !== folderPath) return;

        const curr = useExplorerStore.getState();
        if (curr.dropTargetFolder !== folderPath) return;

        const targetPane: PaneId =
          paneId ?? (curr.dualPane ? curr.activePane : "left");
        const paneSnap = getPaneSnapshot(curr, targetPane);
        if (paneSnap.currentPath === folderPath) return;

        if (curr.dualPane && curr.activePane !== targetPane) {
          curr.setActivePane(targetPane);
        }
        curr.navigateTo(folderPath, targetPane);
        curr.setDropTargetFolder(null);
        springTargetRef.current = null;
      }, SPRING_LOAD_DELAY_MS);
    };

    let unlisten: (() => void) | null = null;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        const seq = ++dragEventSeqRef.current;

        if (payload.type === "enter" || payload.type === "over") {
          void tauriApi.getDragPointerState().then((live) => {
            if (seq !== dragEventSeqRef.current) return;

            const state = useExplorerStore.getState();
            if (!live || !live.inside) {
              cancelSpringLoad();
              state.setDropTargetFolder(null);
              setDragOverPane(null);
              return;
            }

            const hit = findDropFolderAtLogicalPoint(
              live.x,
              live.y,
              leftPaneRef.current,
              rightPaneRef.current
            );

            if (
              hit &&
              !isZipVirtualPath(hit.folderPath) &&
              !isSelfOrDescendantDrop(state.draggingPaths, hit.folderPath)
            ) {
              state.setDropTargetFolder(hit.folderPath, live.option_down);
              setDragOverPane(null);
              scheduleSpringLoad(hit.folderPath, hit.paneId);
              return;
            }

            // Cursor is NOT directly over any target folder -> clear highlight & spring timer immediately
            cancelSpringLoad();
            state.setDropTargetFolder(null, live.option_down);

            const hoveredPane = detectPaneAtLogicalPoint(
              live.x,
              live.y,
              leftPaneRef.current,
              state.dualPane ? rightPaneRef.current : null
            );

            if (hoveredPane) {
              const paneData = getPaneSnapshot(state, hoveredPane);
              const isSameFolderNoOp =
                !live.option_down &&
                state.draggingPaths.length > 0 &&
                state.draggingPaths.every(
                  (src) => getParentPath(src) === paneData.currentPath
                );

              if (!isZipVirtualPath(paneData.currentPath) && !isSameFolderNoOp) {
                setDragOverPane(hoveredPane);
              } else {
                setDragOverPane(null);
              }
            } else {
              setDragOverPane(null);
            }
          });
        } else if (payload.type === "leave") {
          cancelSpringLoad();
          setDragOverPane(null);
          useExplorerStore.getState().setDropTargetFolder(null);
        } else if (payload.type === "drop") {
          cancelSpringLoad();
          setDragOverPane(null);

          const droppedPaths = payload.paths;
          if (droppedPaths.length === 0) {
            useExplorerStore.getState().clearDragState();
            return;
          }

          void (async () => {
            const live = await tauriApi
              .getDragPointerState()
              .catch(() => null);
            const state = useExplorerStore.getState();
            const isCopy = live?.option_down ?? false;
            const mode = isCopy ? "copy" : "move";

            let targetDir: string | null = null;
            let hoveredPane: PaneId | null = null;

            if (live && live.inside) {
              const hit = findDropFolderAtLogicalPoint(
                live.x,
                live.y,
                leftPaneRef.current,
                rightPaneRef.current
              );
              if (hit) {
                targetDir = hit.folderPath;
                hoveredPane = hit.paneId;
              } else {
                hoveredPane = detectPaneAtLogicalPoint(
                  live.x,
                  live.y,
                  leftPaneRef.current,
                  state.dualPane ? rightPaneRef.current : null
                );
              }
            }

            if (!targetDir && hoveredPane) {
              const paneData = getPaneSnapshot(state, hoveredPane);
              targetDir = paneData.currentPath || null;
              if (state.dualPane && state.activePane !== hoveredPane) {
                state.setActivePane(hoveredPane);
              }
            }

            state.clearDragState();

            if (!targetDir) return;
            if (isZipVirtualPath(targetDir)) {
              state.showToast(
                "Cannot drop items into a read-only ZIP archive.",
                "error"
              );
              return;
            }

            const normTarget = normalizePath(
              targetDir,
              state.specialPaths?.home
            );

            // Prevent dropping a folder into itself or one of its descendants
            const validPaths = droppedPaths.filter((src) => {
              const normSrc = normalizePath(src, state.specialPaths?.home);
              return (
                normTarget !== normSrc && !normTarget.startsWith(`${normSrc}/`)
              );
            });
            if (validPaths.length === 0) return;

            // Skip silent no-op when moving items onto the exact folder they already live in
            if (
              mode === "move" &&
              validPaths.every(
                (src) =>
                  getParentPath(
                    normalizePath(src, state.specialPaths?.home)
                  ) === normTarget
              )
            ) {
              return;
            }

            await state.copyOrMoveToDestination(mode, validPaths, normTarget);
          })();
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      cancelSpringLoad();
      unlisten?.();
    };
  }, []);

  const handleSplitterMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;

    setIsDraggingSplitter(true);
    const rect = container.getBoundingClientRect();

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (rect.width <= 0) return;
      const ratio = (moveEvent.clientX - rect.left) / rect.width;
      setDualPaneSplitRatio(ratio);
    };

    const handleMouseUp = () => {
      setIsDraggingSplitter(false);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleRootContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement | null;
    // Allow native paste/copy menu inside editable text inputs
    if (
      target &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
    ) {
      return;
    }
    e.preventDefault();
  };

  return (
    <div
      onContextMenu={handleRootContextMenu}
      className={`relative flex h-full w-full flex-col overflow-hidden bg-[#f3f5f8] text-[#1a1a1a] dark:bg-[#202020] dark:text-[#f3f3f3] ${
        isDraggingSplitter ? "cursor-col-resize" : ""
      }`}
    >
      <TabBar />
      {!dualPane && <NavigationBar />}
      <CommandBar />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />

        {dualPane ? (
          <div
            ref={splitContainerRef}
            className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
          >
            {/* Left Pane */}
            <div
              ref={leftPaneRef}
              style={{ width: `${dualPaneSplitRatio * 100}%` }}
              className="flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden"
            >
              <FilePane
                paneId="left"
                showPaneHeader
                isActivePane={activePane === "left"}
                isExternalDragOver={dragOverPane === "left"}
              />
            </div>

            {/* Resizable Center Divider */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize split panes"
              title="Drag to resize panes (double-click to reset 50/50)"
              onMouseDown={handleSplitterMouseDown}
              onDoubleClick={() => setDualPaneSplitRatio(0.5)}
              className={`group relative flex w-[5px] shrink-0 cursor-col-resize items-center justify-center bg-[#e8edf5] transition-colors select-none dark:bg-[#242424] ${
                isDraggingSplitter
                  ? "bg-[#0067c0]/25 dark:bg-[#60cdff]/25"
                  : "hover:bg-[#0067c0]/18 dark:hover:bg-[#60cdff]/18"
              }`}
            >
              <div
                className={`h-full w-[1px] transition-colors ${
                  isDraggingSplitter
                    ? "bg-[#0067c0] dark:bg-[#60cdff]"
                    : "bg-black/[0.1] group-hover:bg-[#0067c0] dark:bg-white/[0.1] dark:group-hover:bg-[#60cdff]"
                }`}
              />
            </div>

            {/* Right Pane */}
            <div
              ref={rightPaneRef}
              className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            >
              <FilePane
                paneId="right"
                showPaneHeader
                isActivePane={activePane === "right"}
                isExternalDragOver={dragOverPane === "right"}
                onCloseSplit={toggleDualPane}
              />
            </div>
          </div>
        ) : (
          <div
            ref={leftPaneRef}
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          >
            <FilePane
              paneId="left"
              isActivePane
              isExternalDragOver={dragOverPane === "left"}
            />
          </div>
        )}
      </div>

      <StatusBar />

      <ContextMenu />
      <DestinationModal />
      <NetworkDriveModal />
      <SystemIntegrationModal />

      {recentDownloadNotice && (
        <div
          role="status"
          className={`fixed right-3 z-50 flex w-[340px] max-w-[calc(100vw-24px)] flex-col gap-2 rounded-[10px] border border-black/[0.12] bg-white/95 p-3 text-[12px] shadow-[0_14px_40px_rgba(0,0,0,0.18)] backdrop-blur-xl dark:border-white/[0.14] dark:bg-[#2a2a2a]/95 dark:shadow-[0_16px_44px_rgba(0,0,0,0.48)] ${
            toast ? "bottom-[82px]" : "bottom-9"
          }`}
        >
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-emerald-500/14 text-emerald-600 dark:bg-emerald-400/16 dark:text-emerald-400">
              <Download size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-400">
                Download complete
              </div>
              <div
                className="truncate text-[12.5px] font-medium text-[#1a1a1a] dark:text-[#f3f3f3]"
                title={recentDownloadNotice.name}
              >
                {recentDownloadNotice.name}
              </div>
              {!recentDownloadNotice.is_dir && (
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  {formatFileSize(recentDownloadNotice.size)} • Downloads
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setRecentDownloadNotice(null)}
              aria-label="Dismiss download notification"
              className="rounded p-0.5 text-neutral-400 hover:bg-black/[0.06] hover:text-neutral-700 dark:hover:bg-white/[0.08] dark:hover:text-neutral-200"
            >
              <X size={13} />
            </button>
          </div>

          <div className="flex items-center gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={() => {
                const targetPath = recentDownloadNotice.path;
                setRecentDownloadNotice(null);
                void revealPath(targetPath, true);
              }}
              className="flex h-[28px] flex-1 items-center justify-center gap-1.5 rounded-[6px] bg-[#0067c0] px-2.5 text-[11.5px] font-medium text-white transition-colors hover:bg-[#005aa8] dark:bg-[#60cdff] dark:text-[#121212] dark:hover:bg-[#7ad5ff]"
            >
              <FolderOpen size={13} />
              <span>Show in MXplore</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const targetPath = recentDownloadNotice.path;
                setRecentDownloadNotice(null);
                void revealInFinder(targetPath);
              }}
              className="flex h-[28px] items-center justify-center gap-1.5 rounded-[6px] border border-black/[0.12] bg-white px-2.5 text-[11.5px] font-medium text-[#1f1f1f] transition-colors hover:bg-black/[0.05] dark:border-white/[0.14] dark:bg-[#353535] dark:text-[#ececec] dark:hover:bg-white/[0.1]"
            >
              <Search size={12} />
              <span>Show in Finder</span>
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className={`fixed right-3 bottom-9 z-50 flex max-w-sm items-center gap-2 rounded-[8px] border px-3 py-2 text-[12px] shadow-lg backdrop-blur-xl ${
            toast.type === "error"
              ? "border-red-500/30 bg-red-50/95 text-red-700 dark:bg-red-950/90 dark:text-red-200"
              : "border-black/[0.1] bg-white/95 text-[#1f1f1f] dark:border-white/[0.12] dark:bg-[#2b2b2b]/95 dark:text-[#f3f3f3]"
          }`}
        >
          {toast.type === "error" ? (
            <AlertCircle size={14} className="shrink-0 text-red-500" />
          ) : (
            <CheckCircle2
              size={14}
              className="shrink-0 text-[#0067c0] dark:text-[#60cdff]"
            />
          )}
          <span className="min-w-0 flex-1 break-words">{toast.text}</span>
          {toast.canUndo && undoCount > 0 && (
            <button
              type="button"
              disabled={isUndoing}
              onClick={() => void undoLastAction()}
              className="flex shrink-0 items-center gap-1 rounded-[4px] bg-[#0067c0]/12 px-2 py-0.5 text-[11.5px] font-medium text-[#0067c0] transition-colors hover:bg-[#0067c0]/20 disabled:opacity-50 dark:bg-[#60cdff]/16 dark:text-[#60cdff] dark:hover:bg-[#60cdff]/25"
            >
              <Undo2 size={12} />
              <span>Undo</span>
            </button>
          )}
          <button
            type="button"
            onClick={clearToast}
            aria-label="Dismiss notification"
            className="rounded p-0.5 opacity-60 hover:opacity-100"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
