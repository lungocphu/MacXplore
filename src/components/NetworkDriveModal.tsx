import { useEffect, useRef, useState } from "react";
import {
  Clock,
  Folder,
  FolderOpen,
  HardDrive,
  KeyRound,
  Loader2,
  Network,
  Radar,
  RefreshCw,
  Server,
  Unplug,
  UserCheck,
  X,
} from "lucide-react";
import {
  tauriApi,
  type LanServer,
  type NetworkShareInfo,
} from "../lib/tauriApi";
import { useExplorerStore } from "../store/useExplorerStore";

type LanProtocol = "smb" | "afp" | "nfs" | "webdav";

const PROTOCOL_OPTIONS: Array<{
  id: LanProtocol;
  label: string;
  hint: string;
}> = [
  { id: "smb", label: "SMB", hint: "Windows / NAS / Mac" },
  { id: "afp", label: "AFP", hint: "Legacy macOS" },
  { id: "nfs", label: "NFS", hint: "Linux / NAS" },
  { id: "webdav", label: "WebDAV", hint: "HTTPS Share" },
];

function extractHostForShareBrowse(raw: string): string {
  const cleaned = raw.trim().replace(/\\/g, "/");
  const withoutScheme = cleaned.includes("://")
    ? cleaned.split("://")[1] ?? ""
    : cleaned.replace(/^\/+/, "");
  const afterAuth = withoutScheme.includes("@")
    ? withoutScheme.split("@").pop() ?? ""
    : withoutScheme;
  return afterAuth.split("/")[0]?.trim() ?? "";
}

