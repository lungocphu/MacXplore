import { getPathTitle, normalizePath } from "./format";

export interface PinnedCabinetFolder {
  path: string;
  label: string;
}

const PINNED_FOLDERS_KEY = "macxplore.cabinetPinnedFolders";
const CUSTOM_INBOX_PATH_KEY = "macxplore.customInboxPath";

export function loadPinnedFolders(): PinnedCabinetFolder[] {
  try {
    const raw = window.localStorage.getItem(PINNED_FOLDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is PinnedCabinetFolder =>
          typeof item?.path === "string" &&
          item.path.trim().length > 0 &&
          typeof item?.label === "string"
      );
    }
  } catch {
    // Ignore read errors
  }
  return [];
}

export function savePinnedFolders(folders: PinnedCabinetFolder[]): void {
  try {
    window.localStorage.setItem(PINNED_FOLDERS_KEY, JSON.stringify(folders));
  } catch {
    // Ignore write errors
  }
}

export function togglePinnedFolderInStorage(
  rawPath: string,
  homePath?: string | null
): { folders: PinnedCabinetFolder[]; pinned: boolean } {
  const normalized = normalizePath(rawPath, homePath);
  const current = loadPinnedFolders();
  const exists = current.some((item) => item.path === normalized);
  if (exists) {
    const next = current.filter((item) => item.path !== normalized);
    savePinnedFolders(next);
    return { folders: next, pinned: false };
  }
  const next: PinnedCabinetFolder[] = [
    ...current,
    { path: normalized, label: getPathTitle(normalized, homePath) },
  ];
  savePinnedFolders(next);
  return { folders: next, pinned: true };
}

export function isFolderPinnedInStorage(
  rawPath: string,
  homePath?: string | null
): boolean {
  const normalized = normalizePath(rawPath, homePath);
  return loadPinnedFolders().some((item) => item.path === normalized);
}

export function loadCustomInboxPath(): string | null {
  try {
    const val = window.localStorage.getItem(CUSTOM_INBOX_PATH_KEY);
    return val && val.trim().length > 0 ? val.trim() : null;
  } catch {
    return null;
  }
}

export function saveCustomInboxPath(path: string | null): void {
  try {
    if (!path || !path.trim()) {
      window.localStorage.removeItem(CUSTOM_INBOX_PATH_KEY);
    } else {
      window.localStorage.setItem(CUSTOM_INBOX_PATH_KEY, path.trim());
    }
  } catch {
    // Ignore write errors
  }
}
