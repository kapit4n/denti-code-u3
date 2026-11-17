use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::error::Error;
use std::fs::{self, OpenOptions};
use std::net::TcpStream;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Manager, WindowEvent};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Deserialize)]
struct EmbeddedServerConfig {
    password: String,
    env: HashMap<String, String>,
}

#[derive(Debug, Serialize)]
struct InjectedCredentials {
    email: &'static str,
    password: String,
}

struct LocalServer(Arc<Mutex<Option<Child>>>);

impl LocalServer {
    fn stop(&self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let server = start_embedded_server(&handle)?;
            app.manage(LocalServer(server));
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Destroyed) {
                if let Some(server) = window.app_handle().try_state::<LocalServer>() {
                    server.stop();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn start_embedded_server(app: &tauri::AppHandle) -> Result<Arc<Mutex<Option<Child>>>, Box<dyn Error>> {
    let resources = app.path().resource_dir()?;
    let bundle = resources.join("denti-code-server");
    let config: EmbeddedServerConfig =
        serde_json::from_slice(&fs::read(bundle.join("desktop-server.json"))?)?;

    let data_dir = app.path().app_data_dir()?.join("server");
    fs::create_dir_all(&data_dir)?;
    let database = data_dir.join("denti-code-u3.db");
    if !database.exists() {
        fs::copy(bundle.join("data/denti-code-u3.db"), &database)?;
    }

    let host = "127.0.0.1";
    let port = config
        .env
        .get("API_PORT")
        .cloned()
        .unwrap_or_else(|| "3010".to_string());
    let port_number: u16 = port.parse()?;
    if TcpStream::connect((host, port_number)).is_ok() {
        return Err(startup_error(
            app,
            format!("Denti-Code U3 needs port {port} for its local API, but that port is already in use."),
        ));
    }

    let node = bundle.join(if cfg!(windows) { "runtime/node.exe" } else { "runtime/node" });
    if !node.exists() {
        return Err(startup_error(
            app,
            format!("The embedded Node runtime is missing at {}", node.display()),
        ));
    }

    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(data_dir.join("server.log"))?;
    let error_log = log.try_clone()?;

    let mut command = Command::new(node);
    command
        .arg("dist/main.js")
        .current_dir(bundle.join("server"))
        .envs(&config.env)
        .env("NODE_ENV", "production")
        .env("DATABASE_URL", sqlite_url(&database))
        .env("API_HOST", host)
        .env("API_PORT", &port)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(error_log));
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let child = command.spawn()?;
    let process = Arc::new(Mutex::new(Some(child)));

    let mut ready = false;
    for _ in 0..100 {
        if TcpStream::connect((host, port_number)).is_ok() {
            ready = true;
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    if !ready {
        stop_process(&process);
        return Err(startup_error(
            app,
            format!("The embedded API did not start. See {}", data_dir.join("server.log").display()),
        ));
    }

    let credentials = InjectedCredentials {
        email: "admin@denti-code.test",
        password: config.password,
    };
    let script = format!(
        "window.__DENTI_CODE_LOCAL_CREDENTIALS__ = {};",
        serde_json::to_string(&credentials)?
    );
    if let Some(window) = app.get_webview_window("main") {
        window.eval(&script)?;
    }

    Ok(process)
}

fn stop_process(process: &Arc<Mutex<Option<Child>>>) {
    if let Ok(mut guard) = process.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn sqlite_url(path: &Path) -> String {
    format!("sqlite:{}", path.to_string_lossy().replace('\\', "/"))
}

fn startup_error(app: &tauri::AppHandle, message: String) -> Box<dyn Error> {
    if let Ok(data_dir) = app.path().app_data_dir() {
        let directory = data_dir.join("server");
        if fs::create_dir_all(&directory).is_ok() {
            let _ = fs::write(directory.join("startup-error.txt"), format!("{message}\n"));
        }
    }
    message.into()
}
