//! Tauri 命令 - 暴露给前端调用
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager};

use crate::api::auth;
use crate::flow::{local, cloud, migrate};


/// 账号配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountConfig {
    #[serde(default)]
    pub id: Option<String>,
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
    #[serde(default = "default_migrate_suffix")]
    pub migrate_suffix: String,
}

fn default_migrate_suffix() -> String {
    "{name}_云迁_接收于{datetime}".to_string()
}

impl Default for SettingsConfig {
    fn default() -> Self {
        Self {
            language: "zh-CN".to_string(),
            theme: "system".to_string(),
            auto_update: true,
            migrate_suffix: default_migrate_suffix(),
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
            accounts: vec![],
            settings: SettingsConfig::default(),
        }
    }
}

fn get_config_path(app_handle: &tauri::AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_config_dir()
        .map(|p| p.join("migrate_config.json"))
        .unwrap_or_else(|e| {
            eprintln!("无法获取应用配置目录: {}", e);
            PathBuf::from("migrate_config.json")
        })
}

/// 登录账号
#[tauri::command]
pub async fn login_account(
    username: String,
    password: String,
) -> Result<String, String> {
    let token = auth::login(&username, &password).await?;
    Ok(token)
}

/// 获取本地流程列表（阻塞 IO 放到 blocking pool，避免阻塞主 runtime）
#[tauri::command]
pub async fn get_local_flows() -> Vec<local::LocalFlow> {
    tokio::task::spawn_blocking(local::scan_all_flows)
        .await
        .unwrap_or_default()
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
    #[serde(default = "default_migrate_suffix")]
    pub suffix_template: String,
    #[serde(default = "default_concurrency")]
    pub concurrency: usize,
}

fn default_concurrency() -> usize {
    3
}

/// 迁移结果
#[derive(Debug, Serialize)]
pub struct MigrateResult {
    pub success: bool,
    pub name: String,
    pub message: String,
}

/// 迁移进度事件 payload
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrateProgressPayload {
    pub current: usize,
    pub total: usize,
    pub name: String,
    pub success: bool,
    pub message: String,
}

/// 迁移流程（并行，最多 N 路并发，按完成顺序 emit 进度事件）
#[tauri::command]
pub async fn migrate_flows(app_handle: tauri::AppHandle, request: MigrateRequest) -> Vec<MigrateResult> {
    use futures_util::stream::{self, StreamExt};

    let flow_type = request.flow_type.clone();
    let target_token = request.target_token.clone();
    let source_token = request.source_token.clone();
    let suffix_template = request.suffix_template.clone();
    let total = request.flows.len();
    let concurrency = request.concurrency.clamp(1, 16);

    let completed = Arc::new(AtomicUsize::new(0));

    let results: Vec<MigrateResult> = stream::iter(request.flows.into_iter())
        .map(|flow_data| {
            let flow_type = flow_type.clone();
            let target_token = target_token.clone();
            let source_token = source_token.clone();
            let suffix_template = suffix_template.clone();
            let app_handle = app_handle.clone();
            let completed = completed.clone();
            async move {
                let result = if flow_type == "local" {
                    match serde_json::from_value::<local::LocalFlow>(flow_data) {
                        Ok(flow) => {
                            let name = flow.name.clone();
                            match migrate::migrate_local_flow(&flow, &target_token, &suffix_template).await {
                                Ok(new_name) => MigrateResult {
                                    success: true,
                                    name,
                                    message: format!("已迁移为: {}", new_name),
                                },
                                Err(e) => MigrateResult { success: false, name, message: e },
                            }
                        }
                        Err(e) => MigrateResult {
                            success: false,
                            name: "未知".to_string(),
                            message: format!("解析流程数据失败: {}", e),
                        },
                    }
                } else {
                    let source_token = source_token.as_deref().unwrap_or("");
                    match serde_json::from_value::<cloud::CloudFlow>(flow_data) {
                        Ok(flow) => {
                            let name = flow.app_name.clone();
                            match migrate::migrate_cloud_flow(&flow, source_token, &target_token, &suffix_template).await {
                                Ok(new_name) => MigrateResult {
                                    success: true,
                                    name,
                                    message: format!("已迁移为: {}", new_name),
                                },
                                Err(e) => MigrateResult { success: false, name, message: e },
                            }
                        }
                        Err(e) => MigrateResult {
                            success: false,
                            name: "未知".to_string(),
                            message: format!("解析流程数据失败: {}", e),
                        },
                    }
                };

                let current = completed.fetch_add(1, Ordering::SeqCst) + 1;
                let _ = app_handle.emit("migrate-progress", MigrateProgressPayload {
                    current,
                    total,
                    name: result.name.clone(),
                    success: result.success,
                    message: result.message.clone(),
                });
                result
            }
        })
        .buffered(concurrency)
        .collect()
        .await;

    results
}

/// 删除本地流程请求
#[derive(Debug, Deserialize)]
pub struct DeleteRequest {
    pub flows: Vec<local::LocalFlow>,
}

/// 删除本地流程（文件 IO 放到 blocking pool）
#[tauri::command]
pub async fn delete_local_flows(request: DeleteRequest) -> Vec<MigrateResult> {
    tokio::task::spawn_blocking(move || {
        request
            .flows
            .iter()
            .map(|flow| {
                let name = flow.name.clone();
                match local::delete_flow(flow) {
                    Ok(_) => MigrateResult { success: true, name, message: "删除成功".to_string() },
                    Err(e) => MigrateResult { success: false, name, message: e },
                }
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// 保存配置
#[tauri::command]
pub fn save_config(app_handle: tauri::AppHandle, config: Config) -> Result<(), String> {
    let path = get_config_path(&app_handle);
    
    // 确保父目录存在
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建配置目录失败: {}", e))?;
    }

    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("序列化配置失败: {}", e))?;
    fs::write(&path, content)
        .map_err(|e| format!("保存配置失败: {}", e))?;
    Ok(())
}

/// 加载配置
#[tauri::command]
pub fn load_config(app_handle: tauri::AppHandle) -> Config {
    let path = get_config_path(&app_handle);
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
