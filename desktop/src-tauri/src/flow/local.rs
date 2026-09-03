//! 本地流程扫描模块
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use chrono::{DateTime, Local};

/// 本地流程信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalFlow {
    pub user_id: String,
    pub app_id: String,
    pub uuid: String,
    pub name: String,
    pub update_time: String,
    pub robot_path: String,
    pub package_data: serde_json::Value,
}

/// 获取影刀本地目录路径
fn get_shadowbot_base_path() -> Option<PathBuf> {
    std::env::var("LOCALAPPDATA").ok().map(|local_app_data| {
        PathBuf::from(local_app_data).join("ShadowBot").join("users")
    })
}

/// 扫描所有本地流程
pub fn scan_all_flows() -> Vec<LocalFlow> {
    let mut flows = Vec::new();
    
    let base_path = match get_shadowbot_base_path() {
        Some(p) if p.exists() => p,
        _ => return flows,
    };
    
    // 遍历所有用户目录
    if let Ok(users) = fs::read_dir(&base_path) {
        for user_entry in users.flatten() {
            let user_path = user_entry.path();
            if !user_path.is_dir() {
                continue;
            }
            
            let user_id = user_entry.file_name().to_string_lossy().to_string();
            let apps_path = user_path.join("apps");
            
            if !apps_path.exists() {
                continue;
            }
            
            // 遍历所有应用目录
            if let Ok(apps) = fs::read_dir(&apps_path) {
                for app_entry in apps.flatten() {
                    let app_path = app_entry.path();
                    let robot_path = app_path.join("xbot_robot");
                    let package_json_path = robot_path.join("package.json");
                    
                    if package_json_path.exists() {
                        if let Ok(content) = fs::read_to_string(&package_json_path) {
                            if let Ok(package_data) = serde_json::from_str::<serde_json::Value>(&content) {
                                let app_id = app_entry.file_name().to_string_lossy().to_string();
                                
                                // 获取文件修改时间
                                let update_time = fs::metadata(&package_json_path)
                                    .and_then(|m| m.modified())
                                    .map(|t| {
                                        let dt: DateTime<Local> = t.into();
                                        dt.format("%Y-%m-%d %H:%M:%S").to_string()
                                    })
                                    .unwrap_or_default();
                                
                                flows.push(LocalFlow {
                                    user_id: user_id.clone(),
                                    app_id,
                                    uuid: package_data.get("uuid")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string(),
                                    name: package_data.get("name")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("未知")
                                        .to_string(),
                                    update_time,
                                    robot_path: robot_path.to_string_lossy().to_string(),
                                    package_data,
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    
    // 按更新时间排序（最新的在前）
    flows.sort_by(|a, b| b.update_time.cmp(&a.update_time));
    flows
}

/// 删除本地流程
pub fn delete_flow(flow: &LocalFlow) -> Result<(), String> {
    let robot_path = PathBuf::from(&flow.robot_path);
    let app_path = robot_path.parent()
        .ok_or_else(|| "无法获取应用目录".to_string())?;
    
    if app_path.exists() {
        fs::remove_dir_all(app_path)
            .map_err(|e| format!("删除失败: {}", e))?;
        Ok(())
    } else {
        Err("目录不存在".to_string())
    }
}
