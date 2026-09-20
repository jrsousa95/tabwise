// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

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
            let sidecar_command = app.shell().sidecar("passa-a-regua-sidecar")?;
            let (mut rx, _child) = sidecar_command.spawn().expect("falha ao iniciar o sidecar");

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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
