mod fs_commands;
mod macos_integration;
mod native_drag;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, Position, RunEvent, Size, State,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

struct CabinetPinState(AtomicBool);
struct FrontendReadyState(AtomicBool);
struct PendingRevealState(Mutex<Option<macos_integration::RevealTarget>>);

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceButtonState(state_id: i32, button: u32) -> bool;
}

#[cfg(target_os = "macos")]
fn is_left_mouse_button_down() -> bool {
    // kCGEventSourceStateCombinedSessionState = 0, kCGMouseButtonLeft = 0
    unsafe { CGEventSourceButtonState(0, 0) }
}

#[cfg(not(target_os = "macos"))]
fn is_left_mouse_button_down() -> bool {
    false
}

fn position_cabinet_near_tray(
    cabinet: &WebviewWindow,
    tray_pos: Position,
    tray_size: Size,
) {
    let scale = cabinet.scale_factor().unwrap_or(2.0);
    let win_size = cabinet
        .outer_size()
        .unwrap_or(tauri::PhysicalSize::new(
            (540.0 * scale) as u32,
            (540.0 * scale) as u32,
        ));

    let (icon_x, icon_y) = match tray_pos {
        Position::Physical(p) => (p.x, p.y),
        Position::Logical(p) => ((p.x * scale) as i32, (p.y * scale) as i32),
    };
    let (icon_w, icon_h) = match tray_size {
        Size::Physical(s) => (s.width as i32, s.height as i32),
        Size::Logical(s) => ((s.width * scale) as i32, (s.height * scale) as i32),
    };

    let mut x = icon_x + (icon_w / 2) - (win_size.width as i32 / 2);
    let y = icon_y + icon_h + (6.0 * scale) as i32;

    if let Ok(Some(monitor)) = cabinet.current_monitor() {
        let mon_pos = monitor.position();
        let mon_size = monitor.size();
        let margin = (8.0 * scale) as i32;
        let min_x = mon_pos.x + margin;
        let max_x = mon_pos.x + mon_size.width as i32 - win_size.width as i32 - margin;
        x = x.clamp(min_x, max_x.max(min_x));
    }

    let _ = cabinet.set_position(Position::Physical(PhysicalPosition::new(x, y)));
}

fn toggle_cabinet_window(
    app: &AppHandle,
    anchor: Option<(Position, Size)>,
) {
    let Some(cabinet) = app.get_webview_window("cabinet") else {
        return;
    };

    let is_visible = cabinet.is_visible().unwrap_or(false);
    if is_visible {
        let _ = cabinet.hide();
        return;
    }

    if let Some((pos, size)) = anchor {
        position_cabinet_near_tray(&cabinet, pos, size);
    }

    let _ = cabinet.show();
    let _ = cabinet.set_focus();
    let _ = cabinet.emit("mxplore:cabinet-shown", ());
}

fn show_main_window(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}

fn dispatch_reveal_to_main(
    app: &AppHandle,
    raw_path: &str,
    prefer_select_dir: bool,
) -> Result<macos_integration::RevealTarget, String> {
    let target = macos_integration::resolve_reveal_target(raw_path, prefer_select_dir)?;
    show_main_window(app);

    let ready = app
        .state::<FrontendReadyState>()
        .0
        .load(Ordering::Relaxed);

    if ready {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.emit("mxplore:reveal", &target);
        }
    } else if let Ok(mut pending) = app.state::<PendingRevealState>().0.lock() {
        *pending = Some(target.clone());
    }

    Ok(target)
}

#[tauri::command]
fn take_pending_reveal_path(
    ready_state: State<FrontendReadyState>,
    pending_state: State<PendingRevealState>,
) -> Option<macos_integration::RevealTarget> {
    ready_state.0.store(true, Ordering::Relaxed);
    pending_state
        .0
        .lock()
        .ok()
        .and_then(|mut guard| guard.take())
}

#[tauri::command]
fn reveal_path_in_main(
    app: AppHandle,
    path: String,
    prefer_select_dir: Option<bool>,
) -> Result<macos_integration::RevealTarget, String> {
    let target = dispatch_reveal_to_main(&app, &path, prefer_select_dir.unwrap_or(true))?;
    if let Some(cabinet) = app.get_webview_window("cabinet") {
        let pin_state = app.state::<CabinetPinState>();
        if !pin_state.0.load(Ordering::Relaxed) {
            let _ = cabinet.hide();
        }
    }
    Ok(target)
}

