mod fs_commands;
mod native_drag;

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, Position, RunEvent, Size, State,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

struct CabinetPinState(AtomicBool);

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
        .setup(|app| {
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
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_item =
                MenuItem::with_id(app, "quit", "Quit MXplore", true, None::<&str>)?;

            let tray_menu = Menu::with_items(
                app,
                &[
                    &toggle_item,
                    &open_main_item,
                    &open_inbox_item,
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
            notify_cabinet_sync,
            is_option_key_down,
            get_drag_pointer_state,
            start_native_drag,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = event {
            show_main_window(app_handle);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app_handle, event);
    });
}
