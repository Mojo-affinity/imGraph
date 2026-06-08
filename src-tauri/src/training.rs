use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;

static IS_TRAINING: AtomicBool = AtomicBool::new(false);

pub fn is_training() -> bool {
    IS_TRAINING.load(Ordering::Relaxed)
}

// Python 学習スクリプトをバックグラウンドプロセスで起動する。
// stdout / stderr を行ごとに "training-log" イベントとしてフロントに送信し、
// 終了時に "training-complete" (bool) を送信する。
pub fn start(
    app: tauri::AppHandle,
    script_path: String,
    dataset_path: String,
    extra_args: Vec<String>,
) -> Result<(), String> {
    // 多重起動を防止
    if IS_TRAINING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("すでに学習が実行中です".to_string());
    }

    app.emit("training-log", "▶ 学習プロセスを起動中…").ok();

    let mut child = Command::new("python3")
        .arg(&script_path)
        .arg("--data")
        .arg(&dataset_path)
        .args(&extra_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            IS_TRAINING.store(false, Ordering::SeqCst);
            format!("起動失敗: {}", e)
        })?;

    let stdout = child.stdout.take().expect("stdout pipe");
    let stderr = child.stderr.take().expect("stderr pipe");

    // stdout を別スレッドでストリーミング
    let app_out = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().flatten() {
            app_out.emit("training-log", &line).ok();
        }
    });

    // stderr を別スレッドでストリーミング（プレフィックスで区別）
    let app_err = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().flatten() {
            app_err.emit("training-log", format!("[ERR] {}", line)).ok();
        }
    });

    // プロセス終了を監視するスレッド
    std::thread::spawn(move || {
        let success = child.wait().map(|s| s.success()).unwrap_or(false);
        IS_TRAINING.store(false, Ordering::SeqCst);
        let summary = if success {
            "✓ 学習が正常に完了しました".to_string()
        } else {
            "✗ 学習が終了しました（エラーあり）".to_string()
        };
        app.emit("training-log", summary).ok();
        app.emit("training-complete", success).ok();
    });

    Ok(())
}
