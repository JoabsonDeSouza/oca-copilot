// OCA Copilot - casca Tauri.
// Aba discreta na borda que expande no hover; sempre no canto; sobrepor liga/desliga.

use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewWindow,
};

struct Overlap(AtomicBool);

// Tamanhos dos dois estados (logicos).
const COLLAPSED: (f64, f64) = (20.0, 140.0);
const EXPANDED: (f64, f64) = (132.0, 372.0);
const TOP_Y: f64 = 74.0;

fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn node_bin() -> String {
    for p in ["/opt/homebrew/bin/node", "/usr/local/bin/node"] {
        if std::path::Path::new(p).exists() {
            return p.to_string();
        }
    }
    "node".to_string()
}

// Redimensiona e reancora no canto superior direito (borda direita fixa na tela).
// Coordenadas fisicas (comprovado que funciona no Retina).
fn apply_layout(window: &WebviewWindow, expanded: bool) {
    let (w, h) = if expanded { EXPANDED } else { COLLAPSED };
    match window.primary_monitor() {
        Ok(Some(mon)) => {
            let scale = mon.scale_factor();
            let msize = mon.size();
            let wp = (w * scale) as i32;
            let hp = (h * scale) as i32;
            let x = (msize.width as i32 - wp).max(0);
            let y = (TOP_Y * scale) as i32;
            let _ = window.set_size(tauri::PhysicalSize::new(wp as u32, hp as u32));
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        }
        other => eprintln!("[copilot] layout: sem monitor: {:?}", other),
    }
}

// Roda o coletor e devolve o JSON cru.
#[tauri::command]
fn get_usage() -> Result<String, String> {
    let script = project_root().join("src-collector/collector.mjs");
    let out = Command::new(node_bin())
        .arg(&script)
        .output()
        .map_err(|e| format!("falha ao rodar node: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

// Hover: expande / recolhe.
#[tauri::command]
fn set_expanded(window: WebviewWindow, expanded: bool) {
    apply_layout(&window, expanded);
}

// Botao sobrepor: fixa por cima de tudo (ou libera).
#[tauri::command]
fn set_overlap(window: WebviewWindow, overlap: tauri::State<Overlap>, on: bool) -> Result<(), String> {
    overlap.0.store(on, Ordering::Relaxed);
    window.set_always_on_top(on).map_err(|e| e.to_string())
}

// Botao minimizar: oculta (reabre pelo tray ou abrindo o app de novo).
#[tauri::command]
fn hide_window(window: WebviewWindow) {
    let _ = window.hide();
}

// Abre o Terminal.app rodando um comando.
fn open_terminal(command: &str) -> Result<(), String> {
    let escaped = command.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "tell application \"Terminal\"\n  activate\n  do script \"{}\"\nend tell",
        escaped
    );
    Command::new("osascript")
        .arg("-e")
        .arg(script)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Clique num anel: abre o terminal com a IA carregada. id "duo" = discussao.
#[tauri::command]
fn launch_agent(id: String) -> Result<(), String> {
    let root = project_root();
    let command = match id.as_str() {
        "claude" => "claude".to_string(),
        "codex" => "codex".to_string(),
        "gemini" => "gemini".to_string(),
        "duo" => format!("cd '{}' && node duo.mjs", root.display()),
        other => return Err(format!("agente desconhecido: {other}")),
    };
    open_terminal(&command)
}

// Botao ajustes: abre o config.json no editor de texto.
#[tauri::command]
fn open_config() -> Result<(), String> {
    let cfg = project_root().join("config.json");
    Command::new("open")
        .arg("-t")
        .arg(&cfg)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn show_widget(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        apply_layout(&win, true);
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn toggle(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            show_widget(app);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Overlap(AtomicBool::new(true)))
        .invoke_handler(tauri::generate_handler![
            get_usage,
            set_expanded,
            set_overlap,
            hide_window,
            open_config,
            launch_agent
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let toggle_item = MenuItem::with_id(app, "toggle", "Mostrar / Ocultar", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle_item, &quit_item])?;

            TrayIconBuilder::with_id("copilot-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .tooltip("OCA Copilot")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => app.exit(0),
                    "toggle" => toggle(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle(tray.app_handle());
                    }
                })
                .build(app)?;

            // So mostra; o layout e forcado pelo front via set_expanded.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_always_on_top(true);
                // Aparece em todos os Spaces, inclusive sobre apps em tela cheia.
                let _ = win.set_visible_on_all_workspaces(true);
                let _ = win.show();
                let _ = win.set_focus();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
