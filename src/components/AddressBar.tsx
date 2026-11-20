import { useEffect, useRef, useState } from "react";
import { ChevronRight, FileArchive, Folder, HardDrive, Network } from "lucide-react";
import {
  findNetworkDriveForPath,
  useExplorerStore,
  usePane,
  type PaneId,
} from "../store/useExplorerStore";
import { getBreadcrumbSegments, isZipVirtualPath } from "../lib/format";

interface AddressBarProps {
  paneId?: PaneId;
  compact?: boolean;
}

export function AddressBar({
  paneId = "left",
  compact = false,
}: AddressBarProps) {
  const pane = usePane(paneId);
  const networkDrives = useExplorerStore((s) => s.networkDrives);
  const dropTargetFolder = useExplorerStore((s) => s.dropTargetFolder);
  const dropCopyMode = useExplorerStore((s) => s.dropCopyMode);
  const navigateTo = useExplorerStore((s) => s.navigateTo);
  const addTab = useExplorerStore((s) => s.addTab);
  const activeNetworkDrive = findNetworkDriveForPath(
    pane.currentPath,
    networkDrives
  );
  const isInZip = isZipVirtualPath(pane.currentPath);

  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(pane.currentPath);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputValue(pane.currentPath);
    setIsEditing(false);
  }, [pane.currentPath, pane.tabId, paneId]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Keep the rightmost breadcrumb segment visible when path is deep
  useEffect(() => {
    if (!isEditing && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [pane.currentPath, isEditing]);

  const segments = getBreadcrumbSegments(pane.currentPath || "/");

  const enterEditMode = () => {
    setInputValue(pane.currentPath);
    setIsEditing(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = inputValue.trim();
      setIsEditing(false);
      if (trimmed) {
        navigateTo(trimmed, paneId);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setInputValue(pane.currentPath);
      setIsEditing(false);
    }
  };

  const handleBlur = () => {
    setInputValue(pane.currentPath);
    setIsEditing(false);
  };

  const heightClass = compact ? "h-[28px]" : "h-[32px]";

  if (isEditing) {
    return (
      <div
        className={`flex ${heightClass} min-w-0 flex-1 items-center gap-2 rounded-[6px] border border-[#0067c0] bg-white px-2.5 ring-1 ring-[#0067c0]/30 dark:border-[#60cdff] dark:bg-[#1f1f1f] dark:ring-[#60cdff]/25`}
      >
        {isInZip ? (
          <FileArchive
            size={compact ? 13 : 14}
            className="shrink-0 text-amber-600 dark:text-amber-400"
          />
        ) : activeNetworkDrive ? (
          <Network
            size={compact ? 13 : 14}
            className="shrink-0 text-teal-600 dark:text-teal-400"
          />
        ) : (
          <Folder
            size={compact ? 13 : 14}
            className="shrink-0 fill-amber-400/90 text-amber-500 dark:fill-amber-400/85 dark:text-amber-300"
          />
        )}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder="/path  or  \\192.168.1.x\Share  or  smb://..."
          spellCheck={false}
          aria-label="Address bar path"
          className={`h-full w-full bg-transparent ${
            compact ? "text-[12px]" : "text-[13px]"
          } text-[#1a1a1a] outline-none selection:bg-[#0067c0]/25 dark:text-[#f3f3f3] dark:selection:bg-[#60cdff]/30`}
        />
      </div>
    );
  }

  return (
    <div
      onClick={enterEditMode}
      title="Click empty area to edit path"
      className={`flex ${heightClass} min-w-0 flex-1 cursor-text items-center rounded-[6px] border border-black/[0.08] bg-[#f3f4f6] px-2 transition-colors hover:border-black/[0.15] hover:bg-white dark:border-white/[0.08] dark:bg-[#232323] dark:hover:border-white/[0.14] dark:hover:bg-[#262626]`}
    >
      <div
        ref={scrollRef}
        className="flex min-w-0 flex-1 items-center overflow-x-auto no-scrollbar"
      >
        <div className="mr-1.5 flex shrink-0 items-center text-neutral-500 dark:text-neutral-400">
          {isInZip ? (
            <FileArchive
              size={compact ? 13 : 14}
              className="text-amber-600 dark:text-amber-400"
            />
          ) : activeNetworkDrive ? (
            <Network
              size={compact ? 13 : 14}
              className="text-teal-600 dark:text-teal-400"
            />
          ) : pane.currentPath === "/" ? (
            <HardDrive
              size={compact ? 13 : 14}
              className="text-sky-600 dark:text-sky-400"
            />
          ) : (
            <Folder
              size={compact ? 13 : 14}
              className="fill-amber-400/90 text-amber-500 dark:fill-amber-400/85 dark:text-amber-300"
            />
          )}
        </div>

        <nav
          aria-label="Breadcrumb"
          className={`flex shrink-0 items-center ${
            compact ? "text-[12px]" : "text-[12.5px]"
          }`}
        >
          {segments.map((segment, idx) => {
            const isLast = idx === segments.length - 1;
            const canDrop = !isZipVirtualPath(segment.path);
            const isDropTarget = canDrop && dropTargetFolder === segment.path;
            return (
              <div key={segment.path} className="flex items-center">
                {idx > 0 && (
                  <ChevronRight
                    size={12}
                    className="mx-0.5 shrink-0 text-neutral-400 dark:text-neutral-500"
                  />
                )}
                <button
                  type="button"
                  data-drop-folder={canDrop ? segment.path : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    navigateTo(segment.path, paneId);
                  }}
                  onMouseDown={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      e.stopPropagation();
                      addTab(segment.path);
                    }
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      e.stopPropagation();
                    }
                  }}
                  title={`${segment.path} (Middle-click to open in new tab)`}
                  className={`flex max-w-[180px] items-center gap-1 truncate rounded-[4px] px-1.5 py-0.5 transition-colors hover:bg-black/[0.06] active:bg-black/[0.1] dark:hover:bg-white/[0.08] dark:active:bg-white/[0.12] ${
                    isDropTarget
                      ? dropCopyMode
                        ? "bg-emerald-500/20 font-medium text-emerald-800 ring-2 ring-inset ring-emerald-500 dark:bg-emerald-400/20 dark:text-emerald-200 dark:ring-emerald-400"
                        : "bg-[#0067c0]/20 font-medium text-[#0067c0] ring-2 ring-inset ring-[#0067c0] dark:bg-[#60cdff]/20 dark:text-[#60cdff] dark:ring-[#60cdff]"
                      : segment.isZipRoot
                        ? "bg-amber-500/12 font-medium text-amber-800 dark:bg-amber-400/15 dark:text-amber-300"
                        : isLast
                          ? "font-medium text-[#1a1a1a] dark:text-[#f3f3f3]"
                          : "text-[#4a4a4a] dark:text-[#cfcfcf]"
                  }`}
                >
                  {segment.isZipRoot && (
                    <FileArchive size={12} className="shrink-0" />
                  )}
                  <span className="truncate">{segment.label}</span>
                </button>
              </div>
            );
          })}
        </nav>

        {/* Clickable spacer area to switch to editable text input */}
        <div className="h-full min-w-[24px] flex-1" />
      </div>
    </div>
  );
}
