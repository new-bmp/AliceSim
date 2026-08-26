use tauri::Manager;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod desktop {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpListener, TcpStream};
    use std::path::{Path, PathBuf};
    use std::process::{Child, Command, Stdio};
    use std::sync::Mutex;
    use std::time::Duration;
    use tauri::{AppHandle, Manager, WebviewWindow};
    use tauri_plugin_shell::process::CommandChild;
    use tauri_plugin_shell::ShellExt;

    enum BackendChild {
        Development(Child),
        Packaged(CommandChild),
    }

    pub struct BackendProcess(Mutex<Option<BackendChild>>);

    impl Drop for BackendProcess {
        fn drop(&mut self) {
            let Ok(slot) = self.0.get_mut() else { return };
            let Some(child) = slot.take() else { return };
            match child {
                BackendChild::Development(mut process) => { let _ = process.kill(); }
                BackendChild::Packaged(process) => { let _ = process.kill(); }
            }
        }
    }

    fn reserve_port() -> Result<u16, String> {
        TcpListener::bind(("127.0.0.1", 0))
            .and_then(|listener| listener.local_addr())
            .map(|address| address.port())
            .map_err(|error| format!("Could not reserve a local backend port: {error}"))
    }

    fn python_executable(project_root: &Path) -> PathBuf {
        if let Some(configured) = std::env::var_os("ALICESIM_PYTHON") {
            return PathBuf::from(configured);
        }
        let local = if cfg!(windows) {
            project_root.join(".venv").join("Scripts").join("python.exe")
        } else {
            project_root.join(".venv").join("bin").join("python")
        };
        if local.is_file() { local } else { PathBuf::from(if cfg!(windows) { "python" } else { "python3" }) }
    }

    #[cfg(debug_assertions)]
    fn spawn_backend(app: &AppHandle, port: u16) -> Result<BackendProcess, String> {
        let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or_else(|| "Could not locate the AliceSIM project root".to_string())?
            .to_path_buf();
        let process = Command::new(python_executable(&project_root))
            .current_dir(&project_root)
            .args([
                "server.py", "--host", "127.0.0.1", "--port", &port.to_string(),
                "--port-span", "0", "--no-browser", "--windowed-browser",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("Could not start server.py: {error}"))?;
        let _ = app;
        Ok(BackendProcess(Mutex::new(Some(BackendChild::Development(process)))))
    }

    #[cfg(not(debug_assertions))]
    fn spawn_backend(app: &AppHandle, port: u16) -> Result<BackendProcess, String> {
        let command = app
            .shell()
            .sidecar("alicesim-backend")
            .map_err(|error| format!("Could not resolve the packaged backend: {error}"))?
            .args([
                "--host", "127.0.0.1", "--port", &port.to_string(),
                "--port-span", "0", "--no-browser", "--windowed-browser",
            ]);
        let (mut events, process) = command.spawn().map_err(|error| format!("Could not start the packaged backend: {error}"))?;
        tauri::async_runtime::spawn(async move {
            while events.recv().await.is_some() {}
        });
        Ok(BackendProcess(Mutex::new(Some(BackendChild::Packaged(process)))))
    }

    fn backend_ready(port: u16) -> bool {
        let address = SocketAddr::from(([127, 0, 0, 1], port));
        let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(250)) else { return false };
        let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
        if write!(stream, "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n").is_err() {
            return false;
        }
        let mut response = String::new();
        stream.read_to_string(&mut response).is_ok() && response.contains("\"service\": \"AliceSIM\"")
    }

    fn wait_and_navigate(window: WebviewWindow, port: u16) {
        tauri::async_runtime::spawn(async move {
            for _ in 0..160 {
                if backend_ready(port) {
                    let url = format!("http://127.0.0.1:{port}/?alice-host=tauri-desktop");
                    let _ = window.eval(&format!("window.location.replace('{url}')"));
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            let _ = window.eval("document.getElementById('desktopStatus').textContent='本地仿真服务启动失败，请查看应用日志。'");
        });
    }

    pub fn start(app: &tauri::App) -> Result<(), String> {
        let port = reserve_port()?;
        let process = spawn_backend(app.handle(), port)?;
        app.manage(process);
        let window = app.get_webview_window("main").ok_or_else(|| "Main window was not created".to_string())?;
        wait_and_navigate(window, port);
        Ok(())
    }
}

#[cfg_attr(any(target_os = "android", target_os = "ios"), tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_shell::init());
    }

    builder
        .setup(|app| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            desktop::start(app).map_err(|message| std::io::Error::new(std::io::ErrorKind::Other, message))?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AliceSIM");
}
