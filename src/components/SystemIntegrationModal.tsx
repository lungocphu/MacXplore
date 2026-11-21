import { useEffect, useState } from "react";
import {
  Bell,
  CheckCircle2,
  Compass,
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { tauriApi } from "../lib/tauriApi";
import { useExplorerStore } from "../store/useExplorerStore";

export function SystemIntegrationModal() {
  const isOpen = useExplorerStore((s) => s.integrationModalOpen);
  const status = useExplorerStore((s) => s.macosIntegrationStatus);
  const downloadNotificationsEnabled = useExplorerStore(
    (s) => s.downloadNotificationsEnabled
  );
  const specialPaths = useExplorerStore((s) => s.specialPaths);

  const closeIntegrationModal = useExplorerStore(
    (s) => s.closeIntegrationModal
  );
  const refreshMacosIntegrationStatus = useExplorerStore(
    (s) => s.refreshMacosIntegrationStatus
  );
  const setMacosIntegrationStatus = useExplorerStore(
    (s) => s.setMacosIntegrationStatus
  );
  const setDownloadNotificationsEnabled = useExplorerStore(
    (s) => s.setDownloadNotificationsEnabled
  );
  const navigateTo = useExplorerStore((s) => s.navigateTo);
  const showToast = useExplorerStore((s) => s.showToast);

  const [busyKey, setBusyKey] = useState<
    "viewer" | "service" | null
  >(null);

  useEffect(() => {
    if (!isOpen) return;
    void refreshMacosIntegrationStatus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeIntegrationModal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeIntegrationModal, refreshMacosIntegrationStatus]);

  if (!isOpen) return null;

  const isDefaultViewer = status?.is_default_file_viewer ?? false;
  const quickActionInstalled = status?.quick_action_installed ?? false;

  const handleToggleDefaultViewer = async () => {
    setBusyKey("viewer");
    try {
      const next = await tauriApi.setDefaultFileViewer(!isDefaultViewer);
      setMacosIntegrationStatus(next);
      showToast(
        next.is_default_file_viewer
          ? 'Enabled: "Show in Finder" from browsers now opens in MXplore (restart browsers if already open).'
          : 'Restored default macOS "Show in Finder" to Apple Finder.',
        "info"
      );
    } catch (err) {
      showToast(`Failed to update NSFileViewer: ${String(err)}`, "error");
    } finally {
      setBusyKey(null);
    }
  };

  const handleToggleQuickAction = async () => {
    setBusyKey("service");
    try {
      const next = quickActionInstalled
        ? await tauriApi.uninstallShowInMxploreService()
        : await tauriApi.installShowInMxploreService();
      setMacosIntegrationStatus(next);
      showToast(
        next.quick_action_installed
          ? 'Installed macOS Quick Action: right-click any file → Quick Actions / Services → "Show in MXplore".'
          : 'Removed "Show in MXplore" macOS Quick Action.',
        "info"
      );
    } catch (err) {
      showToast(`Quick Action update failed: ${String(err)}`, "error");
    } finally {
      setBusyKey(null);
    }
  };

  const handleOpenDownloads = () => {
    const downloadsDir = specialPaths?.downloads;
    if (downloadsDir) {
      navigateTo(downloadsDir);
      closeIntegrationModal();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Show in MXplore — macOS Integration"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeIntegrationModal();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]"
    >
      <div className="flex w-full max-w-[540px] flex-col overflow-hidden rounded-[12px] border border-black/[0.12] bg-white text-[#1a1a1a] shadow-[0_24px_64px_rgba(0,0,0,0.28)] dark:border-white/[0.12] dark:bg-[#252525] dark:text-[#f3f3f3]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/[0.08] bg-[#f6f8fb] px-4 py-3 dark:border-white/[0.08] dark:bg-[#2c2c2c]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#0067c0]/12 text-[#0067c0] dark:bg-[#60cdff]/16 dark:text-[#60cdff]">
              <Compass size={17} />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold leading-tight">
                Show in MXplore — macOS Integration
              </h2>
              <p className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
                Open &amp; highlight downloaded files in MXplore alongside Finder
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeIntegrationModal}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-[6px] text-neutral-500 transition-colors hover:bg-black/[0.06] hover:text-[#1a1a1a] dark:text-neutral-400 dark:hover:bg-white/[0.08] dark:hover:text-white"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-3 p-4">
          {/* Option 1: macOS Quick Action / Services ("Show in MXplore") */}
          <div className="rounded-[9px] border border-black/[0.08] bg-[#fafbfd] p-3.5 dark:border-white/[0.08] dark:bg-[#2b2b2b]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <Sparkles
                  size={17}
                  className="mt-0.5 shrink-0 text-amber-500 dark:text-amber-400"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold">
                      macOS Quick Action: &ldquo;Show in MXplore&rdquo;
                    </span>
                    {quickActionInstalled && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 size={11} />
                        Installed
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-neutral-600 dark:text-neutral-400">
                    Adds <strong>Show in MXplore</strong> to macOS right-click{" "}
                    <em>Quick Actions / Services</em> in Finder, Desktop, and Downloads
                    without changing Finder defaults.
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={busyKey !== null}
                onClick={() => void handleToggleQuickAction()}
                className={`flex h-[30px] shrink-0 items-center gap-1.5 rounded-[6px] px-3 text-[12px] font-medium transition-colors disabled:opacity-50 ${
                  quickActionInstalled
                    ? "border border-black/[0.12] bg-white text-[#1f1f1f] hover:bg-red-50 hover:text-red-600 dark:border-white/[0.12] dark:bg-[#353535] dark:text-[#ececec] dark:hover:bg-red-500/15 dark:hover:text-red-300"
                    : "bg-[#0067c0] text-white hover:bg-[#005aa8] dark:bg-[#60cdff] dark:text-[#121212] dark:hover:bg-[#7ad5ff]"
                }`}
              >
                {busyKey === "service" && (
                  <Loader2 size={13} className="animate-spin" />
                )}
                <span>{quickActionInstalled ? "Remove" : "Install"}</span>
              </button>
            </div>
          </div>

          {/* Option 2: Redirect Browser "Show in Finder" -> MXplore (NSFileViewer) */}
          <div className="rounded-[9px] border border-black/[0.08] bg-[#fafbfd] p-3.5 dark:border-white/[0.08] dark:bg-[#2b2b2b]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <ExternalLink
                  size={17}
                  className="mt-0.5 shrink-0 text-[#0067c0] dark:text-[#60cdff]"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold">
                      Redirect Browser &ldquo;Show in Finder&rdquo; → MXplore
                    </span>
                    {isDefaultViewer && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 size={11} />
                        Active
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-neutral-600 dark:text-neutral-400">
                    Sets macOS <code className="rounded bg-black/[0.06] px-1 py-0.5 text-[11px] dark:bg-white/[0.08]">NSFileViewer</code>{" "}
                    so clicking <strong>Show in Finder</strong> on completed downloads in Chrome, Safari, Edge, Brave, Firefox, Slack, or Telegram opens &amp; selects the file directly in <strong>MXplore</strong>.
                    MXplore&rsquo;s own &ldquo;Show in Finder&rdquo; button still opens Apple Finder.
                  </p>
                  <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                    Tip: Already-open browsers may need a quick restart to pick up the change. Reversible anytime.
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={busyKey !== null}
                onClick={() => void handleToggleDefaultViewer()}
                className={`flex h-[30px] shrink-0 items-center gap-1.5 rounded-[6px] px-3 text-[12px] font-medium transition-colors disabled:opacity-50 ${
                  isDefaultViewer
                    ? "border border-black/[0.12] bg-white text-[#1f1f1f] hover:bg-neutral-100 dark:border-white/[0.12] dark:bg-[#353535] dark:text-[#ececec] dark:hover:bg-white/[0.1]"
                    : "bg-[#0067c0] text-white hover:bg-[#005aa8] dark:bg-[#60cdff] dark:text-[#121212] dark:hover:bg-[#7ad5ff]"
                }`}
              >
                {busyKey === "viewer" && (
                  <Loader2 size={13} className="animate-spin" />
                )}
                <span>{isDefaultViewer ? "Restore Finder" : "Enable"}</span>
              </button>
            </div>
          </div>

          {/* Option 3: Live ~/Downloads Watcher Notification */}
          <div className="rounded-[9px] border border-black/[0.08] bg-[#fafbfd] p-3.5 dark:border-white/[0.08] dark:bg-[#2b2b2b]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <Bell
                  size={17}
                  className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold">
                      Download Complete Banner (MXplore + Finder)
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-neutral-600 dark:text-neutral-400">
                    Automatically watches <code className="rounded bg-black/[0.06] px-1 py-0.5 text-[11px] dark:bg-white/[0.08]">~/Downloads</code>{" "}
                    and shows a quick pop-up whenever a file finishes downloading with both{" "}
                    <strong>Show in MXplore</strong> and <strong>Show in Finder</strong> buttons.
                  </p>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={downloadNotificationsEnabled}
                onClick={() =>
                  setDownloadNotificationsEnabled(!downloadNotificationsEnabled)
                }
                className={`relative mt-0.5 inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full transition-colors ${
                  downloadNotificationsEnabled
                    ? "bg-[#0067c0] dark:bg-[#60cdff]"
                    : "bg-neutral-300 dark:bg-neutral-600"
                }`}
              >
                <span
                  className={`inline-block h-[16px] w-[16px] transform rounded-full bg-white shadow transition-transform dark:bg-[#1a1a1a] ${
                    downloadNotificationsEnabled
                      ? "translate-x-[21px]"
                      : "translate-x-[3px]"
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-black/[0.08] bg-[#f6f8fb] px-4 py-2.5 dark:border-white/[0.08] dark:bg-[#2c2c2c]">
          <button
            type="button"
            onClick={handleOpenDownloads}
            disabled={!specialPaths?.downloads}
            className="flex items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-[12px] font-medium text-[#0067c0] transition-colors hover:bg-[#0067c0]/10 disabled:opacity-40 dark:text-[#60cdff] dark:hover:bg-[#60cdff]/12"
          >
            <Download size={13} />
            <span>Open ~/Downloads</span>
          </button>

          <button
            type="button"
            onClick={closeIntegrationModal}
            className="flex items-center gap-1.5 rounded-[6px] border border-black/[0.12] bg-white px-3.5 py-1.5 text-[12px] font-medium text-[#1f1f1f] transition-colors hover:bg-black/[0.04] dark:border-white/[0.12] dark:bg-[#353535] dark:text-[#ececec] dark:hover:bg-white/[0.08]"
          >
            <FolderOpen size={13} />
            <span>Done</span>
          </button>
        </div>
      </div>
    </div>
  );
}
