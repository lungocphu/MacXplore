import { useEffect, useState } from "react";
import {
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  AppWindow,
} from "lucide-react";
import { tauriApi, type FileEntry } from "../lib/tauriApi";

const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "heic",
  "heif",
  "bmp",
  "ico",
  "tiff",
  "tif",
  "avif",
]);
const VIDEO_EXTS = new Set(["mp4", "mov", "mkv", "webm", "avi", "m4v"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "flac", "m4a", "ogg", "aac"]);
const ARCHIVE_EXTS = new Set([
  "zip",
  "tar",
  "gz",
  "bz2",
  "xz",
  "rar",
  "7z",
  "dmg",
  "pkg",
]);
const CODE_EXTS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "rs",
  "py",
  "go",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "swift",
  "kt",
  "rb",
  "php",
  "html",
  "css",
  "scss",
  "json",
  "toml",
  "yaml",
  "yml",
  "xml",
  "sh",
  "zsh",
  "sql",
]);
const SHEET_EXTS = new Set(["xls", "xlsx", "xlsm", "csv", "numbers"]);
const PRESENTATION_EXTS = new Set([
  "ppt",
  "pptx",
  "pptm",
  "pps",
  "ppsx",
  "pot",
  "potx",
  "odp",
  "key",
]);
const DOC_EXTS = new Set(["pdf", "doc", "docx", "txt", "md", "rtf", "pages"]);

/**
 * Microsoft 365 PowerPoint-inspired document icon with crisp orange border and "P" badge.
 */
function PowerPointFileIcon({
  size,
  className = "",
}: {
  size: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={`shrink-0 text-[#D83B01] dark:text-[#FF7A45] ${className}`}
    >
      {/* Document body with orange MS 365 border */}
      <path
        d="M6.5 2.5H15L20 7.5V20C20 20.8284 19.3284 21.5 18.5 21.5H6.5C5.67157 21.5 5 20.8284 5 20V4C5 3.17157 5.67157 2.5 6.5 2.5Z"
        fill="currentColor"
        fillOpacity="0.1"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      {/* Folded corner */}
      <path
        d="M14.75 2.5V7.75H20"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Subtle slide lines on right side */}
      <path
        d="M13.5 12.25H17.25M13.5 15.25H17.25M13.5 18.25H16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeOpacity="0.7"
      />
      {/* MS 365 signature floating orange "P" tile */}
      <rect
        x="1.5"
        y="9.25"
        width="10.25"
        height="10.25"
        rx="2.2"
        fill="currentColor"
      />
      <path
        d="M4.85 17.2V11.6H7.15C8.35 11.6 9.1 12.28 9.1 13.38C9.1 14.48 8.35 15.16 7.15 15.16H6.1V17.2H4.85ZM6.1 14.12H6.98C7.55 14.12 7.86 13.84 7.86 13.38C7.86 12.92 7.55 12.64 6.98 12.64H6.1V14.12Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

export function isImageEntry(entry: FileEntry): boolean {
  if (entry.is_dir) return false;
  return IMAGE_EXTS.has(entry.extension.toLowerCase());
}

// Bounded in-memory thumbnail cache with concurrency throttling for smooth virtual scrolling
const MAX_THUMBNAIL_CACHE = 240;
const MAX_CONCURRENT_THUMBNAILS = 6;
const thumbnailCache = new Map<string, string | null>();
const inFlightThumbnails = new Map<string, Promise<string | null>>();

let activeThumbnailJobs = 0;
const thumbnailQueue: Array<() => void> = [];

function runWithThumbnailSlot<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = () => {
      activeThumbnailJobs += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeThumbnailJobs -= 1;
          const next = thumbnailQueue.shift();
          if (next) next();
        });
    };

    if (activeThumbnailJobs < MAX_CONCURRENT_THUMBNAILS) {
      start();
    } else {
      thumbnailQueue.push(start);
    }
  });
}

function setThumbnailCache(key: string, value: string | null) {
  if (thumbnailCache.has(key)) {
    thumbnailCache.delete(key);
  } else if (thumbnailCache.size >= MAX_THUMBNAIL_CACHE) {
    const oldestKey = thumbnailCache.keys().next().value;
    if (oldestKey !== undefined) {
      thumbnailCache.delete(oldestKey);
    }
  }
  thumbnailCache.set(key, value);
}