#[tauri::command]
fn set_cabinet_pinned(pinned: bool, state: State<CabinetPinState>) {
    state.0.store(pinned, Ordering::Relaxed);
}

#[tauri::command]
fn hide_cabinet(app: AppHandle) {
    if let Some(cabinet) = app.get_webview_window("cabinet") {
        let _ = cabinet.hide();
    }
}

#[tauri::command]
fn open_path_in_main(app: AppHandle, path: String) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
        let _ = main.emit("mxplore:navigate", path);
    }
    if let Some(cabinet) = app.get_webview_window("cabinet") {
        let pin_state = app.state::<CabinetPinState>();
        if !pin_state.0.load(Ordering::Relaxed) {
            let _ = cabinet.hide();
        }
    }
}

#[tauri::command]
fn notify_cabinet_sync(app: AppHandle) {
    let _ = app.emit("mxplore:sync-cabinet", ());
}

#[tauri::command]
fn is_option_key_down() -> bool {
    native_drag::is_option_key_down()
}

#[tauri::command]
async fn get_drag_pointer_state(
    window: WebviewWindow,
) -> Option<native_drag::DragPointerState> {
    tauri::async_runtime::spawn_blocking(move || native_drag::get_drag_pointer_state(window))
        .await
        .ok()
        .flatten()
}

