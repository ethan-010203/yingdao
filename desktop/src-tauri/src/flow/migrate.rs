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

/// 重新打包 package.bot，仅替换 package.json
///
/// 优化点：对非 package.json 条目使用 `raw_copy_file`，
/// 直接复制原始压缩字节流而不重新 deflate，显著降低 CPU 与内存占用。
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
            let file = archive.by_index(i)
                .map_err(|e| format!("读取ZIP条目失败: {}", e))?;

            if file.name() == "package.json" {
                // 替换 package.json，需要重新压缩
                let json_content = serde_json::to_string_pretty(new_package_data)
                    .map_err(|e| format!("序列化JSON失败: {}", e))?;

                drop(file);
                zip_writer.start_file("package.json", options)
                    .map_err(|e| format!("写入ZIP失败: {}", e))?;
                zip_writer.write_all(json_content.as_bytes())
                    .map_err(|e| format!("写入ZIP内容失败: {}", e))?;
            } else {
                // 其他条目：raw_copy 直接搬运压缩字节，避免解压再压缩
                zip_writer
                    .raw_copy_file(file)
                    .map_err(|e| format!("复制ZIP条目失败: {}", e))?;
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

/// 根据模板生成迁移后的流程名称
fn apply_suffix_template(template: &str, original_name: &str) -> String {
    let now = Local::now();
    template
        .replace("{name}", original_name)
        .replace("{datetime}", &now.format("%Y年%m月%d日 %H时%M分%S秒").to_string())
        .replace("{date}", &now.format("%Y-%m-%d").to_string())
        .replace("{time}", &now.format("%H:%M:%S").to_string())
}

/// 把流程的 uuid / name / encrypt_bot 字段就地更新
fn rewrite_package_meta(package_data: &mut serde_json::Value, new_app_id: &str, new_name: &str) {
    if let Some(obj) = package_data.as_object_mut() {
        obj.insert("uuid".to_string(), serde_json::json!(new_app_id));
        obj.insert("name".to_string(), serde_json::json!(new_name));
        obj.insert("encrypt_bot".to_string(), serde_json::json!(false));
    }
}

/// 通用：上传 .bot + .json 并在目标账号创建应用。两种迁移路径共用这段尾部链路。
async fn upload_and_create_app(
    target_token: &str,
    new_app_id: &str,
    bot_data: Vec<u8>,
    package_data: &serde_json::Value,
) -> Result<(), String> {
    let bot_upload_info = cloud::get_upload_url(target_token, new_app_id, true).await?;
    cloud::upload_to_oss(&bot_upload_info.upload_url, bot_data).await?;

    let json_upload_info = cloud::get_upload_url(target_token, new_app_id, false).await?;
    let json_content = serde_json::to_string_pretty(package_data)
        .map_err(|e| format!("序列化JSON失败: {}", e))?;
    cloud::upload_to_oss(&json_upload_info.upload_url, json_content.into_bytes()).await?;

    cloud::create_app(target_token, new_app_id, package_data, &json_upload_info.file_key_md5).await
}

/// 迁移本地流程到目标账号
pub async fn migrate_local_flow(flow: &LocalFlow, target_token: &str, suffix_template: &str) -> Result<String, String> {
    let new_app_id = Uuid::new_v4().to_string();
    let new_name = apply_suffix_template(suffix_template, &flow.name);

    let mut package_data = flow.package_data.clone();
    rewrite_package_meta(&mut package_data, &new_app_id, &new_name);

    let bot_data = create_package_bot_from_local(&flow.robot_path, &package_data)?;

    upload_and_create_app(target_token, &new_app_id, bot_data, &package_data).await?;
    Ok(new_name)
}

/// 迁移云端流程到目标账号
pub async fn migrate_cloud_flow(
    flow: &CloudFlow,
    source_token: &str,
    target_token: &str,
    suffix_template: &str,
) -> Result<String, String> {
    // 拉取源端 .bot
    let detail = cloud::get_app_detail(source_token, &flow.app_id).await?;
    let bot_url = detail.bot_read_url
        .or(detail.package_bot_url)
        .or(detail.package_schema_url)
        .ok_or_else(|| "找不到下载地址".to_string())?;
    let bot_data = cloud::download_package_bot(&bot_url).await?;

    // 改写 package.json
    let mut package_data = extract_package_json(&bot_data)?;
    let new_app_id = Uuid::new_v4().to_string();
    let new_name = apply_suffix_template(suffix_template, &flow.app_name);
    rewrite_package_meta(&mut package_data, &new_app_id, &new_name);

    // 重新打包并上传
    let new_bot_data = repack_package_bot(&bot_data, &package_data)?;
    upload_and_create_app(target_token, &new_app_id, new_bot_data, &package_data).await?;
    Ok(new_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::{ZipWriter, write::SimpleFileOptions};

    #[test]
    fn apply_suffix_template_replaces_name() {
        let result = apply_suffix_template("{name}_v2", "MyFlow");
        assert_eq!(result, "MyFlow_v2");
    }

    #[test]
    fn apply_suffix_template_includes_date_token() {
        let result = apply_suffix_template("{name}-{date}", "Flow");
        assert!(result.starts_with("Flow-"));
        // {date} 形如 YYYY-MM-DD：长度至少 10，且包含两个 '-'
        let date_part = result.trim_start_matches("Flow-");
        assert_eq!(date_part.len(), 10);
        assert_eq!(date_part.matches('-').count(), 2);
    }

    #[test]
    fn rewrite_package_meta_overwrites_fields() {
        let mut data = serde_json::json!({
            "uuid": "old-id",
            "name": "old-name",
            "encrypt_bot": true,
            "other": "kept"
        });
        rewrite_package_meta(&mut data, "new-id", "new-name");
        assert_eq!(data["uuid"], "new-id");
        assert_eq!(data["name"], "new-name");
        assert_eq!(data["encrypt_bot"], false);
        assert_eq!(data["other"], "kept");
    }

    #[test]
    fn extract_package_json_finds_entry() {
        // 构造一个最小 zip
        let mut buf = Vec::new();
        {
            let cursor = Cursor::new(&mut buf);
            let mut zw = ZipWriter::new(cursor);
            zw.start_file("package.json", SimpleFileOptions::default()).unwrap();
            zw.write_all(b"{\"name\":\"hello\"}").unwrap();
            zw.start_file("other.txt", SimpleFileOptions::default()).unwrap();
            zw.write_all(b"ignore").unwrap();
            zw.finish().unwrap();
        }
        let json = extract_package_json(&buf).unwrap();
        assert_eq!(json["name"], "hello");
    }

    #[test]
    fn extract_package_json_missing_returns_err() {
        let mut buf = Vec::new();
        {
            let cursor = Cursor::new(&mut buf);
            let mut zw = ZipWriter::new(cursor);
            zw.start_file("other.txt", SimpleFileOptions::default()).unwrap();
            zw.write_all(b"x").unwrap();
            zw.finish().unwrap();
        }
        assert!(extract_package_json(&buf).is_err());
    }
}
