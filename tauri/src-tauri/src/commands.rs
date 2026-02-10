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

/// 配置文件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub accounts: Vec<AccountConfig>,
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

