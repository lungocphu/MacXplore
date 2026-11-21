<p align="center">
  <img src="app-icon.png" alt="MXplore Icon" width="112" height="112" />
</p>

<h1 align="center">MXplore (File Explorer in MacOS)</h1>

<p align="center">
  <strong>Windows 11 File Explorer UI &amp; productivity meets native macOS Finder power.</strong><br/>
  Built with Tauri v2, Rust, React 19, TypeScript, Tailwind CSS v4, and Zustand.<br/>
  <sub>Latest Release: <a href="https://github.com/lungocphu/MacXplore/releases/tag/v0.1.1"><strong>v0.1.1</strong></a></sub>
</p>

---

## What's New in v0.1.1

- **"Show in MXplore" for Completed Downloads:** Live background watcher on `~/Downloads` ignores in-progress browser downloads (`.crdownload`, `.download`, `.part`, `.tmp`) and pops up a non-intrusive banner offering both **Show in MXplore** (opens parent folder, selects & scrolls directly to the file) and **Show in Finder**, while automatically refreshing open `~/Downloads` tabs.
- **1-Click macOS Integration Dialog (`macOS` button on Command Bar & Menu Bar Tray):**
  - **macOS Quick Action (`Show in MXplore`):** 1-click install/remove of `~/Library/Services/Show in MXplore.workflow` so right-clicking any file/folder in Finder, Desktop, or Downloads offers **Quick Actions / Services → Show in MXplore**.
  - **Redirect Browser "Show in Finder" → MXplore (`NSFileViewer`):** 1-click toggle (`defaults write -g NSFileViewer -string com.mxplore.explorer`) so clicking "Show in Finder" on completed downloads in Chrome, Safari, Edge, Brave, Firefox, Slack, or Telegram reveals the exact file in MXplore (reversible anytime; MXplore's own "Show in Finder" still opens Apple Finder safely).
- **Quick Cabinet Reveal Actions:** Every row in Menu Bar Quick Cabinet now includes a dedicated **Show in MXplore** button alongside **Show in Finder**, plus a live completed-download strip.
- **`mxplore://` URL Scheme & Document Handler:** Registered `CFBundleDocumentTypes` (`public.folder`, `public.item`) and `mxplore://reveal?path=...` in `src-tauri/Info.plist` with warm-start and cold-start reveal handling.
- **New macOS App Icon:** Refreshed transparent squircle icon with enlarged framing and soft macOS drop shadow across `.icns`, `.ico`, PNGs, and GitHub repository icon.

---

## Features

### Explorer-Style Interface & Navigation
- **Multi-Tab Browsing:** Open new tabs (`⌘T`), close tabs (`⌘W`), middle-click any folder/archive/sidebar item/breadcrumb to open in a new tab, or right-click → **Open in New Tab**.
- **Dual Pane (Split View):** Toggle side-by-side Left/Right panes (`⌘\`) with a resizable divider (double-click to reset 50/50). Each pane keeps independent navigation history, address bar, filter/Spotlight search, and selection state.
- **Windows 11 View Layouts:** Dropdown `View` menu with **Details**, **List** (compact multi-column), **Medium Icons**, and **Large Icons** (with native macOS image thumbnails via `sips` + LRU cache for PNG/JPEG/WebP/HEIC/TIFF/SVG), all powered by virtual scrolling (`@tanstack/react-virtual`).
- **Item Checkboxes:** Toggle **Item check boxes** in the `View` menu for multi-selection without holding `⌘`, complete with an indeterminate **Select All** header checkbox.
- **Rich File Operations & Undo/Redo:** Cut, Copy, Paste, Copy To / Move To modal & hover submenu (with Quick Access, Cloud Drives, LAN Drives, Open Tabs, and Other Pane shortcuts), inline Rename (`F2`), Move to macOS Trash (`⌘⌫`), and full **Undo/Redo** (`⌘Z` / `⇧⌘Z`).
- **Distinct Office & Media Icons:** Crisp vector icons including Microsoft 365-style orange PowerPoint (`.ppt`/`.pptx`) icons.

### Native macOS Finder Power
- **True Native Drag & Drop (`NSDraggingSession`):**
  - Drag single or multiple files/folders out of MXplore (or Quick Cabinet) into **any macOS app** (Chrome, Safari, Slack, Mail, VS Code, Terminal, Finder, Desktop) with native macOS file icons and pile formation.
  - Internal drag-and-drop onto subfolders, Dual Pane, Sidebar items, Address Bar breadcrumbs, and Tabs — hold **`Option (⌥)`** to **Copy** instead of **Move**.
  - **Spring-Loaded Folders:** Hover dragged files over a folder for ~750ms to automatically open it and keep drilling down.
- **Direct `.zip` Archive Browsing:** Double-click or press `Enter` on `.zip` files to browse inside like a normal folder (`/path/archive.zip::inner/path`) without extracting first. Preview files with QuickLook (`Space`), open with default apps, drag files directly out of `.zip` archives, copy/paste out, or click **Extract All...**.
- **LAN Network Drives (`⌘K`):** Auto-detect mounted `SMB`, `AFP`, `NFS`, `WebDAV` drives, discover LAN servers via macOS Bonjour (`dns-sd`), browse SMB shares (`smbutil view`), paste Windows UNC paths (`\\192.168.1.x\Share`) directly into the Address Bar, and eject cleanly from the Sidebar.
- **Menu Bar Quick Cabinet:** Floating macOS tray popover with an Unsorted **Inbox**, Pinned folders, Quick Note creation, and drag-and-drop classification.
- **macOS Native Integrations:** Instant **QuickLook** (`Space`), **Spotlight Search** (`Enter` in search bar), **Show in MXplore** (live `~/Downloads` watcher, macOS Quick Action Service, `NSFileViewer` browser redirect, and `mxplore://reveal?path=...` URL scheme), **Reveal in Finder**, **Open in Terminal**, and automatic Cloud Drive detection (`iCloud Drive`, `Google Drive`, `OneDrive`, `Dropbox`, etc.).

---

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘T` | Open new tab (Home) |
| `⌘W` | Close active tab |
| `⌘\` | Toggle Dual Pane (Split View) |
| `⌘K` | Connect Network Drive (LAN) |
| `⌘[` / `⌘]` | Back / Forward (Active Pane) |
| `⌘↑` | Go up one folder level |
| `⌘R` / `F5` | Refresh active pane |
| `⌘⇧N` | Create new folder |
| `F2` | Inline rename selected item |
| `Space` | macOS QuickLook preview (including files inside `.zip`) |
| `Enter` | Open selected file, folder, or `.zip` archive |
| `⌘C` / `⌘X` / `⌘V` | Copy / Cut / Paste (or Extract from `.zip`) |
| `⌘⌫` | Move selected items to macOS Trash |
| `⌘Z` / `⇧⌘Z` | Undo / Redo last file operation |
| `⌘A` | Select all items in active pane |
| `Esc` | Close menu / Clear selection / Exit Spotlight search |
| Hold `Option (⌥)` while dragging | Copy instead of Move |
| Middle-click folder / `.zip` | Open in new tab |

---

## Tech Stack

- **Desktop Runtime & Backend:** [Tauri v2](https://v2.tauri.app/) + Rust (`zip`, `trash`, `open`, `chrono`, `dirs`, `objc2` / `objc2-app-kit`)
- **Frontend:** React 19, TypeScript 5.8, Vite 6, Tailwind CSS v4
- **State & Virtualization:** Zustand 5, `@tanstack/react-virtual`, `lucide-react`

---

## Project Structure

```text
MacXplore/
├── src/
│   ├── App.tsx                       # Main layout, Dual Pane splitter, native Drag & Drop controller
│   ├── components/
│   │   ├── AddressBar.tsx            # Breadcrumb & editable path bar (supports UNC & ZIP virtual paths)
│   │   ├── CommandBar.tsx            # File actions, LAN connect, Split View, Windows 11 View dropdown
│   │   ├── ContextMenu.tsx           # Right-click menu with Copy To / Move To hover submenus
│   │   ├── DestinationModal.tsx      # Copy To / Move To folder tree picker
│   │   ├── FileIcon.tsx              # File icons (incl. MS 365 PPTX) & cached image thumbnails
│   │   ├── FilePane.tsx              # Virtualized Details / List / Medium / Large Icons file view
│   │   ├── FolderHoverPopup.tsx      # Recursive folder size tooltip on hover
│   │   ├── NavigationBar.tsx         # Back/Forward/Up/Refresh, Address Bar & Spotlight search
│   │   ├── NetworkDriveModal.tsx     # LAN server discovery, SMB share browser & mount manager
│   │   ├── QuickCabinet.tsx          # macOS Menu Bar floating Inbox & quick-access cabinet
│   │   ├── Sidebar.tsx               # Quick Access, Pinned Cabinet, Cloud, Network (LAN), This Mac
│   │   ├── StatusBar.tsx             # Active pane/LAN/ZIP indicators, selection stats, quick view bar
│   │   ├── SystemIntegrationModal.tsx # 1-click macOS Quick Action, NSFileViewer & Downloads watcher settings
│   │   ├── TabBar.tsx                # Draggable overlay titlebar & browser-style tabs
│   │   └── TreeNode.tsx              # Expandable lazy-loaded folder tree item
│   ├── hooks/
│   │   └── useExplorerShortcuts.ts   # Global keyboard shortcut manager
│   ├── lib/
│   │   ├── cabinetStorage.ts         # Persistent Quick Cabinet pins & custom Inbox path
│   │   ├── format.ts                 # Path normalization, ZIP virtual paths, sorting & formatting
│   │   └── tauriApi.ts               # Typed IPC wrappers for Rust commands
│   └── store/
│       └── useExplorerStore.ts       # Central Zustand store (tabs, dual pane, LAN, ZIP, undo/redo)
└── src-tauri/
    ├── Cargo.toml
    ├── Info.plist                    # macOS CFBundleDocumentTypes & mxplore:// URL scheme
    ├── tauri.conf.json
    ├── capabilities/default.json
    └── src/
        ├── main.rs
        ├── lib.rs                    # App setup, tray icon, Quick Cabinet, RunEvent::Opened, commands
        ├── fs_commands.rs            # Filesystem, LAN mounts, SMB/Bonjour, ZIP browsing, thumbnails
        ├── macos_integration.rs      # NSFileViewer, Quick Action Service, Downloads watcher & reveal
        └── native_drag.rs            # Native macOS AppKit NSDraggingSession & live cursor bridge
```

---

## Development & Building (macOS)

### Prerequisites
- macOS (Apple Silicon or Intel)
- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (stable toolchain) & Xcode Command Line Tools (`xcode-select --install`)

### Run in Development Mode
```bash
npm install
npm run tauri dev
```

### Run Tests & Typecheck
```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

### Build macOS `.app` and `.dmg`
```bash
npm run tauri build
```
Built bundles are output to:
- `src-tauri/target/release/bundle/macos/MXplore.app`
- `src-tauri/target/release/bundle/dmg/MXplore_0.1.1_aarch64.dmg`

---

## License

MIT License — see [LICENSE](LICENSE) for details.