#[tauri::command]
async fn start_native_drag(
    window: WebviewWindow,
    app: AppHandle,
    paths: Vec<String>,
) -> Result<(), String> {
    let (resolved_paths, copy_only) =
        tauri::async_runtime::spawn_blocking(move || fs_commands::resolve_paths_for_native_drag(paths))
            .await
            .map_err(|e| format!("Failed preparing files for drag: {}", e))??;

    native_drag::begin_native_drag(window, app, resolved_paths, copy_only)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // Keep Quick Cabinet pinned by default so users can freely click/drag files from Desktop into it.
        .manage(CabinetPinState(AtomicBool::new(true)))
        .manage(FrontendReadyState(AtomicBool::new(false)))
        .manage(PendingRevealState(Mutex::new(None)))
        .setup(|app| {
            // Check if launched with a file/folder path or mxplore:// URL argument
            for arg in std::env::args().skip(1) {
                if arg.starts_with('-') {
                    continue;
                }
                let parsed = if let Ok(url) = tauri::Url::parse(&arg) {
                    macos_integration::parse_incoming_url(&url)
                } else {
                    Some((arg, false))
                };
                if let Some((raw_path, prefer_select_dir)) = parsed {
                    if let Ok(target) =
                        macos_integration::resolve_reveal_target(&raw_path, prefer_select_dir)
                    {
                        if let Ok(mut pending) = app.state::<PendingRevealState>().0.lock() {
                            *pending = Some(target);
                        }
                        break;
                    }
                }
            }

            // Start lightweight ~/Downloads completion watcher ("Show in MXplore" + "Show in Finder")
            macos_integration::start_downloads_watcher(app.handle().clone());

            // Create hidden floating Quick Cabinet popover window anchored to macOS Menu Bar
            let cabinet = WebviewWindowBuilder::new(
                app,
                "cabinet",
                WebviewUrl::App("index.html?mode=cabinet".into()),
            )
            .title("MXplore Quick Cabinet")
            .inner_size(540.0, 540.0)
            .min_inner_size(440.0, 400.0)
            .resizable(true)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(true)
            .visible(false)
            .build()?;

            // When user enables Auto-hide (unpinned), still avoid hiding while dragging a file from Desktop/Finder
            let cabinet_handle = app.handle().clone();
            cabinet.on_window_event(move |event| match event {
                WindowEvent::Focused(false) => {
                    let handle = cabinet_handle.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(180));
                        let pin_state = handle.state::<CabinetPinState>();
                        if pin_state.0.load(Ordering::Relaxed) {
                            return;
                        }
                        // If the user is holding the mouse button (e.g. dragging a file from Desktop), keep Cabinet open!
                        if is_left_mouse_button_down() {
                            return;
                        }
                        if let Some(win) = handle.get_webview_window("cabinet") {
                            if !win.is_focused().unwrap_or(false) {
                                let _ = win.hide();
                            }
                        }
                    });
                }
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    if let Some(win) = cabinet_handle.get_webview_window("cabinet") {
                        let _ = win.hide();
                    }
                }
                _ => {}
            });

            // Keep app alive in macOS Menu Bar when closing main window (File Cabinet Pro behavior)
            if let Some(main_win) = app.get_webview_window("main") {
                let main_handle = app.handle().clone();
                main_win.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(win) = main_handle.get_webview_window("main") {
                            let _ = win.hide();
                        }
                    }
                });
            }

            // Build macOS Menu Bar Tray Icon + Right-click Menu
            let toggle_item = MenuItem::with_id(
                app,
                "toggle_cabinet",
                "Toggle Quick Cabinet",
                true,
                None::<&str>,
            )?;
            let open_main_item = MenuItem::with_id(
                app,
                "open_main",
                "Open MXplore Window",
                true,
                None::<&str>,
            )?;
            let open_inbox_item = MenuItem::with_id(
                app,
                "open_inbox",
                "Open Inbox (Unsorted Data)",
                true,
                None::<&str>,
            )?;
            let integration_item = MenuItem::with_id(
                app,
                "open_integration",
                "Show in MXplore (macOS Integration)...",
                true,
                None::<&str>,
            )?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_item =
                MenuItem::with_id(app, "quit", "Quit MXplore", true, None::<&str>)?;

            let tray_menu = Menu::with_items(
                app,
                &[
                    &toggle_item,
                    &open_main_item,
                    &open_inbox_item,
                    &integration_item,
                    &sep,
                    &quit_item,
                ],
            )?;

            let tray_icon_img = Image::new(include_bytes!("../icons/tray-icon.rgba"), 44, 44);

            TrayIconBuilder::with_id("mxplore-tray")
                .icon(tray_icon_img)
                .icon_as_template(true)
                .tooltip("MXplore — Quick Cabinet")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "toggle_cabinet" => {
                        toggle_cabinet_window(app, None);
                    }
                    "open_main" => {
                        show_main_window(app);
                    }
                    "open_inbox" => {
                        if let Ok(inbox) = fs_commands::get_or_create_inbox_dir(None) {
                            show_main_window(app);
                            if let Some(main) = app.get_webview_window("main") {
                                let _ = main.emit("mxplore:navigate", inbox);
                            }
                        }
                    }
                    "open_integration" => {
                        show_main_window(app);
                        if let Some(main) = app.get_webview_window("main") {
                            let _ = main.emit("mxplore:open-integration-modal", ());
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } = event
                    {
                        toggle_cabinet_window(
                            tray.app_handle(),
                            Some((rect.position, rect.size)),
                        );
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fs_commands::read_dir_entries,
            fs_commands::get_subfolders,
            fs_commands::get_special_paths,
            fs_commands::get_or_create_inbox_dir,
            fs_commands::create_quick_note,
            fs_commands::create_directory,
            fs_commands::create_empty_file,
            fs_commands::rename_item,
            fs_commands::delete_items,
            fs_commands::restore_paths,
            fs_commands::copy_items,
            fs_commands::move_items,
            fs_commands::open_item,
            fs_commands::quicklook_item,
            fs_commands::reveal_in_finder,
            fs_commands::open_in_terminal,
            fs_commands::spotlight_search,
            fs_commands::get_folder_stats,
            fs_commands::get_image_thumbnail,
            fs_commands::get_network_drives,
            fs_commands::connect_network_drive,
            fs_commands::disconnect_network_drive,
            fs_commands::list_smb_shares,
            fs_commands::discover_lan_servers,
            fs_commands::extract_zip_entry,
            fs_commands::extract_zip_all,
            fs_commands::open_zip_entry,
            fs_commands::quicklook_zip_entry,
            set_cabinet_pinned,
            hide_cabinet,
            open_path_in_main,
            reveal_path_in_main,
            take_pending_reveal_path,
            notify_cabinet_sync,
            is_option_key_down,
            get_drag_pointer_state,
            start_native_drag,
            macos_integration::get_macos_integration_status,
            macos_integration::set_default_file_viewer,
            macos_integration::install_show_in_mxplore_service,
            macos_integration::uninstall_show_in_mxplore_service,
            macos_integration::resolve_reveal_path,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        match event {
            RunEvent::Reopen { .. } => {
                show_main_window(app_handle);
            }
            RunEvent::Opened { urls } => {
                for url in urls {
                    if let Some((raw_path, prefer_select_dir)) =
                        macos_integration::parse_incoming_url(&url)
                    {
                        if dispatch_reveal_to_main(app_handle, &raw_path, prefer_select_dir)
                            .is_ok()
                        {
                            break;
                        }
                    }
                }
            }
            _ => {}
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app_handle, event);
    });
}
