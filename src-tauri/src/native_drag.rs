use serde::Serialize;
use tauri::{AppHandle, WebviewWindow};

#[cfg(not(target_os = "macos"))]
use tauri::Emitter;

#[derive(Debug, Clone, Serialize)]
pub struct NativeDragEndedPayload {
    pub paths: Vec<String>,
    pub operation: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DragPointerState {
    pub x: f64,
    pub y: f64,
    pub inside: bool,
    pub option_down: bool,
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceFlagsState(state_id: i32) -> u64;
}

/// Returns true if the macOS Option (Alt) modifier key is currently held down.
#[cfg(target_os = "macos")]
pub fn is_option_key_down() -> bool {
    // kCGEventSourceStateCombinedSessionState = 0, kCGEventFlagMaskAlternate = 0x00080000
    unsafe { (CGEventSourceFlagsState(0) & 0x0008_0000) != 0 }
}

#[cfg(not(target_os = "macos"))]
pub fn is_option_key_down() -> bool {
    false
}

#[cfg(target_os = "macos")]
mod macos_impl {
    use super::{is_option_key_down, DragPointerState, NativeDragEndedPayload};
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, ProtocolObject};
    use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{
        NSApplication, NSDragOperation, NSDraggingContext, NSDraggingFormation, NSDraggingItem,
        NSDraggingSession, NSDraggingSource, NSEvent, NSEventType, NSPasteboardWriting, NSView,
        NSWorkspace,
    };
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::{NSArray, NSObject, NSObjectProtocol, NSPoint, NSString, NSURL};
    use std::cell::RefCell;
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::{AppHandle, Emitter, WebviewWindow};

    struct DragSourceIvars {
        app_handle: AppHandle,
        paths: Vec<String>,
        copy_only: bool,
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "MXploreDraggingSource"]
        #[ivars = DragSourceIvars]
        struct MXploreDraggingSource;

        unsafe impl NSObjectProtocol for MXploreDraggingSource {}

        unsafe impl NSDraggingSource for MXploreDraggingSource {
            #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
            fn dragging_session_source_operation_mask(
                &self,
                _session: &NSDraggingSession,
                _context: NSDraggingContext,
            ) -> NSDragOperation {
                if self.ivars().copy_only {
                    NSDragOperation::Copy
                } else {
                    NSDragOperation::Copy
                        | NSDragOperation::Move
                        | NSDragOperation::Link
                        | NSDragOperation::Generic
                }
            }

