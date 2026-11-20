import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Folder, HardDrive, Loader2 } from "lucide-react";
import {
  tauriApi,
  type FileEntry,
  type FolderStats,
} from "../lib/tauriApi";
import { formatFileSize, formatModifiedDate } from "../lib/format";

interface CachedStats {
  stats: FolderStats;
  cachedAt: number;
  mtime: number;
}

const CACHE_TTL_MS = 60_000;
const statsCache = new Map<string, CachedStats>();

export interface FolderHoverTarget {
  entry: FileEntry;
  x: number;
  y: number;
}

interface FolderHoverPopupProps {
  target: FolderHoverTarget | null;
}

export function FolderHoverPopup({ target }: FolderHoverPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [stats, setStats] = useState<FolderStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) {
      setStats(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const { path, modified_timestamp } = target.entry;
    const cached = statsCache.get(path);
    const now = Date.now();

    if (
      cached &&
      cached.mtime === modified_timestamp &&
      now - cached.cachedAt < CACHE_TTL_MS
    ) {
      setStats(cached.stats);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setStats(null);
    setError(null);
    setIsLoading(true);

    tauriApi
      .getFolderStats(path)
      .then((result) => {
        if (cancelled) return;
        statsCache.set(path, {
          stats: result,
          cachedAt: Date.now(),
          mtime: modified_timestamp,
        });
        setStats(result);
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [target?.entry.path, target?.entry.modified_timestamp]);

  useLayoutEffect(() => {
    if (!target) return;
    const el = popupRef.current;
    const width = el?.offsetWidth ?? 250;
    const height = el?.offsetHeight ?? 116;
    const padding = 10;
    const offsetX = 14;
    const offsetY = 18;

    let left = target.x + offsetX;
    if (left + width > window.innerWidth - padding) {
      left = Math.max(padding, target.x - width - 10);
    }

    let top = target.y + offsetY;
    if (top + height > window.innerHeight - padding) {
      top = Math.max(padding, target.y - height - 10);
    }

    setPosition({ left, top });
  }, [target, stats, isLoading]);

  if (!target) return null;

  const { entry } = target;

  const formatContents = (s: FolderStats) => {
    if (s.file_count === 0 && s.folder_count === 0) {
      return "Empty folder";
    }
    const parts: string[] = [];
    if (s.file_count > 0) {
      parts.push(
        `${s.file_count.toLocaleString()}${s.truncated ? "+" : ""} ${
          s.file_count === 1 ? "file" : "files"
        }`
      );
    }
    if (s.folder_count > 0) {
      parts.push(
        `${s.folder_count.toLocaleString()}${s.truncated ? "+" : ""} ${
          s.folder_count === 1 ? "folder" : "folders"
        }`
      );
    }
    return parts.join(", ");
  };

  return (
    <div
      ref={popupRef}
      role="tooltip"
      style={{ left: position.left, top: position.top }}
      className="pointer-events-none fixed z-40 w-[256px] rounded-[8px] border border-black/[0.1] bg-white/95 px-3 py-2.5 text-[12px] text-[#1f1f1f] shadow-[0_8px_28px_rgba(0,0,0,0.16)] backdrop-blur-xl select-none dark:border-white/[0.12] dark:bg-[#2b2b2b]/95 dark:text-[#f0f0f0] dark:shadow-[0_10px_32px_rgba(0,0,0,0.5)]"
    >
      {/* Folder Header */}
      <div className="flex items-center gap-2 border-b border-black/[0.07] pb-1.5 dark:border-white/[0.08]">
        <Folder
          size={15}
          className="shrink-0 fill-amber-400/90 text-amber-500 dark:fill-amber-400/85 dark:text-amber-300"
        />
        <span className="min-w-0 flex-1 truncate font-semibold">
          {entry.name}
        </span>
      </div>

      {/* Stats Body */}
      <div className="mt-1.5 space-y-1 text-[11.5px]">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
            <HardDrive size={11} className="shrink-0" />
            <span>Size</span>
          </span>
          {isLoading ? (
            <span className="flex items-center gap-1.5 text-neutral-400 dark:text-neutral-500">
              <Loader2 size={11} className="animate-spin" />
              <span>Calculating...</span>
            </span>
          ) : error ? (
            <span className="text-amber-600 dark:text-amber-400">
              Unavailable
            </span>
          ) : stats ? (
            <span className="font-semibold tabular-nums text-[#0067c0] dark:text-[#60cdff]">
              {stats.truncated ? "> " : ""}
              {formatFileSize(stats.total_size)}
            </span>
          ) : null}
        </div>

        {!isLoading && stats && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-neutral-500 dark:text-neutral-400">
              Contains
            </span>
            <span className="truncate text-right text-[#2c2c2c] dark:text-[#dcdcdc]">
              {formatContents(stats)}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="text-neutral-500 dark:text-neutral-400">
            Modified
          </span>
          <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
            {formatModifiedDate(entry.modified_timestamp)}
          </span>
        </div>
      </div>
    </div>
  );
}
