//! Tauri 命令 - 暴露给前端调用
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::api::auth;
use crate::flow::{local, cloud, migrate};


/// 账号配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountConfig {
    pub name: String,
    pub username: String,
    pub password: String,
}

/// 设置配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsConfig {
    pub language: String,
    pub theme: String, // "light", "dark", "system"
    pub auto_update: bool,
}

impl Default for SettingsConfig {
    fn default() -> Self {
        Self {
            language: "zh-CN".to_string(),
            theme: "system".to_string(),
            auto_update: true,
        }
    }
}

/// 配置文件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub accounts: Vec<AccountConfig>,
    #[serde(default)]
    pub settings: SettingsConfig,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            accounts: vec![
                AccountConfig {
                    name: "账号1".to_string(),
                    username: "".to_string(),
                    password: "".to_string(),
                },
                AccountConfig {
                    name: "账号2".to_string(),
                    username: "".to_string(),
                    password: "".to_string(),
                },
            ],
            settings: SettingsConfig::default(),
        }
    }
}

fn get_config_path() -> PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    exe_dir.join("migrate_config.json")
}

/// 登录账号
#[tauri::command]
pub async fn login_account(
    username: String,
    password: String,
    account_type: String,  // "source" 或 "target"
) -> Result<String, String> {
    let token = auth::login(&username, &password).await?;
    Ok(token)
}

/// 获取本地流程列表
#[tauri::command]
pub fn get_local_flows() -> Vec<local::LocalFlow> {
    local::scan_all_flows()
}

/// 获取云端流程列表
#[tauri::command]
pub async fn get_cloud_flows(token: String) -> Result<Vec<cloud::CloudFlow>, String> {
    cloud::get_cloud_flow_list(&token).await
}

/// 迁移流程请求
#[derive(Debug, Deserialize)]
pub struct MigrateRequest {
    pub flow_type: String,  // "local" 或 "cloud"
    pub flows: Vec<serde_json::Value>,
    pub target_token: String,
    pub source_token: Option<String>,
}

/// 迁移结果
#[derive(Debug, Serialize)]
pub struct MigrateResult {
    pub success: bool,
    pub name: String,
    pub message: String,
}

/// 迁移流程
#[tauri::command]
pub async fn migrate_flows(request: MigrateRequest) -> Vec<MigrateResult> {
    let mut results = Vec::new();
    
    for flow_data in &request.flows {
        let result = if request.flow_type == "local" {
            // 本地迁移
            match serde_json::from_value::<local::LocalFlow>(flow_data.clone()) {
                Ok(flow) => {
                    let name = flow.name.clone();
                    match migrate::migrate_local_flow(&flow, &request.target_token).await {
                        Ok(new_name) => MigrateResult {
                            success: true,
                            name,
                            message: format!("已迁移为: {}", new_name),
                        },
                        Err(e) => MigrateResult {
                            success: false,
                            name,
                            message: e,
                        },
                    }
                }
                Err(e) => MigrateResult {
                    success: false,
                    name: "未知".to_string(),
                    message: format!("解析流程数据失败: {}", e),
                },
            }
        } else {
            // 云端迁移
            let source_token = request.source_token.as_deref().unwrap_or("");
            match serde_json::from_value::<cloud::CloudFlow>(flow_data.clone()) {
                Ok(flow) => {
                    let name = flow.app_name.clone();
                    match migrate::migrate_cloud_flow(&flow, source_token, &request.target_token).await {
                        Ok(new_name) => MigrateResult {
                            success: true,
                            name,
                            message: format!("已迁移为: {}", new_name),
                        },
                        Err(e) => MigrateResult {
                            success: false,
                            name,
                            message: e,
                        },
                    }
                }
                Err(e) => MigrateResult {
                    success: false,
                    name: "未知".to_string(),
                    message: format!("解析流程数据失败: {}", e),
                },
            }
        };
        
        results.push(result);
    }
    
    results
}

/// 删除本地流程请求
#[derive(Debug, Deserialize)]
pub struct DeleteRequest {
    pub flows: Vec<local::LocalFlow>,
}

