use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
};

use chrono::Local;
use serde_json::Value;
use uuid::Uuid;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

use crate::yingdao::{YingdaoClient, YingdaoError};

const MAX_PACKAGE_JSON_BYTES: u64 = 32 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES: u64 = 300 * 1024 * 1024;
const MAX_ZIP_ENTRIES: usize = 10_000;

#[derive(Clone)]
pub struct MigrationEngine {
    temp_root: Arc<PathBuf>,
    yingdao: YingdaoClient,
}

pub struct MigrationOutcome {
    pub target_app_id: String,
    pub downloaded_bytes: u64,
    pub uploaded_bytes: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct MigrationFailure {
    pub code: &'static str,
    pub message: &'static str,
}

impl From<YingdaoError> for MigrationFailure {
    fn from(error: YingdaoError) -> Self {
        Self {
            code: error.code(),
            message: error.message(),
        }
    }
}

struct PackageArtifacts {
    package_data: Value,
    package_json_path: PathBuf,
    target_bot_path: PathBuf,
    target_bot_bytes: u64,
}

struct TempGuard {
    path: PathBuf,
}

impl Drop for TempGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

impl MigrationEngine {
    pub fn new(temp_root: PathBuf, yingdao: YingdaoClient) -> std::io::Result<Self> {
        fs::create_dir_all(&temp_root)?;
        Ok(Self {
            temp_root: Arc::new(temp_root),
            yingdao,
        })
    }

    pub fn remove_abandoned_temp_files(&self) -> std::io::Result<()> {
        fs::create_dir_all(self.temp_root.as_ref())?;
        for entry in fs::read_dir(self.temp_root.as_ref())? {
            let path = entry?.path();
            if path.is_dir() {
                fs::remove_dir_all(path)?;
            } else {
                fs::remove_file(path)?;
            }
        }
        Ok(())
    }

    pub fn temp_usage_bytes(&self) -> u64 {
        directory_size(self.temp_root.as_ref()).unwrap_or(0)
    }

    pub fn cleanup_job(&self, job_id: &str) {
        let _ = fs::remove_dir_all(self.temp_root.join(job_id));
    }