function loadThumbnail(entry: FileEntry, maxSize: number): Promise<string | null> {
  const key = `${entry.path}:${entry.modified_timestamp}:${maxSize}`;
  if (thumbnailCache.has(key)) {
    return Promise.resolve(thumbnailCache.get(key) ?? null);
  }
  const existing = inFlightThumbnails.get(key);
  if (existing) {
    return existing;
  }

  const promise = runWithThumbnailSlot(async () => {
    try {
      const dataUrl = await tauriApi.getImageThumbnail(entry.path, maxSize);
      setThumbnailCache(key, dataUrl);
      return dataUrl;
    } catch {
      setThumbnailCache(key, null);
      return null;
    } finally {
      inFlightThumbnails.delete(key);
    }
  });

  inFlightThumbnails.set(key, promise);
  return promise;
}

interface FileIconProps {
  entry: FileEntry;
  size?: number;
  className?: string;
}

export function FileIcon({ entry, size = 18, className = "" }: FileIconProps) {
  if (entry.is_dir) {
    if (entry.name.toLowerCase().endsWith(".app")) {
      return (
        <AppWindow
          size={size}
          className={`shrink-0 text-sky-500 dark:text-sky-400 ${className}`}
        />
      );
    }
    return (
      <Folder
        size={size}
        className={`shrink-0 fill-amber-400/90 text-amber-500 dark:fill-amber-400/85 dark:text-amber-300 ${className}`}
      />
    );
  }

  const ext = entry.extension.toLowerCase();

  if (IMAGE_EXTS.has(ext)) {
    return (
      <FileImage
        size={size}
        className={`shrink-0 text-emerald-600 dark:text-emerald-400 ${className}`}
      />
    );
  }
  if (VIDEO_EXTS.has(ext)) {
    return (
      <FileVideo
        size={size}
        className={`shrink-0 text-purple-600 dark:text-purple-400 ${className}`}
      />
    );
  }
  if (AUDIO_EXTS.has(ext)) {
    return (
      <FileAudio
        size={size}
        className={`shrink-0 text-pink-600 dark:text-pink-400 ${className}`}
      />
    );
  }
  if (ARCHIVE_EXTS.has(ext)) {
    return (
      <FileArchive
        size={size}
        className={`shrink-0 text-amber-600 dark:text-amber-400 ${className}`}
      />
    );
  }
  if (CODE_EXTS.has(ext)) {
    return (
      <FileCode2
        size={size}
        className={`shrink-0 text-sky-600 dark:text-sky-400 ${className}`}
      />
    );
  }
  if (SHEET_EXTS.has(ext)) {
    return (
      <FileSpreadsheet
        size={size}
        className={`shrink-0 text-green-600 dark:text-green-400 ${className}`}
      />
    );
  }
  if (PRESENTATION_EXTS.has(ext)) {
    return <PowerPointFileIcon size={size} className={className} />;
  }
  if (DOC_EXTS.has(ext)) {
    const color =
      ext === "pdf"
        ? "text-rose-600 dark:text-rose-400"
        : "text-blue-600 dark:text-blue-400";
    return <FileText size={size} className={`shrink-0 ${color} ${className}`} />;
  }

  return (
    <File
      size={size}
      className={`shrink-0 text-neutral-500 dark:text-neutral-400 ${className}`}
    />
  );
}

interface FileThumbnailProps {
  entry: FileEntry;
  iconSize?: number;
  maxThumbSize?: number;
  className?: string;
}

export function FileThumbnail({
  entry,
  iconSize = 60,
  maxThumbSize = 240,
  className = "h-[88px] w-[112px]",
}: FileThumbnailProps) {
  const isImage = isImageEntry(entry);
  const cacheKey = `${entry.path}:${entry.modified_timestamp}:${maxThumbSize}`;

  const [src, setSrc] = useState<string | null>(() =>
    isImage && thumbnailCache.has(cacheKey)
      ? (thumbnailCache.get(cacheKey) ?? null)
      : null
  );
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
    if (!isImage) {
      setSrc(null);
      return;
    }

    if (thumbnailCache.has(cacheKey)) {
      setSrc(thumbnailCache.get(cacheKey) ?? null);
      return;
    }

    let cancelled = false;
    setSrc(null);
    void loadThumbnail(entry, maxThumbSize).then((dataUrl) => {
      if (!cancelled) {
        setSrc(dataUrl);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isImage, cacheKey, entry, maxThumbSize]);

  if (isImage && src && !imgError) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-black/[0.03] p-1 dark:bg-white/[0.04] ${className}`}
      >
        <img
          src={src}
          alt={entry.name}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setImgError(true)}
          className="max-h-full max-w-full rounded-[4px] object-contain shadow-[0_1px_4px_rgba(0,0,0,0.12)]"
        />
      </div>
    );
  }

  return (
    <div
      className={`flex shrink-0 items-center justify-center ${className}`}
    >
      <FileIcon entry={entry} size={iconSize} />
    </div>
  );
}
