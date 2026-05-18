//! 自定义 GitHub 更新检查 / 下载 / 启动安装。
//!
//! 该模块封装了三个 Tauri command：
//! - [`check_for_update`] 通过 GitHub Releases API 比较版本
//! - [`download_update`] 流式下载安装包并 emit 进度事件
//! - [`open_file_and_exit`] 启动安装包并退出当前应用
//!
//! 拆出该模块的目的是把 167 行更新逻辑从 `commands.rs` 解耦，
//! 未来若切换到 `tauri-plugin-updater` 可以原子替换整个模块。
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::io::AsyncWriteExt;

use crate::api::client::get_updater_client;

/// 更新检查结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub download_url: Option<String>,
}

/// GitHub Release API 响应
#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

/// 解析版本字符串为可比较的 (major, minor, patch) 元组
fn parse_version(version: &str) -> Option<(u64, u64, u64)> {
    let v = version.trim_start_matches('v');
    let parts: Vec<&str> = v.split('.').collect();
    match parts.len() {
        len if len >= 3 => Some((
            parts[0].parse().ok()?,
            parts[1].parse().ok()?,
            parts[2].parse().ok()?,
        )),
        2 => Some((parts[0].parse().ok()?, parts[1].parse().ok()?, 0)),
        _ => None,
    }
}

/// 检查更新 - 通过 GitHub API 获取最新 Release
#[tauri::command]
pub async fn check_for_update() -> Result<UpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let client = get_updater_client();

    let response = client
        .get("https://api.github.com/repos/ethan-010203/yingdao/releases/latest")
        .send()
        .await
        .map_err(|e| format!("请求 GitHub API 失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "GitHub API 返回错误 ({}), 可能没有已发布的 Release",
            response.status()
        ));
    }

    let release: GithubRelease = response
        .json()
        .await
        .map_err(|e| format!("解析 Release 信息失败: {}", e))?;

    let latest_version = release.tag_name.trim_start_matches('v').to_string();

    let has_update = match (parse_version(&current_version), parse_version(&latest_version)) {
        (Some(c), Some(l)) => l > c,
        _ => false,
    };

    let download_url = if has_update {
        release
            .assets
            .iter()
            .find(|a| a.name.ends_with("_x64-setup.exe"))
            .map(|a| a.browser_download_url.clone())
    } else {
        None
    };

    Ok(UpdateInfo {
        has_update,
        current_version,
        latest_version,
        download_url,
    })
}

/// 下载进度事件 payload
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percentage: u32,
}

/// 下载更新安装包到桌面（流式下载 + 进度事件）
#[tauri::command]
pub async fn download_update(
    app_handle: tauri::AppHandle,
    download_url: String,
) -> Result<String, String> {
    use futures_util::StreamExt;

    let desktop = dirs_next::desktop_dir()
        .ok_or_else(|| "无法获取桌面路径".to_string())?;

    let file_name = download_url
        .split('/')
        .last()
        .unwrap_or("yingdao_update_setup.exe")
        .to_string();

    let dest_path = desktop.join(&file_name);
    let client = get_updater_client();

    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("下载失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("下载失败, HTTP 状态码: {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);

    let mut file = tokio::fs::File::create(&dest_path)
        .await
        .map_err(|e| format!("创建文件失败: {}", e))?;

    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载数据块失败: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入文件失败: {}", e))?;

        downloaded += chunk.len() as u64;

        let percentage = if total_size > 0 {
            ((downloaded as f64 / total_size as f64) * 100.0) as u32
        } else {
            0
        };

        let _ = app_handle.emit("download-progress", DownloadProgress {
            downloaded,
            total: total_size,
            percentage: percentage.min(100),
        });
    }

    file.flush()
        .await
        .map_err(|e| format!("刷新文件失败: {}", e))?;

    Ok(dest_path.to_string_lossy().to_string())
}

/// 打开安装包并退出应用
#[tauri::command]
pub fn open_file_and_exit(app_handle: tauri::AppHandle, file_path: String) -> Result<(), String> {
    let path = std::path::Path::new(&file_path);

    // 校验路径必须在桌面目录下且为 .exe 文件，防止命令注入
    let desktop = dirs_next::desktop_dir()
        .ok_or_else(|| "无法获取桌面路径".to_string())?;
    if !path.starts_with(&desktop) || path.extension().and_then(|e| e.to_str()) != Some("exe") {
        return Err("无效的文件路径".to_string());
    }

    std::process::Command::new("cmd")
        .args(["/c", "start", "", &file_path])
        .spawn()
        .map_err(|e| format!("打开文件失败: {}", e))?;

    std::thread::sleep(std::time::Duration::from_millis(500));
    app_handle.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_version;

    #[test]
    fn three_parts() {
        assert_eq!(parse_version("1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("v1.2.3"), Some((1, 2, 3)));
    }

    #[test]
    fn two_parts_fills_patch_zero() {
        assert_eq!(parse_version("2.5"), Some((2, 5, 0)));
    }

    #[test]
    fn invalid_returns_none() {
        assert_eq!(parse_version("not-a-version"), None);
        assert_eq!(parse_version("1"), None);
        assert_eq!(parse_version("1.x.3"), None);
    }

    #[test]
    fn ordering_works() {
        let a = parse_version("1.6.0").unwrap();
        let b = parse_version("1.6.1").unwrap();
        assert!(b > a);
        let c = parse_version("2.0.0").unwrap();
        assert!(c > b);
    }
}
