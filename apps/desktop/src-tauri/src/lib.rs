// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::sync::Mutex;

use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::ShellExt;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Processo do sidecar, guardado pra ser encerrado junto com o app — sem
/// isso ele sobrevive ao fechamento da janela, fica órfão segurando a porta
/// 4550 e a próxima abertura do app sobe um sidecar que não consegue escutar.
struct SidecarProcess(Mutex<Option<CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Spike 1 (M0): o Tauri sobe o sidecar Node (empacotado como
            // binário standalone via SEA) no início da aplicação. O
            // frontend fala com ele via HTTP local (127.0.0.1:4550),
            // não via IPC do Tauri — o sidecar só precisa estar rodando.
            let mut sidecar_command = app.shell().sidecar("tabwise-sidecar")?;

            // Build de release (app instalado): o cwd do processo não é
            // gravável (`/` no macOS, Program Files no Windows), então o
            // SQLite vai pro diretório de dados do app no SO. Em `tauri dev`
            // mantém o fallback do sidecar (`.dev-data/` no cwd).
            if !cfg!(debug_assertions) {
                let data_dir = app.path().app_data_dir()?;
                std::fs::create_dir_all(&data_dir)?;
                sidecar_command = sidecar_command.env("TABWISE_DATA_DIR", data_dir);
            }

            let (mut rx, child) = sidecar_command.spawn().expect("falha ao iniciar o sidecar");
            app.manage(SidecarProcess(Mutex::new(Some(child))));

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            println!("[sidecar stdout] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[sidecar stderr] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Error(err) => {
                            eprintln!("[sidecar error] {}", err);
                        }
                        CommandEvent::Terminated(payload) => {
                            println!("[sidecar terminated] {:?}", payload);
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(sidecar) = app.try_state::<SidecarProcess>() {
                    if let Some(child) = sidecar.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}
