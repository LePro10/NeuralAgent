// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|a| a == "--service") {
        std::process::exit(neuralagent_desktop::run_service(&args[1..]));
    }
    neuralagent_desktop::run()
}