    pub async fn migrate<F>(
        &self,
        job_id: &str,
        item_id: &str,
        source_token: &str,
        target_token: &str,
        source_app_id: &str,
        target_name: &str,
        progress: F,
    ) -> std::result::Result<MigrationOutcome, MigrationFailure>
    where
        F: Fn(&'static str, u32, u64) + Send + Sync,
    {
        let item_dir = self.temp_root.join(job_id).join(item_id);
        tokio::fs::create_dir_all(&item_dir)
            .await
            .map_err(|_| io_failure("temp_directory_failed", "无法创建迁移临时目录"))?;
        let _guard = TempGuard {
            path: item_dir.clone(),
        };
        let source_path = item_dir.join("source.bot");
        let target_path = item_dir.join("target.bot");
        let package_json_path = item_dir.join("package.json");

        progress("reading_source", 5, 0);
        let detail = self
            .yingdao
            .get_app_detail(source_token, source_app_id)
            .await?;
        let bot_url = detail
            .bot_read_url
            .or(detail.package_bot_url)
            .or(detail.package_schema_url)
            .filter(|url| !url.is_empty())
            .ok_or_else(|| io_failure("download_url_missing", "源流程没有可用的下载地址"))?;

        progress("downloading", 12, 0);
        let downloaded_bytes = self.yingdao.download_bot(&bot_url, &source_path).await?;
        progress("repacking", 38, downloaded_bytes);

        let new_app_id = Uuid::new_v4().to_string();
        let rewrite_source = source_path.clone();
        let rewrite_target = target_path.clone();
        let rewrite_json = package_json_path.clone();
        let rewrite_id = new_app_id.clone();
        let rewrite_name = target_name.to_owned();
        let artifacts = tokio::task::spawn_blocking(move || {
            rewrite_bot(
                &rewrite_source,
                &rewrite_target,
                &rewrite_json,
                &rewrite_id,
                &rewrite_name,
            )
        })
        .await
        .map_err(|_| io_failure("repack_failed", "流程包处理任务异常退出"))??;

        progress("assigning_upload", 58, downloaded_bytes);
        let bot_upload = self
            .yingdao
            .get_upload_info(target_token, &new_app_id, true)
            .await?;
        let json_upload = self
            .yingdao
            .get_upload_info(target_token, &new_app_id, false)
            .await?;
        if json_upload.file_key_md5.is_empty() {
            return Err(io_failure(
                "upload_metadata_missing",
                "目标账号没有返回完整的上传信息",
            ));
        }

        progress("uploading", 68, downloaded_bytes);
        self.yingdao
            .upload_file(&bot_upload.upload_url, &artifacts.target_bot_path)
            .await?;
        self.yingdao
            .upload_file(&json_upload.upload_url, &artifacts.package_json_path)
            .await?;

        progress("creating", 88, downloaded_bytes);
        self.yingdao
            .create_app(
                target_token,
                &new_app_id,
                &artifacts.package_data,
                &json_upload.file_key_md5,
            )
            .await?;

        progress("verifying", 96, downloaded_bytes);
        let created = self
            .yingdao
            .get_app_detail(target_token, &new_app_id)
            .await
            .map_err(|_| YingdaoError::VerificationFailed)?;
        if created.app_id != new_app_id {
            return Err(YingdaoError::VerificationFailed.into());
        }
        progress("completed", 100, downloaded_bytes);
        Ok(MigrationOutcome {
            target_app_id: new_app_id,
            downloaded_bytes,
            uploaded_bytes: artifacts.target_bot_bytes,
        })
    }
}

pub fn render_target_name(template: &str, original_name: &str) -> String {
    let now = Local::now();
    let template = if template.trim().is_empty() {
        "{name}_迁移_{datetime}"
    } else {
        template.trim()
    };
    let rendered = template
        .replace("{name}", original_name)
        .replace("{datetime}", &now.format("%Y%m%d_%H%M%S").to_string())
        .replace("{date}", &now.format("%Y%m%d").to_string())
        .replace("{time}", &now.format("%H%M%S").to_string());
    rendered.chars().take(200).collect()
}

fn rewrite_bot(
    source_path: &Path,
    target_path: &Path,
    package_json_path: &Path,
    new_app_id: &str,
    new_name: &str,
) -> std::result::Result<PackageArtifacts, MigrationFailure> {
    let source_file = File::open(source_path)
        .map_err(|_| io_failure("invalid_package", "无法打开下载的流程包"))?;
    let mut archive = ZipArchive::new(source_file)
        .map_err(|_| io_failure("invalid_package", "下载内容不是有效的流程压缩包"))?;
    if archive.len() > MAX_ZIP_ENTRIES {
        return Err(io_failure(
            "zip_entries_exceeded",
            "流程包内文件数量超过限制",
        ));
    }

    let mut package_index = None;
    let mut uncompressed_size = 0_u64;
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|_| io_failure("invalid_package", "无法读取流程包目录"))?;
        uncompressed_size = uncompressed_size.saturating_add(file.size());
        if uncompressed_size > MAX_UNCOMPRESSED_BYTES {
            return Err(io_failure(
                "uncompressed_size_exceeded",
                "流程包解压后超过 300 MB 限制",
            ));
        }
        if file.name().trim_start_matches("./") == "package.json" {
            if file.size() > MAX_PACKAGE_JSON_BYTES {
                return Err(io_failure(
                    "package_json_too_large",
                    "流程元数据超过 32 MB 限制",
                ));
            }
            package_index.get_or_insert(index);
        }
    }
    let package_index = package_index
        .ok_or_else(|| io_failure("package_json_missing", "流程包中没有找到 package.json"))?;

    let mut package_bytes = Vec::new();
    archive
        .by_index(package_index)
        .map_err(|_| io_failure("invalid_package", "无法读取流程元数据"))?
        .take(MAX_PACKAGE_JSON_BYTES + 1)
        .read_to_end(&mut package_bytes)
        .map_err(|_| io_failure("invalid_package", "无法读取流程元数据"))?;
    if package_bytes.len() as u64 > MAX_PACKAGE_JSON_BYTES {
        return Err(io_failure(
            "package_json_too_large",
            "流程元数据超过 32 MB 限制",
        ));
    }
    let mut package_data: Value = serde_json::from_slice(&package_bytes)
        .map_err(|_| io_failure("invalid_package_json", "流程元数据不是有效 JSON"))?;
    let package_object = package_data
        .as_object_mut()
        .ok_or_else(|| io_failure("invalid_package_json", "流程元数据不是 JSON 对象"))?;
    package_object.insert("uuid".to_owned(), Value::String(new_app_id.to_owned()));
    package_object.insert("name".to_owned(), Value::String(new_name.to_owned()));
    package_object.insert("encrypt_bot".to_owned(), Value::Bool(false));