/// 删除本地流程
#[tauri::command]
pub fn delete_local_flows(request: DeleteRequest) -> Vec<MigrateResult> {
    let mut results = Vec::new();
    
    for flow in &request.flows {
        let name = flow.name.clone();
        match local::delete_flow(flow) {
            Ok(_) => results.push(MigrateResult {
                success: true,
                name,
                message: "删除成功".to_string(),
            }),
            Err(e) => results.push(MigrateResult {
                success: false,
                name,
                message: e,
            }),
        }
    }
    
    results
}

/// 保存配置
#[tauri::command]
pub fn save_config(config: Config) -> Result<(), String> {
    let path = get_config_path();
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("序列化配置失败: {}", e))?;
    fs::write(&path, content)
        .map_err(|e| format!("保存配置失败: {}", e))?;
    Ok(())
}

/// 加载配置
#[tauri::command]
pub fn load_config() -> Config {
    let path = get_config_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(config) = serde_json::from_str(&content) {
                return config;
            }
        }
    }
    Config::default()
}

/// 删除云端流程请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCloudRequest {
    pub token: String,
    pub app_ids: Vec<String>,
}

/// 删除云端流程（移入回收站）
#[tauri::command]
pub async fn delete_cloud_flows(request: DeleteCloudRequest) -> Vec<MigrateResult> {
    let mut results = Vec::new();
    
    for app_id in &request.app_ids {
        match cloud::delete_cloud_flow(&request.token, app_id).await {
            Ok(_) => results.push(MigrateResult {
                success: true,
                name: app_id.clone(),
                message: "已移入回收站".to_string(),
            }),
            Err(e) => results.push(MigrateResult {
                success: false,
                name: app_id.clone(),
                message: e,
            }),
        }
    }
    
    results
}

// ============================================================
// 自定义 GitHub 更新检查
// ============================================================

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

/// GitHub Release Asset
#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

/// 将版本字符串解析为可比较的元组 (major, minor, patch)
fn parse_version(version: &str) -> Option<(u64, u64, u64)> {
    let v = version.trim_start_matches('v');
    let parts: Vec<&str> = v.split('.').collect();
    if parts.len() >= 3 {
        let major = parts[0].parse().ok()?;
        let minor = parts[1].parse().ok()?;
        let patch = parts[2].parse().ok()?;
        Some((major, minor, patch))
    } else if parts.len() == 2 {
        let major = parts[0].parse().ok()?;
        let minor = parts[1].parse().ok()?;
        Some((major, minor, 0))
    } else {
        None
    }
}

/// 检查更新 - 通过 GitHub API 获取最新 Release
#[tauri::command]
pub async fn check_for_update() -> Result<UpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    let client = reqwest::Client::builder()
        .user_agent("yingdao-updater")
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

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

    // 比较版本
    let current = parse_version(&current_version);
    let latest = parse_version(&latest_version);

    let has_update = match (current, latest) {
        (Some(c), Some(l)) => l > c,
        _ => false,
    };

    // 查找 NSIS 安装包 (_x64-setup.exe)
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
    use tauri::Emitter;
    use tokio::io::AsyncWriteExt;

    // 获取桌面路径
    let desktop = dirs_next::desktop_dir()
        .ok_or_else(|| "无法获取桌面路径".to_string())?;

    // 从 URL 提取文件名
    let file_name = download_url
        .split('/')
        .last()
        .unwrap_or("yingdao_update_setup.exe")
        .to_string();

    let dest_path = desktop.join(&file_name);

    let client = reqwest::Client::builder()
        .user_agent("yingdao-updater")
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("下载失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("下载失败, HTTP 状态码: {}", response.status()));
    }

    // 获取文件总大小
    let total_size = response.content_length().unwrap_or(0);

    // 创建文件
    let mut file = tokio::fs::File::create(&dest_path)
        .await
        .map_err(|e| format!("创建文件失败: {}", e))?;

    // 流式下载
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;

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

        // 发送进度事件到前端
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
pub fn open_file_and_exit(file_path: String) -> Result<(), String> {
    // 使用系统默认方式打开文件（Windows: cmd /c start）
    std::process::Command::new("cmd")
        .args(["/c", "start", "", &file_path])
        .spawn()
        .map_err(|e| format!("打开文件失败: {}", e))?;

    // 短暂延迟确保进程启动
    std::thread::sleep(std::time::Duration::from_millis(500));

    // 退出应用
    std::process::exit(0);
}