export function NetworkDriveModal() {
  const networkModalOpen = useExplorerStore((s) => s.networkModalOpen);
  const initialAddress = useExplorerStore((s) => s.networkModalInitialAddress);
  const networkDrives = useExplorerStore((s) => s.networkDrives);
  const isLoadingNetworkDrives = useExplorerStore(
    (s) => s.isLoadingNetworkDrives
  );
  const recentLanAddresses = useExplorerStore((s) => s.recentLanAddresses);

  const closeNetworkModal = useExplorerStore((s) => s.closeNetworkModal);
  const refreshNetworkDrives = useExplorerStore((s) => s.refreshNetworkDrives);
  const connectToLanDrive = useExplorerStore((s) => s.connectToLanDrive);
  const disconnectLanDrive = useExplorerStore((s) => s.disconnectLanDrive);
  const removeRecentLanAddress = useExplorerStore(
    (s) => s.removeRecentLanAddress
  );
  const navigateTo = useExplorerStore((s) => s.navigateTo);

  const [protocol, setProtocol] = useState<LanProtocol>("smb");
  const [address, setAddress] = useState("");
  const [useCredentials, setUseCredentials] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [isConnecting, setIsConnecting] = useState(false);
  const [isScanningLan, setIsScanningLan] = useState(false);
  const [lanServers, setLanServers] = useState<LanServer[]>([]);
  const [hasScannedLan, setHasScannedLan] = useState(false);

  const [isListingShares, setIsListingShares] = useState(false);
  const [sharesHost, setSharesHost] = useState<string>("");
  const [discoveredShares, setDiscoveredShares] = useState<NetworkShareInfo[]>(
    []
  );
  const [shareError, setShareError] = useState<string | null>(null);

  const addressInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!networkModalOpen) return;

    setAddress(initialAddress || "");
    if (initialAddress.toLowerCase().startsWith("afp://")) {
      setProtocol("afp");
    } else if (initialAddress.toLowerCase().startsWith("nfs://")) {
      setProtocol("nfs");
    } else if (/^https?:\/\//i.test(initialAddress)) {
      setProtocol("webdav");
    } else {
      setProtocol("smb");
    }
    setPassword("");
    setShareError(null);
    setDiscoveredShares([]);
    setSharesHost("");

    setTimeout(() => {
      addressInputRef.current?.focus();
    }, 40);

    // Auto-scan LAN devices on open
    void handleScanLan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkModalOpen, initialAddress]);

  useEffect(() => {
    if (!networkModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isConnecting) {
        e.preventDefault();
        closeNetworkModal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [networkModalOpen, isConnecting, closeNetworkModal]);

  const handleScanLan = async () => {
    setIsScanningLan(true);
    try {
      const found = await tauriApi.discoverLanServers();
      setLanServers(found);
      setHasScannedLan(true);
    } catch {
      setLanServers([]);
      setHasScannedLan(true);
    } finally {
      setIsScanningLan(false);
    }
  };

  const handleBrowseShares = async (overrideHost?: string) => {
    const host = extractHostForShareBrowse(overrideHost ?? address);
    if (!host) {
      setShareError("Enter a server IP or hostname first (e.g. 192.168.1.10)");
      return;
    }

    setIsListingShares(true);
    setShareError(null);
    setSharesHost(host);

    try {
      const shares = await tauriApi.listSmbShares(host, {
        username: useCredentials ? username : undefined,
        password: useCredentials ? password : undefined,
      });
      setDiscoveredShares(shares);
      if (shares.length === 0) {
        setShareError(
          `No public SMB shared folders listed on "${host}". You can still click Connect to open macOS login.`
        );
      }
    } catch (err) {
      setDiscoveredShares([]);
      setShareError(String(err));
    } finally {
      setIsListingShares(false);
    }
  };

  const handleConnect = async (overrideAddress?: string) => {
    const targetAddr = (overrideAddress ?? address).trim();
    if (!targetAddr || isConnecting) return;

    setIsConnecting(true);
    const result = await connectToLanDrive(targetAddr, {
      protocol,
      username: useCredentials ? username : undefined,
      password: useCredentials ? password : undefined,
    });
    setIsConnecting(false);

    if (result) {
      closeNetworkModal();
    }
  };

  if (!networkModalOpen) return null;

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isConnecting) {
          closeNetworkModal();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px] select-none"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lan-modal-title"
        className="flex max-h-[88vh] w-[620px] max-w-[95vw] flex-col overflow-hidden rounded-[10px] border border-black/[0.12] bg-[#f9fafc] text-[#1a1a1a] shadow-[0_24px_60px_rgba(0,0,0,0.35)] dark:border-white/[0.12] dark:bg-[#242424] dark:text-[#f3f3f3] dark:shadow-[0_24px_64px_rgba(0,0,0,0.65)]"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-black/[0.08] bg-white px-4 py-3 dark:border-white/[0.08] dark:bg-[#2b2b2b]">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-teal-500/14 text-teal-600 dark:bg-teal-400/16 dark:text-teal-400">
              <Network size={17} />
            </div>
            <div className="min-w-0">
              <h2
                id="lan-modal-title"
                className="truncate text-[14px] font-semibold leading-tight"
              >
                Connect Network Drive (LAN)
              </h2>
              <p className="mt-0.5 truncate text-[11.5px] text-neutral-500 dark:text-neutral-400">
                Mount SMB / Windows Shares, NAS (Synology, QNAP), AFP, or NFS on your local network
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isConnecting}
            onClick={closeNetworkModal}
            aria-label="Close dialog"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] text-neutral-500 transition-colors hover:bg-black/[0.06] hover:text-[#1a1a1a] dark:text-neutral-400 dark:hover:bg-white/[0.08] dark:hover:text-white"
          >
            <X size={15} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {/* Connection Form */}
          <section className="space-y-3 rounded-[8px] border border-black/[0.08] bg-white p-3.5 dark:border-white/[0.08] dark:bg-[#1e1e1e]">
            {/* Protocol Selector */}
            <div className="flex flex-wrap items-center gap-1.5">
              {PROTOCOL_OPTIONS.map((opt) => {
                const active = protocol === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setProtocol(opt.id)}
                    className={`flex h-[26px] items-center gap-1.5 rounded-[5px] border px-2.5 text-[11.5px] transition-colors ${
                      active
                        ? "border-[#0067c0]/50 bg-[#0067c0]/12 font-semibold text-[#0067c0] dark:border-[#60cdff]/50 dark:bg-[#60cdff]/16 dark:text-[#60cdff]"
                        : "border-black/[0.08] bg-[#f5f6f8] text-neutral-600 hover:bg-black/[0.05] dark:border-white/[0.08] dark:bg-[#2a2a2a] dark:text-neutral-300 dark:hover:bg-white/[0.08]"
                    }`}
                  >
                    <span>{opt.label}</span>
                    <span className="text-[10.5px] font-normal opacity-70">
                      {opt.hint}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Server Address Input */}
            <div>
              <label
                htmlFor="lan-address-input"
                className="mb-1 block text-[11.5px] font-medium text-neutral-600 dark:text-neutral-300"
              >
                Server IP / Share address (supports{" "}
                <code className="rounded bg-black/[0.05] px-1 py-0.5 text-[11px] dark:bg-white/[0.08]">
                  \\192.168.1.x\Share
                </code>{" "}
                or{" "}
                <code className="rounded bg-black/[0.05] px-1 py-0.5 text-[11px] dark:bg-white/[0.08]">
                  smb://host/Share
                </code>
                )
              </label>
              <div className="flex items-center gap-2">
                <div className="flex h-[34px] min-w-0 flex-1 items-center gap-2 rounded-[6px] border border-black/[0.12] bg-[#f3f4f6] px-2.5 transition-colors focus-within:border-[#0067c0] focus-within:bg-white focus-within:ring-1 focus-within:ring-[#0067c0]/30 dark:border-white/[0.1] dark:bg-[#272727] dark:focus-within:border-[#60cdff] dark:focus-within:bg-[#191919] dark:focus-within:ring-[#60cdff]/25">
                  <Server
                    size={14}
                    className="shrink-0 text-teal-600 dark:text-teal-400"
                  />
                  <input
                    ref={addressInputRef}
                    id="lan-address-input"
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleConnect();
                      }
                    }}
                    placeholder="192.168.1.10/Shared  or  \\192.168.1.10\Shared"
                    spellCheck={false}
                    className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] text-[#1a1a1a] outline-none placeholder:text-neutral-400 dark:text-[#f3f3f3] dark:placeholder:text-neutral-500"
                  />
                </div>

                {protocol === "smb" && (
                  <button
                    type="button"
                    disabled={isListingShares || !address.trim()}
                    onClick={() => void handleBrowseShares()}
                    title="List shared folders on this SMB server"
                    className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-[6px] border border-black/[0.1] bg-[#f3f5f8] px-3 text-[12px] font-medium text-[#1f1f1f] transition-colors hover:bg-black/[0.06] disabled:opacity-50 dark:border-white/[0.1] dark:bg-[#2c2c2c] dark:text-[#ececec] dark:hover:bg-[#363636]"
                  >
                    {isListingShares ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <FolderOpen size={13} />
                    )}
                    <span>Browse Shares</span>
                  </button>
                )}
              </div>
            </div>

            {/* Optional Credentials Toggle */}
            <div className="space-y-2 pt-0.5">
              <div className="flex items-center gap-3 text-[12px]">
                <button
                  type="button"
                  onClick={() => setUseCredentials(false)}
                  className={`flex items-center gap-1.5 rounded-[5px] px-2 py-1 transition-colors ${
                    !useCredentials
                      ? "bg-[#0067c0]/10 font-medium text-[#0067c0] dark:bg-[#60cdff]/14 dark:text-[#60cdff]"
                      : "text-neutral-500 hover:bg-black/[0.04] dark:text-neutral-400 dark:hover:bg-white/[0.06]"
                  }`}
                >
                  <UserCheck size={13} />
                  <span>Guest / macOS Keychain</span>
                </button>
                <button
                  type="button"
                  onClick={() => setUseCredentials(true)}
                  className={`flex items-center gap-1.5 rounded-[5px] px-2 py-1 transition-colors ${
                    useCredentials
                      ? "bg-[#0067c0]/10 font-medium text-[#0067c0] dark:bg-[#60cdff]/14 dark:text-[#60cdff]"
                      : "text-neutral-500 hover:bg-black/[0.04] dark:text-neutral-400 dark:hover:bg-white/[0.06]"
                  }`}
                >
                  <KeyRound size={13} />
                  <span>Registered User</span>
                </button>
              </div>

              {useCredentials && (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Username"
                    spellCheck={false}
                    autoComplete="off"
                    className="h-[32px] rounded-[6px] border border-black/[0.1] bg-[#f3f4f6] px-2.5 text-[12.5px] text-[#1a1a1a] outline-none focus:border-[#0067c0] focus:bg-white dark:border-white/[0.1] dark:bg-[#272727] dark:text-[#f3f3f3] dark:focus:border-[#60cdff] dark:focus:bg-[#191919]"
                  />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleConnect();
                      }
                    }}
                    placeholder="Password (optional)"
                    autoComplete="off"
                    className="h-[32px] rounded-[6px] border border-black/[0.1] bg-[#f3f4f6] px-2.5 text-[12.5px] text-[#1a1a1a] outline-none focus:border-[#0067c0] focus:bg-white dark:border-white/[0.1] dark:bg-[#272727] dark:text-[#f3f3f3] dark:focus:border-[#60cdff] dark:focus:bg-[#191919]"
                  />
                </div>
              )}
            </div>

            {/* Browsed SMB Shares Results */}
            {(discoveredShares.length > 0 || shareError) && (
              <div className="rounded-[6px] border border-black/[0.08] bg-[#f7f9fc] p-2.5 dark:border-white/[0.08] dark:bg-[#252525]">
                {shareError ? (
                  <p className="text-[11.5px] text-amber-600 dark:text-amber-400">
                    {shareError}
                  </p>
                ) : (
                  <>
                    <div className="mb-1.5 text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">
                      Shared folders on {sharesHost} (click to mount &amp; open)
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {discoveredShares.map((share) => {
                        const shareUrl = `smb://${sharesHost}/${share.name}`;
                        return (
                          <button
                            key={share.name}
                            type="button"
                            disabled={isConnecting}
                            onClick={() => {
                              setAddress(shareUrl);
                              void handleConnect(shareUrl);
                            }}
                            title={
                              share.comment
                                ? `${shareUrl} — ${share.comment}`
                                : shareUrl
                            }
                            className="flex h-[28px] items-center gap-1.5 rounded-[5px] border border-black/[0.08] bg-white px-2.5 text-[12px] font-medium text-[#1f1f1f] transition-colors hover:border-[#0067c0]/50 hover:bg-[#0067c0]/8 hover:text-[#0067c0] dark:border-white/[0.1] dark:bg-[#2e2e2e] dark:text-[#efefef] dark:hover:border-[#60cdff]/50 dark:hover:bg-[#60cdff]/12 dark:hover:text-[#60cdff]"
                          >
                            <Folder
                              size={13}
                              className="fill-amber-400/90 text-amber-500 dark:fill-amber-400/85 dark:text-amber-300"
                            />
                            <span>{share.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </section>

          {/* Auto-discovered LAN Devices (Bonjour / mDNS) */}
          <section className="rounded-[8px] border border-black/[0.08] bg-white p-3.5 dark:border-white/[0.08] dark:bg-[#1e1e1e]">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11.5px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                <Radar size={13} className="text-teal-600 dark:text-teal-400" />
                <span>Discovered on LAN</span>
              </div>
              <button
                type="button"
                disabled={isScanningLan}
                onClick={() => void handleScanLan()}
                className="flex h-[24px] items-center gap-1 rounded-[4px] px-2 text-[11.5px] font-medium text-[#0067c0] transition-colors hover:bg-[#0067c0]/10 disabled:opacity-50 dark:text-[#60cdff] dark:hover:bg-[#60cdff]/14"
              >
                <RefreshCw
                  size={11}
                  className={isScanningLan ? "animate-spin" : ""}
                />
                <span>{isScanningLan ? "Scanning..." : "Rescan"}</span>
              </button>
            </div>

            {isScanningLan && lanServers.length === 0 ? (
              <div className="flex items-center gap-2 py-2 text-[12px] text-neutral-500 dark:text-neutral-400">
                <Loader2 size={13} className="animate-spin" />
                <span>Scanning local network for SMB / AFP servers...</span>
              </div>
            ) : lanServers.length === 0 ? (
              <p className="py-1 text-[12px] text-neutral-400 dark:text-neutral-500">
                {hasScannedLan
                  ? "No Bonjour/SMB devices discovered automatically. Enter a server IP directly above (e.g. 192.168.1.10)."
                  : "Click Rescan to discover devices on your LAN."}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {lanServers.map((server) => (
                  <button
                    key={`${server.protocol}:${server.name}`}
                    type="button"
                    onClick={() => {
                      setProtocol(
                        server.protocol.toLowerCase() === "afp" ? "afp" : "smb"
                      );
                      setAddress(server.address);
                      if (server.protocol === "SMB") {
                        void handleBrowseShares(server.host);
                      }
                    }}
                    title={`${server.address} — Click to browse shares`}
                    className="flex h-[30px] items-center gap-2 rounded-[6px] border border-black/[0.08] bg-[#f5f7fa] px-2.5 text-[12px] text-[#1f1f1f] transition-colors hover:border-teal-500/50 hover:bg-teal-500/8 dark:border-white/[0.1] dark:bg-[#2a2a2a] dark:text-[#ececec] dark:hover:border-teal-400/50 dark:hover:bg-teal-400/12"
                  >
                    <Server
                      size={13}
                      className="shrink-0 text-teal-600 dark:text-teal-400"
                    />
                    <span className="font-medium">{server.name}</span>
                    <span className="rounded bg-black/[0.06] px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500 dark:bg-white/[0.08] dark:text-neutral-400">
                      {server.protocol}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Recent LAN Addresses */}
          {recentLanAddresses.length > 0 && (
            <section className="rounded-[8px] border border-black/[0.08] bg-white p-3.5 dark:border-white/[0.08] dark:bg-[#1e1e1e]">
              <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                <Clock size={12} />
                <span>Recent LAN Servers</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {recentLanAddresses.map((recent) => (
                  <div
                    key={recent}
                    className="group flex h-[28px] items-center overflow-hidden rounded-[5px] border border-black/[0.08] bg-[#f5f6f8] text-[12px] dark:border-white/[0.08] dark:bg-[#2a2a2a]"
                  >
                    <button
                      type="button"
                      onClick={() => setAddress(recent)}
                      title={`Use ${recent}`}
                      className="flex h-full items-center gap-1.5 px-2.5 text-[#2c2c2c] hover:bg-black/[0.05] dark:text-[#e2e2e2] dark:hover:bg-white/[0.08]"
                    >
                      <span className="max-w-[220px] truncate">{recent}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRecentLanAddress(recent)}
                      aria-label={`Remove ${recent}`}
                      className="flex h-full items-center px-1.5 text-neutral-400 hover:bg-red-500/10 hover:text-red-500"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Currently Mounted LAN Drives */}
          <section className="rounded-[8px] border border-black/[0.08] bg-white p-3.5 dark:border-white/[0.08] dark:bg-[#1e1e1e]">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11.5px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                <HardDrive size={12} />
                <span>Mounted Network Drives ({networkDrives.length})</span>
              </div>
              <button
                type="button"
                disabled={isLoadingNetworkDrives}
                onClick={() => void refreshNetworkDrives()}
                className="flex h-[24px] items-center gap-1 rounded-[4px] px-2 text-[11.5px] font-medium text-neutral-500 transition-colors hover:bg-black/[0.06] hover:text-[#1a1a1a] dark:text-neutral-400 dark:hover:bg-white/[0.08] dark:hover:text-white"
              >
                <RefreshCw
                  size={11}
                  className={isLoadingNetworkDrives ? "animate-spin" : ""}
                />
                <span>Refresh</span>
              </button>
            </div>

            {networkDrives.length === 0 ? (
              <p className="py-1 text-[12px] text-neutral-400 dark:text-neutral-500">
                No LAN network drives are currently mounted.
              </p>
            ) : (
              <div className="space-y-1">
                {networkDrives.map((drive) => (
                  <div
                    key={drive.path}
                    className="flex items-center justify-between gap-2 rounded-[6px] border border-black/[0.06] bg-[#f7f8fa] px-2.5 py-2 dark:border-white/[0.06] dark:bg-[#262626]"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Network
                        size={15}
                        className="shrink-0 text-teal-600 dark:text-teal-400"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[12.5px] font-medium text-[#1a1a1a] dark:text-[#f3f3f3]">
                            {drive.name}
                          </span>
                          <span className="rounded bg-teal-500/14 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:bg-teal-400/16 dark:text-teal-300">
                            {drive.protocol}
                          </span>
                        </div>
                        <div className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                          {drive.remote_url} &bull; {drive.path}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          navigateTo(drive.path);
                          closeNetworkModal();
                        }}
                        className="flex h-[26px] items-center gap-1 rounded-[5px] bg-[#0067c0]/12 px-2.5 text-[11.5px] font-medium text-[#0067c0] hover:bg-[#0067c0]/20 dark:bg-[#60cdff]/16 dark:text-[#60cdff] dark:hover:bg-[#60cdff]/24"
                      >
                        <FolderOpen size={12} />
                        <span>Open</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void disconnectLanDrive(drive.path)}
                        title={`Disconnect ${drive.name}`}
                        className="flex h-[26px] items-center gap-1 rounded-[5px] border border-black/[0.08] bg-white px-2 text-[11.5px] text-neutral-600 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600 dark:border-white/[0.1] dark:bg-[#2f2f2f] dark:text-neutral-300 dark:hover:text-red-400"
                      >
                        <Unplug size={12} />
                        <span>Eject</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-black/[0.08] bg-[#f3f5f8] px-4 py-3 dark:border-white/[0.08] dark:bg-[#2b2b2b]">
          <span className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
            Tip: You can also paste{" "}
            <code className="rounded bg-black/[0.06] px-1 py-0.5 dark:bg-white/[0.08]">
              \\IP\Share
            </code>{" "}
            directly in the Address Bar
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isConnecting}
              onClick={closeNetworkModal}
              className="flex h-[32px] items-center justify-center rounded-[5px] border border-black/[0.1] bg-white px-4 text-[12.5px] font-medium text-[#1f1f1f] transition-colors hover:bg-black/[0.04] disabled:opacity-50 dark:border-white/[0.1] dark:bg-[#333333] dark:text-[#f0f0f0] dark:hover:bg-[#3c3c3c]"
            >
              Close
            </button>
            <button
              type="button"
              disabled={isConnecting || !address.trim()}
              onClick={() => void handleConnect()}
              className="flex h-[32px] min-w-[110px] items-center justify-center gap-1.5 rounded-[5px] bg-[#0067c0] px-4 text-[12.5px] font-medium text-white transition-colors hover:bg-[#005aa8] active:bg-[#004e92] disabled:opacity-50 dark:bg-[#60cdff] dark:text-[#141414] dark:hover:bg-[#7ad5ff] dark:active:bg-[#4ec0f5]"
            >
              {isConnecting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Network size={14} />
              )}
              <span>{isConnecting ? "Connecting..." : "Connect"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