    let mut json_file = File::create(package_json_path)
        .map_err(|_| io_failure("repack_failed", "无法写入新的流程元数据"))?;
    serde_json::to_writer_pretty(&mut json_file, &package_data)
        .map_err(|_| io_failure("repack_failed", "无法写入新的流程元数据"))?;
    json_file
        .sync_all()
        .map_err(|_| io_failure("repack_failed", "无法保存新的流程元数据"))?;

    let target_file =
        File::create(target_path).map_err(|_| io_failure("repack_failed", "无法创建新的流程包"))?;
    let mut writer = ZipWriter::new(target_file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|_| io_failure("repack_failed", "无法读取流程包条目"))?;
        if index == package_index {
            let name = file.name().to_owned();
            drop(file);
            writer
                .start_file(name, options)
                .map_err(|_| io_failure("repack_failed", "无法重写流程元数据"))?;
            writer
                .write_all(
                    &fs::read(package_json_path)
                        .map_err(|_| io_failure("repack_failed", "无法读取新流程元数据"))?,
                )
                .map_err(|_| io_failure("repack_failed", "无法重写流程元数据"))?;
        } else {
            writer
                .raw_copy_file(file)
                .map_err(|_| io_failure("repack_failed", "无法复制流程包条目"))?;
        }
    }
    let target_file = writer
        .finish()
        .map_err(|_| io_failure("repack_failed", "无法完成流程包写入"))?;
    target_file
        .sync_all()
        .map_err(|_| io_failure("repack_failed", "无法保存新的流程包"))?;
    let target_bot_bytes = target_file
        .metadata()
        .map_err(|_| io_failure("repack_failed", "无法读取新流程包大小"))?
        .len();
    Ok(PackageArtifacts {
        package_data,
        package_json_path: package_json_path.to_owned(),
        target_bot_path: target_path.to_owned(),
        target_bot_bytes,
    })
}

fn directory_size(path: &Path) -> std::io::Result<u64> {
    let mut total = 0_u64;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        total = total.saturating_add(if metadata.is_dir() {
            directory_size(&entry.path())?
        } else {
            metadata.len()
        });
    }
    Ok(total)
}

fn io_failure(code: &'static str, message: &'static str) -> MigrationFailure {
    MigrationFailure { code, message }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    #[test]
    fn target_name_template_replaces_tokens() {
        let rendered = render_target_name("{name}-{date}", "通知流程");
        assert!(rendered.starts_with("通知流程-"));
        assert!(!rendered.contains('{'));
    }

    #[test]
    fn rewrite_uses_files_and_preserves_non_metadata_entries() {
        let directory = std::env::temp_dir().join(format!("yingdao-rewrite-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("test directory should open");
        let source = directory.join("source.bot");
        let target = directory.join("target.bot");
        let metadata = directory.join("package.json");
        {
            let file = File::create(&source).expect("source bot should open");
            let mut writer = ZipWriter::new(file);
            writer
                .start_file("package.json", SimpleFileOptions::default())
                .expect("metadata entry should start");
            writer
                .write_all(br#"{"uuid":"old","name":"old","encrypt_bot":true}"#)
                .expect("metadata should write");
            writer
                .start_file("assets/data.txt", SimpleFileOptions::default())
                .expect("data entry should start");
            writer.write_all(b"preserved").expect("data should write");
            writer.finish().expect("source bot should finish");
        }

        let result = rewrite_bot(&source, &target, &metadata, "new-id", "新流程")
            .expect("bot should be rewritten");
        assert_eq!(result.package_data["uuid"], "new-id");
        assert_eq!(result.package_data["name"], "新流程");
        assert_eq!(result.package_data["encrypt_bot"], false);
        let file = File::open(&target).expect("target bot should open");
        let mut archive = ZipArchive::new(file).expect("target bot should be a zip");
        let mut preserved = String::new();
        archive
            .by_name("assets/data.txt")
            .expect("data entry should remain")
            .read_to_string(&mut preserved)
            .expect("data entry should read");
        assert_eq!(preserved, "preserved");
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }
}
