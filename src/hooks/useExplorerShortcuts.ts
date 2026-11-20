import { useEffect } from "react";
import { getVisibleEntries } from "../lib/format";
import {
  getActivePaneSnapshot,
  selectActiveTab,
  useExplorerStore,
} from "../store/useExplorerStore";

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  return target.isContentEditable;
}

export function useExplorerShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const state = useExplorerStore.getState();

      // Do not intercept typing in inputs or while modal / inline rename is open
      if (
        state.destinationModal !== null ||
        state.networkModalOpen ||
        state.renamingPath !== null ||
        isEditableElement(e.target)
      ) {
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const activePane = getActivePaneSnapshot(state);
      const activeTab = selectActiveTab(state);

      // Cmd + K: Connect Network Drive (LAN) — matches macOS Finder
      if (mod && !e.shiftKey && !e.altKey && key === "k") {
        e.preventDefault();
        state.openNetworkModal();
        return;
      }

      // Cmd + \: Toggle Split View / Dual Pane
      if (
        mod &&
        !e.shiftKey &&
        !e.altKey &&
        (e.key === "\\" || e.code === "Backslash")
      ) {
        e.preventDefault();
        state.toggleDualPane();
        return;
      }

      // Cmd + Z: Undo last filesystem action
      if (mod && !e.shiftKey && key === "z") {
        if (state.undoStack.length > 0 && !state.isUndoing) {
          e.preventDefault();
          void state.undoLastAction();
        }
        return;
      }

      // Cmd + Shift + Z (or Ctrl + Y): Redo last undone action
      if (
        (mod && e.shiftKey && key === "z") ||
        (mod && !e.shiftKey && key === "y")
      ) {
        if (state.redoStack.length > 0 && !state.isUndoing) {
          e.preventDefault();
          void state.redoLastAction();
        }
        return;
      }

      // Cmd + A: Select All in Active Pane
      if (mod && !e.shiftKey && key === "a") {
        e.preventDefault();
        state.selectAll();
        return;
      }

      // Cmd + C: Copy from Active Pane
      if (mod && !e.shiftKey && key === "c") {
        if (activePane.selectedPaths.length > 0) {
          e.preventDefault();
          state.copySelected();
        }
        return;
      }

      // Cmd + X: Cut from Active Pane
      if (mod && !e.shiftKey && key === "x") {
        if (activePane.selectedPaths.length > 0) {
          e.preventDefault();
          state.cutSelected();
        }
        return;
      }

      // Cmd + V: Paste into Active Pane
      if (mod && !e.shiftKey && key === "v") {
        if (state.clipboard.action && state.clipboard.paths.length > 0) {
          e.preventDefault();
          void state.pasteClipboard();
        }
        return;
      }

      // Cmd + Backspace: Move selected items in Active Pane to macOS Trash
      if (mod && e.key === "Backspace") {
        if (activePane.selectedPaths.length > 0) {
          e.preventDefault();
          void state.deleteSelected();
        }
        return;
      }

      // F2: Rename inline in Active Pane
      if (e.key === "F2") {
        if (activePane.selectedPaths.length === 1) {
          e.preventDefault();
          state.startRenaming(activePane.selectedPaths[0], activePane.paneId);
        }
        return;
      }

      // Space: QuickLook preview on macOS when 1 item is selected in Active Pane
      if (
        (e.key === " " || e.code === "Space") &&
        !mod &&
        !e.altKey &&
        !e.shiftKey
      ) {
        if (activePane.selectedPaths.length === 1) {
          e.preventDefault();
          void state.quicklookSelected(activePane.selectedPaths[0]);
        }
        return;
      }

      // Enter: Open selected folder or file with default macOS app
      if (e.key === "Enter" && !mod && !e.altKey) {
        if (activePane.selectedPaths.length > 0) {
          e.preventDefault();
          void state.openSelected();
        }
        return;
      }

      // Cmd + Shift + N: New Folder in Active Pane
      if (mod && e.shiftKey && key === "n") {
        e.preventDefault();
        void state.createNewFolder();
        return;
      }

      // Cmd + R or F5: Refresh Active Pane
      if ((mod && key === "r") || e.key === "F5") {
        e.preventDefault();
        void state.refresh();
        return;
      }

      // Cmd + T: Open New Tab (defaults to Home)
      if (mod && !e.shiftKey && key === "t") {
        e.preventDefault();
        state.addTab();
        return;
      }

      // Cmd + W: Close Current Tab
      if (mod && !e.shiftKey && key === "w") {
        e.preventDefault();
        state.closeTab(activeTab.id);
        return;
      }

      // Cmd + ArrowUp: Go Up one level in Active Pane
      if (mod && e.key === "ArrowUp") {
        e.preventDefault();
        state.goUp();
        return;
      }

      // Cmd + [ or Cmd + ]: Back / Forward in Active Pane
      if (mod && e.key === "[") {
        e.preventDefault();
        state.goBack();
        return;
      }
      if (mod && e.key === "]") {
        e.preventDefault();
        state.goForward();
        return;
      }

      // ArrowUp / ArrowDown: Navigate selection smoothly in Active Pane
      if (
        (e.key === "ArrowDown" || e.key === "ArrowUp") &&
        !mod &&
        !e.altKey
      ) {
        const visible = activePane.spotlightActive
          ? getVisibleEntries(
              activePane.spotlightResults,
              "",
              state.sortField,
              state.sortDirection
            )
          : getVisibleEntries(
              activePane.entries,
              activePane.searchQuery,
              state.sortField,
              state.sortDirection
            );
        if (visible.length === 0) return;

        e.preventDefault();
        const currentFocusPath =
          activePane.selectedPaths[activePane.selectedPaths.length - 1] ??
          activePane.lastSelectedPath;
        const currentIdx = currentFocusPath
          ? visible.findIndex((item) => item.path === currentFocusPath)
          : -1;

        let nextIdx = 0;
        if (currentIdx === -1) {
          nextIdx = e.key === "ArrowDown" ? 0 : visible.length - 1;
        } else if (e.key === "ArrowDown") {
          nextIdx = Math.min(visible.length - 1, currentIdx + 1);
        } else {
          nextIdx = Math.max(0, currentIdx - 1);
        }

        const nextPath = visible[nextIdx].path;
        state.setSelectedPaths([nextPath], nextPath, activePane.paneId);
        return;
      }

      // Escape: Close context menu, clear selection, or exit Spotlight search
      if (e.key === "Escape") {
        if (state.contextMenu) {
          state.closeContextMenu();
        } else if (activePane.selectedPaths.length > 0) {
          state.clearSelection();
        } else if (activePane.spotlightActive) {
          state.clearSpotlightSearch();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
