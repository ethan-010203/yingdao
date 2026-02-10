//! 云端流程操作模块
use serde::{Deserialize, Serialize};
use crate::api::client::create_client;

const BASE_URL: &str = "https://api.winrobot360.com";

/// 云端流程信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudFlow {
    pub app_id: String,
    pub app_name: String,
    pub update_time: Option<String>,
}

/// API 响应包装
#[derive(Debug, Deserialize)]
struct ApiResponse<T> {
    success: bool,
    data: Option<T>,
    page: Option<PageInfo>,
}

#[derive(Debug, Deserialize)]
struct PageInfo {
    pages: u32,
    total: u32,
}

/// 应用详情
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDetail {
    pub app_id: String,
    pub bot_read_url: Option<String>,
    pub package_bot_url: Option<String>,
    pub package_schema_url: Option<String>,
}

/// 上传信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadInfo {
    pub upload_url: String,
    pub file_key: String,
    pub read_url: String,
    pub file_key_md5: String,
}

/// 获取云端流程列表（支持分页）
pub async fn get_cloud_flow_list(token: &str) -> Result<Vec<CloudFlow>, String> {
    let client = create_client()?;
    let mut all_flows = Vec::new();
    let mut page = 1u32;
    let page_size = 30u32;
    let mut total_pages = 1u32;
    
    while page <= total_pages {
        let payload = serde_json::json!({
            "groupId": null,
            "name": "",
            "pageType": 1,
            "pageDTO": {"page": page, "size": page_size},
            "sortBy": "4"
        });
        
        let response = client
            .post(format!("{}/api/client/app/develop/list", BASE_URL))
            .header("Connection", "Keep-Alive")
            .header("Content-Type", "application/json; charset=utf-8")
            .header("Accept", "*/*")
            .header("Accept-Language", "zh-cn")
            .header("Authorization", format!("bearer {}", token))
            .header("User-Agent", "Mozilla/4.0 (compatible; MSIE 9.0; Windows NT 6.1)")
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("请求失败: {}", e))?;
        
        let result: ApiResponse<Vec<CloudFlow>> = response
            .json()
            .await
            .map_err(|e| format!("解析响应失败: {}", e))?;
        
        if result.success {
            if let Some(flows) = result.data {
                all_flows.extend(flows);
            }
            if let Some(page_info) = result.page {
                total_pages = page_info.pages;
            }
            page += 1;
        } else {
            break;
        }
    }
    
    Ok(all_flows)
}

/// 获取应用详情
pub async fn get_app_detail(token: &str, app_id: &str) -> Result<AppDetail, String> {
    let client = create_client()?;
    
    let response = client
        .get(format!("{}/api/client/app/develop/app/detail", BASE_URL))
        .header("Authorization", format!("bearer {}", token))
        .header("User-Agent", "Mozilla/4.0 (compatible; MSIE 9.0; Windows NT 6.1)")
        .query(&[("appId", app_id), ("checkAppRecycle", "True")])
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    
    #[derive(Deserialize)]
    struct Response {
        success: bool,
        data: Option<AppDetail>,
    }
    
    let result: Response = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;
    
    result.data.ok_or_else(|| "获取应用详情失败".to_string())
}

/// 下载 package.bot 文件
pub async fn download_package_bot(url: &str) -> Result<Vec<u8>, String> {
    let client = create_client()?;
    
    let response = client
        .get(url)
        .header("User-Agent", "Mozilla/4.0 (compatible; MSIE 9.0; Windows NT 6.1)")
        .send()
        .await
        .map_err(|e| format!("下载失败: {}", e))?;
    
    if response.status().is_success() {
        response.bytes().await
            .map(|b| b.to_vec())
            .map_err(|e| format!("读取数据失败: {}", e))
    } else {
        Err(format!("下载失败，状态码: {}", response.status()))
    }
}

/// 获取上传地址
pub async fn get_upload_url(token: &str, app_id: &str, is_bot: bool) -> Result<UploadInfo, String> {
    let client = create_client()?;
    
    let payload = serde_json::json!({
        "appId": app_id,
        "appType": "app",
        "version": "",
        "isBot": if is_bot { "true" } else { "false" }
    });
    
    let response = client
        .post(format!("{}/api/client/app/file/assignUploadUrl", BASE_URL))
        .header("Authorization", format!("bearer {}", token))
        .header("Content-Type", "application/json; charset=utf-8")
        .header("User-Agent", "Mozilla/4.0 (compatible; MSIE 9.0; Windows NT 6.1)")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    
    #[derive(Deserialize)]
    struct Response {
        data: Option<UploadInfo>,
    }
    
    let result: Response = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;
    
    result.data.ok_or_else(|| "获取上传地址失败".to_string())
}

