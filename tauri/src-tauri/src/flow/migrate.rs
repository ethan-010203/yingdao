//! 流程迁移核心逻辑
use std::io::{Read, Write, Cursor};
use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};
use chrono::Local;
use uuid::Uuid;

use crate::flow::local::LocalFlow;
use crate::flow::cloud::{self, CloudFlow};

/// 从 ZIP 中提取 package.json
fn extract_package_json(bot_data: &[u8]) -> Result<serde_json::Value, String> {
    let cursor = Cursor::new(bot_data);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| format!("解析ZIP失败: {}", e))?;
    
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("读取ZIP条目失败: {}", e))?;
        
        if file.name() == "package.json" {
            let mut content = String::new();
            file.read_to_string(&mut content)
                .map_err(|e| format!("读取文件失败: {}", e))?;
            
            return serde_json::from_str(&content)
                .map_err(|e| format!("解析JSON失败: {}", e));
        }
    }
    
    Err("ZIP中找不到package.json".to_string())
}

/// 重新打包 package.bot，替换 package.json
fn repack_package_bot(bot_data: &[u8], new_package_data: &serde_json::Value) -> Result<Vec<u8>, String> {
    let cursor = Cursor::new(bot_data);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| format!("解析ZIP失败: {}", e))?;
    
    let mut output = Vec::new();
    {
        let cursor_out = Cursor::new(&mut output);
        let mut zip_writer = ZipWriter::new(cursor_out);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        
        for i in 0..archive.len() {
            let mut file = archive.by_index(i)
                .map_err(|e| format!("读取ZIP条目失败: {}", e))?;
            
            let name = file.name().to_string();
            
            if name == "package.json" {
                // 替换 package.json
                let json_content = serde_json::to_string_pretty(new_package_data)
                    .map_err(|e| format!("序列化JSON失败: {}", e))?;
                
                zip_writer.start_file(&name, options)
                    .map_err(|e| format!("写入ZIP失败: {}", e))?;
                zip_writer.write_all(json_content.as_bytes())
                    .map_err(|e| format!("写入ZIP内容失败: {}", e))?;
            } else {
                // 复制其他文件
                let mut content = Vec::new();
                file.read_to_end(&mut content)
                    .map_err(|e| format!("读取文件内容失败: {}", e))?;
                
                zip_writer.start_file(&name, options)
                    .map_err(|e| format!("写入ZIP失败: {}", e))?;
                zip_writer.write_all(&content)
                    .map_err(|e| format!("写入ZIP内容失败: {}", e))?;
            }
        }
        
        zip_writer.finish()
            .map_err(|e| format!("完成ZIP写入失败: {}", e))?;
    }
    
    Ok(output)
}

/// 从本地流程创建 package.bot
fn create_package_bot_from_local(robot_path: &str, package_data: &serde_json::Value) -> Result<Vec<u8>, String> {
    use std::fs;
    use std::path::Path;
    use walkdir::WalkDir;
    
    let mut output = Vec::new();
    {
        let cursor = Cursor::new(&mut output);
        let mut zip_writer = ZipWriter::new(cursor);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        
        let robot_path = Path::new(robot_path);
        
        for entry in WalkDir::new(robot_path) {
            let entry = entry.map_err(|e| format!("遍历目录失败: {}", e))?;
            let path = entry.path();
            
            if path.is_file() {
                let rel_path = path.strip_prefix(robot_path)
                    .map_err(|e| format!("计算相对路径失败: {}", e))?;
                let name = rel_path.to_string_lossy().replace("\\", "/");
                
                if name == "package.json" {
                    // 使用修改后的 package.json
                    let json_content = serde_json::to_string_pretty(package_data)
                        .map_err(|e| format!("序列化JSON失败: {}", e))?;
                    
                    zip_writer.start_file(&name, options)
                        .map_err(|e| format!("写入ZIP失败: {}", e))?;
                    zip_writer.write_all(json_content.as_bytes())
                        .map_err(|e| format!("写入ZIP内容失败: {}", e))?;
                } else {
                    let content = fs::read(path)
                        .map_err(|e| format!("读取文件失败: {}", e))?;
                    
                    zip_writer.start_file(&name, options)
                        .map_err(|e| format!("写入ZIP失败: {}", e))?;
                    zip_writer.write_all(&content)
                        .map_err(|e| format!("写入ZIP内容失败: {}", e))?;
                }
            }
        }
        
        zip_writer.finish()
            .map_err(|e| format!("完成ZIP写入失败: {}", e))?;
    }
    
    Ok(output)
}