            #[unsafe(method(draggingSession:endedAtPoint:operation:))]
            fn dragging_session_ended(
                &self,
                _session: &NSDraggingSession,
                _screen_point: NSPoint,
                operation: NSDragOperation,
            ) {
                let op_label = if operation == NSDragOperation::None {
                    "none"
                } else if operation.contains(NSDragOperation::Move) {
                    "move"
                } else if operation.contains(NSDragOperation::Copy) {
                    "copy"
                } else if operation.contains(NSDragOperation::Link) {
                    "link"
                } else {
                    "generic"
                };

                let payload = NativeDragEndedPayload {
                    paths: self.ivars().paths.clone(),
                    operation: op_label.to_string(),
                };
                let _ = self.ivars().app_handle.emit("mxplore:native-drag-ended", payload);

                // Release retained dragging source now that macOS finished the drag session
                ACTIVE_DRAG_SOURCE.with(|slot| {
                    *slot.borrow_mut() = None;
                });
            }
        }
    );

    impl MXploreDraggingSource {
        fn new(
            mtm: MainThreadMarker,
            app_handle: AppHandle,
            paths: Vec<String>,
            copy_only: bool,
        ) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(DragSourceIvars {
                app_handle,
                paths,
                copy_only,
            });
            unsafe { msg_send![super(this), init] }
        }
    }

    thread_local! {
        static ACTIVE_DRAG_SOURCE: RefCell<Option<Retained<MXploreDraggingSource>>> =
            const { RefCell::new(None) };
    }

    /// Reads the exact live cursor position in CSS logical pixels (top-left origin)
    /// directly from the macOS WKWebView/NSWindow, immune to Retina scale or Y-flip quirks.
    pub fn get_drag_pointer_state(window: WebviewWindow) -> Option<DragPointerState> {
        let (tx, rx) = mpsc::sync_channel::<Option<DragPointerState>>(1);
        let option_down = is_option_key_down();

        let dispatch_res = window.with_webview(move |platform_webview| {
            let ns_view_ptr = platform_webview.inner().cast::<NSView>();
            let result = (unsafe { ns_view_ptr.as_ref() }).and_then(|view| {
                let ns_window = view.window()?;
                let mouse_in_win = ns_window.mouseLocationOutsideOfEventStream();
                let pt = view.convertPoint_fromView(mouse_in_win, None);
                let bounds = view.bounds();

                let css_x = pt.x - bounds.origin.x;
                let css_y = if view.isFlipped() {
                    pt.y - bounds.origin.y
                } else {
                    bounds.size.height - (pt.y - bounds.origin.y)
                };

                let inside = css_x >= 0.0
                    && css_y >= 0.0
                    && css_x <= bounds.size.width
                    && css_y <= bounds.size.height;

                Some(DragPointerState {
                    x: css_x,
                    y: css_y,
                    inside,
                    option_down,
                })
            });
            let _ = tx.send(result);
        });

        if dispatch_res.is_err() {
            return None;
        }

        rx.recv_timeout(Duration::from_millis(150)).ok().flatten()
    }

    pub fn begin_native_drag(
        window: WebviewWindow,
        app_handle: AppHandle,
        paths: Vec<String>,
        copy_only: bool,
    ) -> Result<(), String> {
        if paths.is_empty() {
            return Err("No files provided to drag".to_string());
        }

        window
            .with_webview(move |platform_webview| {
                // with_webview always executes on the macOS main thread
                let mtm = unsafe { MainThreadMarker::new_unchecked() };
                let ns_view_ptr = platform_webview.inner().cast::<NSView>();
                let Some(view) = (unsafe { ns_view_ptr.as_ref() }) else {
                    return;
                };
                let Some(ns_window) = view.window() else {
                    return;
                };

                let app = NSApplication::sharedApplication(mtm);
                let current_ev = app.currentEvent();
                let timestamp = current_ev.as_ref().map(|ev| ev.timestamp()).unwrap_or(0.0);

                // Always anchor BOTH the drag event and the icon frame to the LIVE cursor position
                // in the window so the dragged icon stays pixel-locked under the pointer tip.
                let live_loc_in_window = ns_window.mouseLocationOutsideOfEventStream();
                let mod_flags = NSEvent::modifierFlags_class();
                let win_num = ns_window.windowNumber();

                let Some(drag_event) = NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
                    NSEventType::LeftMouseDragged,
                    live_loc_in_window,
                    mod_flags,
                    timestamp,
                    win_num,
                    None,
                    0,
                    1,
                    1.0,
                ) else {
                    return;
                };

                let loc_in_view = view.convertPoint_fromView(live_loc_in_window, None);
                let workspace = NSWorkspace::sharedWorkspace();

                let mut dragging_items: Vec<Retained<NSDraggingItem>> =
                    Vec::with_capacity(paths.len());

                for (idx, path_str) in paths.iter().enumerate() {
                    let ns_path = NSString::from_str(path_str);
                    let file_url = NSURL::fileURLWithPath(&ns_path);
                    let writer: &ProtocolObject<dyn NSPasteboardWriting> =
                        ProtocolObject::from_ref(&*file_url);

                    let item = NSDraggingItem::initWithPasteboardWriter(
                        mtm.alloc::<NSDraggingItem>(),
                        writer,
                    );

                    // Use real native macOS file icon from NSWorkspace (matches Finder!)
                    let icon = workspace.iconForFile(&ns_path);
                    let icon_size = 48.0_f64;
                    icon.setSize(CGSize::new(icon_size, icon_size));

                    // Slightly stagger the first few icons into a neat pile centered on cursor
                    let offset = (idx.min(4) as f64) * 3.0;
                    let frame = CGRect::new(
                        CGPoint::new(
                            loc_in_view.x - icon_size * 0.5 + offset,
                            loc_in_view.y - icon_size * 0.5 + offset,
                        ),
                        CGSize::new(icon_size, icon_size),
                    );

                    let contents_obj: &AnyObject = icon.as_ref();
                    unsafe {
                        item.setDraggingFrame_contents(frame, Some(contents_obj));
                    }
                    dragging_items.push(item);
                }

                if dragging_items.is_empty() {
                    return;
                }

                let items_array = NSArray::from_retained_slice(&dragging_items);
                let source = MXploreDraggingSource::new(mtm, app_handle, paths, copy_only);
                let source_proto: &ProtocolObject<dyn NSDraggingSource> =
                    ProtocolObject::from_ref(&*source);

                // Retain source until draggingSession:endedAtPoint:operation: fires
                ACTIVE_DRAG_SOURCE.with(|slot| {
                    *slot.borrow_mut() = Some(source.clone());
                });

                let session = view.beginDraggingSessionWithItems_event_source(
                    &items_array,
                    &drag_event,
                    source_proto,
                );
                session.setAnimatesToStartingPositionsOnCancelOrFail(true);
                session.setDraggingFormation(NSDraggingFormation::Pile);
            })
            .map_err(|e| format!("Failed to start native macOS drag: {}", e))
    }
}

#[cfg(target_os = "macos")]
pub fn get_drag_pointer_state(window: WebviewWindow) -> Option<DragPointerState> {
    macos_impl::get_drag_pointer_state(window)
}

#[cfg(not(target_os = "macos"))]
pub fn get_drag_pointer_state(_window: WebviewWindow) -> Option<DragPointerState> {
    None
}

#[cfg(target_os = "macos")]
pub fn begin_native_drag(
    window: WebviewWindow,
    app_handle: AppHandle,
    paths: Vec<String>,
    copy_only: bool,
) -> Result<(), String> {
    macos_impl::begin_native_drag(window, app_handle, paths, copy_only)
}

#[cfg(not(target_os = "macos"))]
pub fn begin_native_drag(
    _window: WebviewWindow,
    app_handle: AppHandle,
    paths: Vec<String>,
    _copy_only: bool,
) -> Result<(), String> {
    let _ = app_handle.emit(
        "mxplore:native-drag-ended",
        NativeDragEndedPayload {
            paths,
            operation: "none".to_string(),
        },
    );
    Err("Native file dragging is currently supported on macOS only".to_string())
}
