import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Loader2,
  RotateCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useExplorerStore, usePane } from "../store/useExplorerStore";
import { getParentPath } from "../lib/format";
import { AddressBar } from "./AddressBar";

export function NavigationBar() {
  const pane = usePane("left");

  const goBack = useExplorerStore((s) => s.goBack);
  const goForward = useExplorerStore((s) => s.goForward);
  const goUp = useExplorerStore((s) => s.goUp);
  const refresh = useExplorerStore((s) => s.refresh);
  const setSearchQuery = useExplorerStore((s) => s.setSearchQuery);
  const runSpotlightSearch = useExplorerStore((s) => s.runSpotlightSearch);
  const clearSpotlightSearch = useExplorerStore((s) => s.clearSpotlightSearch);

  const canGoBack = pane.historyIndex > 0;
  const canGoForward = pane.historyIndex < pane.history.length - 1;
  const canGoUp = getParentPath(pane.currentPath) !== null;

  const navBtnClass = (enabled: boolean) =>
    `flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[5px] transition-colors ${
      enabled
        ? "text-[#1f1f1f] hover:bg-black/[0.06] active:bg-black/[0.1] dark:text-[#ececec] dark:hover:bg-white/[0.08] dark:active:bg-white/[0.12]"
        : "cursor-default text-[#a3a3a3] dark:text-[#5c5c5c]"
    }`;

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void runSpotlightSearch(pane.searchQuery, "left");
    } else if (e.key === "Escape") {
      e.preventDefault();
      clearSpotlightSearch("left");
      e.currentTarget.blur();
    }
  };

  return (
    <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-black/[0.08] bg-[#f9fafc] px-2.5 dark:border-white/[0.08] dark:bg-[#2c2c2c]">
      {/* Back / Forward / Up / Refresh */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => goBack("left")}
          disabled={!canGoBack}
          title="Back (⌘[)"
          aria-label="Back"
          className={navBtnClass(canGoBack)}
        >
          <ArrowLeft size={15} strokeWidth={1.9} />
        </button>
        <button
          type="button"
          onClick={() => goForward("left")}
          disabled={!canGoForward}
          title="Forward (⌘])"
          aria-label="Forward"
          className={navBtnClass(canGoForward)}
        >
          <ArrowRight size={15} strokeWidth={1.9} />
        </button>
        <button
          type="button"
          onClick={() => goUp("left")}
          disabled={!canGoUp}
          title="Up one level (⌘↑)"
          aria-label="Up one level"
          className={navBtnClass(canGoUp)}
        >
          <ArrowUp size={15} strokeWidth={1.9} />
        </button>
        <button
          type="button"
          onClick={() => void refresh("left")}
          title="Refresh (⌘R)"
          aria-label="Refresh"
          className={navBtnClass(true)}
        >
          <RotateCw
            size={14}
            strokeWidth={1.9}
            className={pane.isLoading || pane.isSearching ? "animate-spin" : ""}
          />
        </button>
      </div>

      {/* Editable Breadcrumb Address Bar */}
      <AddressBar paneId="left" />

      {/* Live Filter + macOS Spotlight Search (Press Enter) */}
      <div
        title="Type to filter current folder, or press Enter for macOS Spotlight search"
        className={`hidden h-[32px] w-[248px] shrink-0 items-center gap-1.5 rounded-[6px] border px-2.5 transition-colors sm:flex ${
          pane.spotlightActive
            ? "border-[#0067c0]/60 bg-white dark:border-[#60cdff]/60 dark:bg-[#1f1f1f]"
            : "border-black/[0.08] bg-[#f3f4f6] focus-within:border-[#0067c0] focus-within:bg-white dark:border-white/[0.08] dark:bg-[#232323] dark:focus-within:border-[#60cdff] dark:focus-within:bg-[#1f1f1f]"
        }`}
      >
        {pane.isSearching ? (
          <Loader2
            size={13}
            className="shrink-0 animate-spin text-[#0067c0] dark:text-[#60cdff]"
          />
        ) : pane.spotlightActive ? (
          <Sparkles
            size={13}
            className="shrink-0 text-[#0067c0] dark:text-[#60cdff]"
          />
        ) : (
          <Search
            size={13}
            className="shrink-0 text-neutral-400 dark:text-neutral-500"
          />
        )}
        <input
          type="text"
          value={pane.searchQuery}
          onChange={(e) => setSearchQuery(e.target.value, "left")}
          onKeyDown={handleSearchKeyDown}
          placeholder={`Search ${pane.title} (↵ Spotlight)`}
          spellCheck={false}
          aria-label="Search current folder or run Spotlight search"
          className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] text-[#1a1a1a] placeholder:text-neutral-400 outline-none dark:text-[#f3f3f3] dark:placeholder:text-neutral-500"
        />
        {(pane.searchQuery || pane.spotlightActive) && (
          <button
            type="button"
            onClick={() => clearSpotlightSearch("left")}
            aria-label="Clear search"
            className="flex h-4 w-4 items-center justify-center rounded text-neutral-400 hover:bg-black/[0.06] hover:text-neutral-700 dark:hover:bg-white/[0.1] dark:hover:text-neutral-200"
          >
            <X size={11} />
          </button>
        )}
      </div>
    </div>
  );
}
