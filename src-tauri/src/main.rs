#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // On NVIDIA + Wayland, WebKitGTK's DMA-BUF renderer dies with a Wayland
    // protocol error (Error 71) because of explicit sync. Disabling explicit
    // sync keeps the GPU path; WEBKIT_DISABLE_DMABUF_RENDERER also avoids the
    // crash but copies every frame through the CPU and makes the UI sluggish.
    #[cfg(target_os = "linux")]
    if std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none()
        && std::path::Path::new("/proc/driver/nvidia").exists()
    {
        std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
    }

    stream_vault_lib::run()
}
