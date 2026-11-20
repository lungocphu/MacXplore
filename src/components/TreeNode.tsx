import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Folder, Loader2 } from "lucide-react";
import { tauriApi, type FileEntry } from "../lib/tauriApi";
import {
  useActivePane,
  useExplorerStore,
} from "../store/useExplorerStore";

interface TreeNodeProps {
  name: string;
  path: string;
  depth?: number;
  icon?: ReactNode;
  tooltip?: string;
  trailingAction?: ReactNode;
  defaultExpanded?: boolean;
}

export function TreeNode({
  name,
  path,
  depth = 0,
  icon,
  tooltip,
  trailingAction,
  defaultExpanded = false,
}: TreeNodeProps) {
  const activePane = useActivePane();
  const dropTargetFolder = useExplorerStore((s) => s.dropTargetFolder);
  const dropCopyMode = useExplorerStore((s) => s.dropCopyMode);
  const navigateTo = useExplorerStore((s) => s.navigateTo);
  const addTab = useExplorerStore((s) => s.addTab);

  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const isActive = activePane.currentPath === path;
  const isDropTarget = dropTargetFolder === path;

  const handleToggleExpand = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (isExpanded) {
      setIsExpanded(false);
      return;
    }

    setIsExpanded(true);

    if (!hasLoaded) {
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
    }
  };

  const hasKnownNoChildren =
    hasLoaded && children !== null && children.length === 0;

  return (
    <div>
      <div
        role="treeitem"
        data-drop-folder={path}
        aria-expanded={hasKnownNoChildren ? undefined : isExpanded}
        aria-selected={isActive}
        onClick={() => navigateTo(path)}
        onMouseDown={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            e.stopPropagation();
            addTab(path);
          }
        }}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        title={tooltip ?? `${path} (Middle-click to open in new tab)`}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        className={`group relative flex h-[30px] cursor-default items-center gap-1 rounded-[5px] pr-2 text-[12.5px] transition-colors ${
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

        {trailingAction && (
          <span
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="shrink-0"
          >
            {trailingAction}
          </span>
        )}
      </div>

      {isExpanded && children && children.length > 0 && (
        <div role="group">
          {children.map((child) => (
            <TreeNode
              key={child.path}
              name={child.name}
              path={child.path}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