/// 迁移本地流程到目标账号
pub async fn migrate_local_flow(flow: &LocalFlow, target_token: &str) -> Result<String, String> {
    // 1. 生成新的 APP ID
    let new_app_id = Uuid::new_v4().to_string();
    
    // 2. 准备新的 package_data
    let timestamp = Local::now().format("%Y年%m月%d日 %H时%M分%S秒").to_string();
    let new_name = format!("{}_云迁_接收于{}", flow.name, timestamp);
    
    let mut package_data = flow.package_data.clone();
    if let Some(obj) = package_data.as_object_mut() {
        obj.insert("uuid".to_string(), serde_json::json!(new_app_id));
        obj.insert("name".to_string(), serde_json::json!(new_name));
        obj.insert("encrypt_bot".to_string(), serde_json::json!(false));
    }
    
    // 3. 创建 package.bot
    let bot_data = create_package_bot_from_local(&flow.robot_path, &package_data)?;
    
    // 4. 获取上传地址并上传 .bot
    let bot_upload_info = cloud::get_upload_url(target_token, &new_app_id, true).await?;
    cloud::upload_to_oss(&bot_upload_info.upload_url, bot_data).await?;
    
    // 5. 获取上传地址并上传 .json
    let json_upload_info = cloud::get_upload_url(target_token, &new_app_id, false).await?;
    let json_content = serde_json::to_string_pretty(&package_data)
        .map_err(|e| format!("序列化JSON失败: {}", e))?;
    cloud::upload_to_oss(&json_upload_info.upload_url, json_content.into_bytes()).await?;
    
    // 6. 创建应用
    cloud::create_app(target_token, &new_app_id, &package_data, &json_upload_info.file_key_md5).await?;
    
    Ok(new_name)
}

/// 迁移云端流程到目标账号
pub async fn migrate_cloud_flow(
    flow: &CloudFlow,
    source_token: &str,
    target_token: &str,
) -> Result<String, String> {
    // 1. 获取源应用详情
    let detail = cloud::get_app_detail(source_token, &flow.app_id).await?;
    
    // 2. 获取下载 URL
    let bot_url = detail.bot_read_url
        .or(detail.package_bot_url)
        .or(detail.package_schema_url)
        .ok_or_else(|| "找不到下载地址".to_string())?;
    
    // 3. 下载 package.bot
    let bot_data = cloud::download_package_bot(&bot_url).await?;
    
    // 4. 提取并修改 package.json
    let mut package_data = extract_package_json(&bot_data)?;
    
    let new_app_id = Uuid::new_v4().to_string();
    let timestamp = Local::now().format("%Y年%m月%d日 %H时%M分%S秒").to_string();
    let new_name = format!("{}_云迁_接收于{}", flow.app_name, timestamp);
    
    if let Some(obj) = package_data.as_object_mut() {
        obj.insert("uuid".to_string(), serde_json::json!(new_app_id));
        obj.insert("name".to_string(), serde_json::json!(new_name));
        obj.insert("encrypt_bot".to_string(), serde_json::json!(false));
    }
    
    // 5. 重新打包 package.bot
    let new_bot_data = repack_package_bot(&bot_data, &package_data)?;
    
    // 6. 上传 .bot
    let bot_upload_info = cloud::get_upload_url(target_token, &new_app_id, true).await?;
    cloud::upload_to_oss(&bot_upload_info.upload_url, new_bot_data).await?;
    
    // 7. 上传 .json
    let json_upload_info = cloud::get_upload_url(target_token, &new_app_id, false).await?;
    let json_content = serde_json::to_string_pretty(&package_data)
        .map_err(|e| format!("序列化JSON失败: {}", e))?;
    cloud::upload_to_oss(&json_upload_info.upload_url, json_content.into_bytes()).await?;
    
    // 8. 创建应用
    cloud::create_app(target_token, &new_app_id, &package_data, &json_upload_info.file_key_md5).await?;
    
    Ok(new_name)
}