/// 上传文件到 OSS
pub async fn upload_to_oss(url: &str, data: Vec<u8>) -> Result<(), String> {
    let client = create_client()?;
    
    let response = client
        .put(url)
        .header("Connection", "Keep-Alive")
        .header("Accept", "*/*")
        .header("Accept-Language", "zh-cn")
        .header("User-Agent", "Mozilla/4.0 (compatible; MSIE 9.0; Windows NT 6.1)")
        .body(data)
        .send()
        .await
        .map_err(|e| format!("上传失败: {}", e))?;
    
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("上传失败，状态码: {}", response.status()))
    }
}

/// 创建应用
pub async fn create_app(
    token: &str,
    app_id: &str,
    package_data: &serde_json::Value,
    package_md5: &str,
) -> Result<(), String> {
    let client = create_client()?;
    
    let payload = serde_json::json!({
        "appId": app_id,
        "appPackage": {
            "activities": [],
            "appFlowParamList": [],
            "appIcon": package_data.get("icon").and_then(|v| v.as_str()).unwrap_or(""),
            "appType": package_data.get("robot_type").and_then(|v| v.as_str()).unwrap_or("app"),
            "customItems": package_data.get("customItems").cloned().unwrap_or_else(|| serde_json::json!({
                "gifUrl": "",
                "imageName": "",
                "imageUrl": "",
                "uiaType": "PC",
                "videoUrl": ""
            })),
            "description": package_data.get("description").and_then(|v| v.as_str()).unwrap_or(""),
            "elementLibraryCodes": [],
            "enableViewSource": "false",
            "externalDependencies": package_data.get("external_dependencies").cloned().unwrap_or_else(|| serde_json::json!([])),
            "instruction": package_data.get("instruction").and_then(|v| v.as_str()).unwrap_or(""),
            "internalDependencies": package_data.get("internaldependencies").cloned().unwrap_or_else(|| serde_json::json!([])),
            "internalautodependencies": package_data.get("internalautodependencies").cloned().unwrap_or_else(|| serde_json::json!([])),
            "ipaasDependencies": package_data.get("ipaasDependencies").cloned().unwrap_or_else(|| serde_json::json!([])),
            "name": package_data.get("name").and_then(|v| v.as_str()).unwrap_or("未命名"),
            "packageCode": "",
            "statistics": {
                "blockCount": package_data.get("flows").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
                "flowCount": package_data.get("flows").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
                "magicBlockCount": 0,
                "sourceLineCount": 0
            },
            "uiTags": "",
            "uiaType": package_data.get("uia_type").and_then(|v| v.as_str()).unwrap_or("PC"),
            "videoUrl": package_data.get("videoName").and_then(|v| v.as_str()).unwrap_or("")
        },
        "elementLibraryStatus": 0,
        "groupId": "",
        "packageMd5": package_md5
    });
    
    let response = client
        .post(format!("{}/api/client/app/develop/create", BASE_URL))
        .header("Authorization", format!("bearer {}", token))
        .header("Content-Type", "application/json; charset=utf-8")
        .header("User-Agent", "Mozilla/4.0 (compatible; MSIE 9.0; Windows NT 6.1)")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    
    #[derive(Deserialize)]
    struct Response {
        success: Option<bool>,
        code: Option<u32>,
    }
    
    let result: Response = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;
    
    if result.success.unwrap_or(false) || result.code == Some(200) {
        Ok(())
    } else {
        Err("创建应用失败".to_string())
    }
}

/// 删除云端流程（移入回收站）
pub async fn delete_cloud_flow(token: &str, app_id: &str) -> Result<(), String> {
    let client = create_client()?;
    
    let payload = serde_json::json!({
        "appId": app_id
    });
    
    let response = client
        .post(format!("{}/api/client/recycle/recycle", BASE_URL))
        .header("Connection", "Keep-Alive")
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Accept", "*/*")
        .header("Accept-Language", "zh-cn")
        .header("Authorization", format!("bearer {}", token))
        .header("User-Agent", "Mozilla/4.0 (compatible; MSIE 9.0; Windows NT 6.1)")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    
    // 检查 token 是否过期
    if response.status().as_u16() == 401 {
        return Err("TOKEN_EXPIRED".to_string());
    }
    
    #[derive(Deserialize)]
    struct Response {
        success: Option<bool>,
        code: Option<u32>,
    }
    
    let result: Response = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;
    
    if result.success.unwrap_or(false) || result.code == Some(200) {
        Ok(())
    } else {
        Err("删除流程失败".to_string())
    }
}

