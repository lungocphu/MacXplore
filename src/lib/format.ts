import type { FileEntry } from "./tauriApi";
import type { SortDirection, SortField } from "../store/useExplorerStore";

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, exponent);
  if (exponent === 0) {
    return `${bytes} B`;
  }
  return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[exponent]}`;
}

export function formatModifiedDate(timestampMs: number): string {
  if (!timestampMs) return "—";
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

const EXTENSION_LABELS: Record<string, string> = {
  // Documents
  pdf: "PDF Document",
  doc: "Word Document",
  docx: "Word Document",
  xls: "Excel Spreadsheet",
  xlsx: "Excel Spreadsheet",
  ppt: "PowerPoint Presentation",
  pptx: "PowerPoint Presentation",
  txt: "Text Document",
  md: "Markdown File",
  rtf: "Rich Text Document",
  csv: "CSV File",
  // Images
  png: "PNG Image",
  jpg: "JPEG Image",
  jpeg: "JPEG Image",
  gif: "GIF Image",
  webp: "WebP Image",
  svg: "SVG Vector",
  heic: "HEIC Image",
  ico: "Icon File",
  bmp: "Bitmap Image",
  // Audio & Video
  mp3: "MP3 Audio",
  wav: "WAV Audio",
  flac: "FLAC Audio",
  m4a: "M4A Audio",
  mp4: "MP4 Video",
  mov: "QuickTime Video",
  mkv: "MKV Video",
  webm: "WebM Video",
  avi: "AVI Video",
  // Archives
  zip: "ZIP Archive",
  tar: "TAR Archive",
  gz: "GZIP Archive",
  rar: "RAR Archive",
  "7z": "7-Zip Archive",
  dmg: "macOS Disk Image",
  pkg: "Installer Package",
  // Code
  ts: "TypeScript File",
  tsx: "TypeScript JSX",
  js: "JavaScript File",
  jsx: "JavaScript JSX",
  rs: "Rust Source",
  py: "Python Script",
  go: "Go Source",
  java: "Java Source",
  c: "C Source",
  cpp: "C++ Source",
  h: "Header File",
  swift: "Swift Source",
  html: "HTML Document",
  css: "CSS Stylesheet",
  json: "JSON File",
  toml: "TOML Config",
  yaml: "YAML Config",
  yml: "YAML Config",
  xml: "XML Document",
  sh: "Shell Script",
  zsh: "Zsh Script",
  sql: "SQL Script",
  // Apps
  app: "Application",
};

export function getFileTypeLabel(entry: FileEntry): string {
  if (entry.is_dir) {
    if (entry.name.toLowerCase().endsWith(".app")) {
      return "Application";
    }
    return "File folder";
  }
  if (!entry.extension) {
    return "File";
  }
  return (
    EXTENSION_LABELS[entry.extension] ?? `${entry.extension.toUpperCase()} File`
  );
}

export function isZipVirtualPath(path: string): boolean {
  return path.includes("::");
}

export function splitZipVirtualPath(
  path: string
): { zipPath: string; innerPath: string } | null {
  const sepIdx = path.indexOf("::");
  if (sepIdx === -1) return null;
  const zipPath = path.slice(0, sepIdx);
  const rawInner = path.slice(sepIdx + 2);
  const innerPath = rawInner
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
  return { zipPath, innerPath };
}

export function isZipFileEntry(entry: FileEntry): boolean {
  return !entry.is_dir && entry.extension.toLowerCase() === "zip";
}

function normalizeRealPath(rawPath: string, homePath?: string | null): string {
  let cleaned = rawPath.trim();
  if (!cleaned) return "/";

  if (homePath) {
    if (cleaned === "~") {
      cleaned = homePath;
    } else if (cleaned.startsWith("~/")) {
      cleaned = `${homePath.replace(/\/+$/, "")}/${cleaned.slice(2)}`;
    }
  }

  cleaned = cleaned.replace(/\/+/g, "/");

  if (cleaned.length > 1 && cleaned.endsWith("/")) {
    cleaned = cleaned.slice(0, -1);
  }

  return cleaned;
}

export function normalizePath(rawPath: string, homePath?: string | null): string {
  const trimmed = rawPath.trim();
  const sepIdx = trimmed.indexOf("::");
  if (sepIdx !== -1) {
    const zipPart = normalizeRealPath(trimmed.slice(0, sepIdx), homePath);
    const innerPart = trimmed
      .slice(sepIdx + 2)
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .replace(/^\/+|\/+$/g, "");
    return `${zipPart}::${innerPart}`;
  }
  return normalizeRealPath(trimmed, homePath);
}

export function joinPath(dirPath: string, childName: string): string {
  const zipParts = splitZipVirtualPath(dirPath);
  if (zipParts) {
    const nextInner = zipParts.innerPath
      ? `${zipParts.innerPath}/${childName}`
      : childName;
    return `${zipParts.zipPath}::${nextInner}`;
  }
  const cleanDir = dirPath === "/" ? "" : dirPath.replace(/\/+$/, "");
  return `${cleanDir}/${childName}`;
}

export function getParentPath(path: string): string | null {
  const normalized = normalizePath(path);
  const zipParts = splitZipVirtualPath(normalized);
  if (zipParts) {
    if (!zipParts.innerPath) {
      // At root of archive -> go up to the folder containing the .zip file
      return getParentPath(zipParts.zipPath);
    }
    const lastSlash = zipParts.innerPath.lastIndexOf("/");
    if (lastSlash === -1) {
      return `${zipParts.zipPath}::`;
    }
    return `${zipParts.zipPath}::${zipParts.innerPath.slice(0, lastSlash)}`;
  }

  if (normalized === "/") return null;
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  return normalized.slice(0, lastSlash);
}

export function getPathTitle(path: string, homePath?: string | null): string {
  const normalized = normalizePath(path, homePath);
  const zipParts = splitZipVirtualPath(normalized);
  if (zipParts) {
    if (!zipParts.innerPath) {
      return getPathTitle(zipParts.zipPath, homePath);
    }
    const innerSegs = zipParts.innerPath.split("/").filter(Boolean);
    return (
      innerSegs[innerSegs.length - 1] ??
      getPathTitle(zipParts.zipPath, homePath)
    );
  }

  if (normalized === "/") return "Macintosh HD";
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "Macintosh HD";
}

export interface BreadcrumbSegment {
  label: string;
  path: string;
  isZipRoot?: boolean;
  isInsideZip?: boolean;
}

export function getBreadcrumbSegments(path: string): BreadcrumbSegment[] {
  const normalized = normalizePath(path);
  const zipParts = splitZipVirtualPath(normalized);

  if (zipParts) {
    const segments: BreadcrumbSegment[] = [{ label: "Macintosh HD", path: "/" }];
    const realParts = zipParts.zipPath.split("/").filter(Boolean);
    let acc = "";
    for (let i = 0; i < realParts.length; i++) {
      const part = realParts[i];
      acc += `/${part}`;
      const isZipFile = i === realParts.length - 1;
      segments.push({
        label: part,
        path: isZipFile ? `${acc}::` : acc,
        isZipRoot: isZipFile,
      });
    }

    if (zipParts.innerPath) {
      const innerParts = zipParts.innerPath.split("/").filter(Boolean);
      let innerAcc = "";
      for (const part of innerParts) {
        innerAcc = innerAcc ? `${innerAcc}/${part}` : part;
        segments.push({
          label: part,
          path: `${zipParts.zipPath}::${innerAcc}`,
          isInsideZip: true,
        });
      }
    }

    return segments;
  }

  const segments: BreadcrumbSegment[] = [{ label: "Macintosh HD", path: "/" }];

  if (normalized === "/") {
    return segments;
  }

  const parts = normalized.split("/").filter(Boolean);
  let acc = "";
  for (const part of parts) {
    acc += `/${part}`;
    segments.push({ label: part, path: acc });
  }

  return segments;
}

/**
 * Returns filtered and sorted entries, ALWAYS keeping folders before files.
 */
export function getVisibleEntries(
  entries: FileEntry[],
  searchQuery: string,
  sortField: SortField,
  sortDirection: SortDirection
): FileEntry[] {
  const query = searchQuery.trim().toLowerCase();
  const filtered = query
    ? entries.filter((entry) => entry.name.toLowerCase().includes(query))
    : entries;

  const dirMultiplier = sortDirection === "asc" ? 1 : -1;

  return [...filtered].sort((a, b) => {
    // Always keep folders at the top regardless of sort column or direction
    if (a.is_dir !== b.is_dir) {
      return a.is_dir ? -1 : 1;
    }

    let cmp = 0;
    switch (sortField) {
      case "name":
        cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        break;
      case "modified":
        cmp = a.modified_timestamp - b.modified_timestamp;
        break;
      case "type":
        cmp = getFileTypeLabel(a).localeCompare(getFileTypeLabel(b));
        break;
      case "size":
        cmp = a.size - b.size;
        break;
    }

    if (cmp === 0) {
      cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    }
    return cmp * dirMultiplier;
  });
}

/**
 * Generates a unique name inside a directory given existing entries (case-insensitive for macOS APFS).
 */
export function generateUniqueName(
  existingNames: Iterable<string>,
  baseName: string,
  extension?: string
): string {
  const taken = new Set<string>();
  for (const name of existingNames) {
    taken.add(name.toLowerCase());
  }

  const extSuffix = extension ? `.${extension.replace(/^\./, "")}` : "";
  const firstCandidate = `${baseName}${extSuffix}`;
  if (!taken.has(firstCandidate.toLowerCase())) {
    return firstCandidate;
  }

  let index = 2;
  while (true) {
    const candidate = `${baseName} (${index})${extSuffix}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
    index += 1;
  }
}

/**
 * Returns the selection end offset when starting inline rename (selects stem before extension for files).
 */
export function getRenameSelectionEnd(name: string, isDir: boolean): number {
  if (isDir) return name.length;
  const dotIdx = name.lastIndexOf(".");
  if (dotIdx > 0) {
    return dotIdx;
  }
  return name.length;
}
