// OCA Copilot - casca Tauri.
// Aba discreta na borda que expande no hover; sempre no canto; sobrepor liga/desliga.

use std::fs;
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
const COLLAPSED_WIDTH: f64 = 36.0;
const EXPANDED: (f64, f64) = (132.0, 490.0);
const SETTINGS: (f64, f64) = (304.0, 430.0);
const TOP_Y: f64 = 74.0;

fn collapsed_size() -> (f64, f64) {
    let enabled = fs::read_to_string(project_root().join("config.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .map(|config| ["claude", "codex", "gemini", "opencode"].iter()
            .filter(|id| config.get(**id).and_then(|v| v.get("enabled")).and_then(|v| v.as_bool()) != Some(false))
            .count())
        .unwrap_or(4);
    (COLLAPSED_WIDTH, (32.0 + 14.0 * enabled as f64).max(46.0))
}

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
fn apply_size(window: &WebviewWindow, (w, h): (f64, f64)) {
    match window.primary_monitor() {
        Ok(Some(mon)) => {
            let scale = mon.scale_factor();
            let msize = mon.size();
            let wp = (w * scale) as i32;
            let hp = (h * scale) as i32;
            let saved_y = fs::read_to_string(project_root().join("config.json"))
                .ok()
                .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
                .and_then(|config| config.get("widgetPosition")?.get("y")?.as_i64());
            let x = (msize.width as i32 - wp).max(0);
            let y = saved_y.map(|v| v as i32).unwrap_or((TOP_Y * scale) as i32)
                .clamp(0, (msize.height as i32 - hp).max(0));
            let _ = window.set_size(tauri::PhysicalSize::new(wp as u32, hp as u32));
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        }
        other => eprintln!("[copilot] layout: sem monitor: {:?}", other),
    }
}

fn apply_layout(window: &WebviewWindow, expanded: bool) {
    apply_size(window, if expanded { EXPANDED } else { collapsed_size() });
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

#[tauri::command]
fn set_widget_vertical_position(window: WebviewWindow, y: f64) -> Result<(), String> {
    let monitor = window.primary_monitor().map_err(|e| e.to_string())?
        .ok_or_else(|| "monitor principal indisponível".to_string())?;
    let scale = monitor.scale_factor();
    let screen = monitor.size();
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let max_y = (screen.height as i32 - size.height as i32).max(0);
    let y = ((y * scale).round() as i32).clamp(0, max_y);
    let x = (screen.width as i32 - size.width as i32).max(0);
    window.set_position(tauri::PhysicalPosition::new(x, y)).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_window_position(window: WebviewWindow) -> Result<(), String> {
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let path = project_root().join("config.json");
    let mut config: serde_json::Value = if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).map_err(|e| format!("config.json inválido: {e}"))?
    } else { serde_json::json!({}) };
    let root = config.as_object_mut().ok_or_else(|| "config.json deve conter um objeto JSON".to_string())?;
    root.insert("widgetPosition".to_string(), serde_json::json!({"x": pos.x, "y": pos.y}));
    let serialized = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serialized).map_err(|e| e.to_string())?;
    fs::rename(&temp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

fn restore_window_position(window: &WebviewWindow) {
    let path = project_root().join("config.json");
    let Ok(raw) = fs::read_to_string(path) else { return };
    let Ok(config) = serde_json::from_str::<serde_json::Value>(&raw) else { return };
    let Some(pos) = config.get("widgetPosition") else { return };
    let Some(y) = pos.get("y").and_then(|v| v.as_i64()) else { return };
    if let Ok(Some(monitor)) = window.primary_monitor() {
        if let Ok(size) = window.outer_size() {
            let x = (monitor.size().width as i32 - size.width as i32).max(0);
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y as i32));
        }
    }
}

#[tauri::command]
fn set_settings(window: WebviewWindow, open: bool) {
    apply_size(&window, if open { SETTINGS } else { EXPANDED });
}

#[tauri::command]
fn set_open_mode(mode: String) -> Result<(), String> {
    if mode != "cli" && mode != "terminal" { return Err("modo de abertura inválido".to_string()); }
    let path = project_root().join("config.json");
    let mut config: serde_json::Value = if path.exists() {
        serde_json::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?)
            .map_err(|e| format!("config.json inválido: {e}"))?
    } else { serde_json::json!({}) };
    config.as_object_mut().ok_or_else(|| "config.json deve conter um objeto JSON".to_string())?
        .insert("openMode".to_string(), serde_json::Value::String(mode));
    let serialized = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serialized).map_err(|e| e.to_string())?;
    fs::rename(&temp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_provider_enabled(id: String, enabled: bool) -> Result<(), String> {
    if !["claude", "codex", "gemini", "opencode"].contains(&id.as_str()) {
        return Err("provedor desconhecido".to_string());
    }
    let path = project_root().join("config.json");
    let mut config: serde_json::Value = if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).map_err(|e| format!("config.json inválido: {e}"))?
    } else {
        serde_json::json!({})
    };
    let root = config
        .as_object_mut()
        .ok_or_else(|| "config.json deve conter um objeto JSON".to_string())?;
    let provider = root.entry(id).or_insert_with(|| serde_json::json!({}));
    let settings = provider
        .as_object_mut()
        .ok_or_else(|| "configuração do provedor deve ser um objeto JSON".to_string())?;
    settings.insert("enabled".to_string(), serde_json::Value::Bool(enabled));

    let serialized = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serialized).map_err(|e| e.to_string())?;
    fs::rename(&temp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_provider_order(order: Vec<String>) -> Result<(), String> {
    let allowed = ["claude", "codex", "gemini", "opencode"];
    if order.len() != allowed.len() || order.iter().any(|id| !allowed.contains(&id.as_str())) {
        return Err("ordem de provedores inválida".to_string());
    }
    let path = project_root().join("config.json");
    let mut config: serde_json::Value = if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).map_err(|e| format!("config.json inválido: {e}"))?
    } else { serde_json::json!({}) };
    let root = config.as_object_mut().ok_or_else(|| "config.json deve conter um objeto JSON".to_string())?;
    root.insert("providerOrder".to_string(), serde_json::json!(order));
    let serialized = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serialized).map_err(|e| e.to_string())?;
    fs::rename(&temp, &path).map_err(|e| e.to_string())?;
    Ok(())
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

// Clique num anel: abre o CLI escolhido, ou uma janela de terminal como fallback.
#[tauri::command]
fn launch_agent(id: String) -> Result<(), String> {
    let cli = match id.as_str() {
        "claude" => "claude".to_string(),
        "codex" => "codex".to_string(),
        "gemini" => "gemini".to_string(),
        "opencode" => "opencode".to_string(),
        other => return Err(format!("agente desconhecido: {other}")),
    };
    let mode = fs::read_to_string(project_root().join("config.json"))
        .ok().and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|config| config.get("openMode").and_then(|v| v.as_str()).map(str::to_string))
        .unwrap_or_else(|| "cli".to_string());
    let installed = mode == "cli" && Command::new("/bin/zsh")
        .args(["-lc", &format!("command -v {cli} >/dev/null 2>&1")])
        .status().is_ok_and(|status| status.success());
    open_terminal(if installed { &cli } else { "" })
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
            set_widget_vertical_position,
            save_window_position,
            set_settings,
            set_open_mode,
            set_provider_enabled,
            set_provider_order,
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
                restore_window_position(&win);
                let _ = win.show();
                let _ = win.set_focus();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
