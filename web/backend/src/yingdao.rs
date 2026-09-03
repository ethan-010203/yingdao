use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use reqwest::{Body, Client, RequestBuilder};
use rsa::{pkcs8::DecodePublicKey, Pkcs1v15Encrypt, RsaPublicKey};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tokio::{fs::File, io::AsyncWriteExt};
use tokio_util::io::ReaderStream;
use zeroize::Zeroize;

const LOGIN_URL: &str = "https://api.yingdao.com/oauth/token";
const API_BASE_URL: &str = "https://api.winrobot360.com";
const TOKEN_TTL: Duration = Duration::from_secs(40 * 60);
const MAX_FLOW_PAGE_SIZE: u32 = 50;
pub(crate) const MAX_BOT_BYTES: u64 = 50 * 1024 * 1024;

const RSA_PUBLIC_KEY_PEM: &str = r#"-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCte0XfPY9GUpQ3ZasH1kVbDhRw
yRAqWSeyxj290OqFHtyiZ+5SQjrEr79mk0hcZqV03fb5oYf385E3gopSERIKxVQy
GoloNeDgyLu7rHHWMPo8KPDpUBlpRpHlGMgBNzJZ2BI6p7LvGAhCoA7XRuetyTlA
W6EbSXBpSu1sNGBhkQIDAQAB
-----END PUBLIC KEY-----"#;

#[derive(Clone)]
pub struct YingdaoClient {
    client: Client,
    tokens: Arc<Mutex<HashMap<String, CachedToken>>>,
}

struct CachedToken {
    token: String,
    expires_at: Instant,
}

impl Drop for CachedToken {
    fn drop(&mut self) {
        self.token.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudFlow {
    pub app_id: String,
    pub app_name: String,
    pub update_time: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowPage {
    pub items: Vec<CloudFlow>,
    pub page: u32,
    pub page_size: u32,
    pub total: u32,
    pub total_pages: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDetail {
    pub app_id: String,
    pub bot_read_url: Option<String>,
    pub package_bot_url: Option<String>,
    pub package_schema_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadInfo {
    pub upload_url: String,
    #[serde(default)]
    pub file_key_md5: String,
}

#[derive(Debug, Clone, Copy)]
pub enum YingdaoError {
    CredentialsRejected,
    Unauthorized,
    UpstreamUnavailable,
    InvalidResponse,
    DownloadTooLarge,
    DownloadFailed,
    UploadFailed,
    CreateFailed,
    DeleteFailed,
    VerificationFailed,
}

impl YingdaoError {
    pub fn code(self) -> &'static str {
        match self {
            Self::CredentialsRejected => "credentials_rejected",
            Self::Unauthorized => "upstream_session_expired",
            Self::UpstreamUnavailable => "upstream_unavailable",
            Self::InvalidResponse => "upstream_invalid_response",
            Self::DownloadTooLarge => "flow_package_too_large",
            Self::DownloadFailed => "download_failed",
            Self::UploadFailed => "upload_failed",
            Self::CreateFailed => "create_failed",
            Self::DeleteFailed => "delete_failed",
            Self::VerificationFailed => "verification_failed",
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Self::CredentialsRejected => "影刀账号或密码不正确",
            Self::Unauthorized => "影刀登录状态已失效，请验证账号后重试",
            Self::UpstreamUnavailable => "暂时无法连接影刀服务",
            Self::InvalidResponse => "影刀服务返回了无法识别的数据",
            Self::DownloadTooLarge => "流程压缩包超过 50 MB 限制",
            Self::DownloadFailed => "下载流程包失败",
            Self::UploadFailed => "上传流程包失败",
            Self::CreateFailed => "在目标账号创建流程失败",
            Self::DeleteFailed => "将流程移入回收站失败",
            Self::VerificationFailed => "目标账号未能确认新流程",
        }
    }
}

#[derive(Deserialize)]
struct LoginResponse {
    success: Option<bool>,
    access_token: Option<String>,
}

#[derive(Deserialize)]
struct ApiEnvelope<T> {
    success: Option<bool>,
    code: Option<serde_json::Value>,
    data: Option<T>,
    page: Option<PageInfo>,
}

#[derive(Deserialize)]
struct PageInfo {
    #[serde(default)]
    pages: u32,
    #[serde(default)]
    total: u32,
}

impl YingdaoClient {
    pub fn new() -> Result<Self> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(650))
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .context("failed to create Yingdao HTTP client")?;
        Ok(Self {
            client,
            tokens: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub async fn token_for(
        &self,
        account_id: &str,
        username: &str,
        password: &str,
    ) -> std::result::Result<String, YingdaoError> {
        if let Some(token) = self.cached_token(account_id) {
            return Ok(token);
        }
        let token = self.login(username, password).await?;
        self.tokens().insert(
            account_id.to_owned(),
            CachedToken {
                token: token.clone(),
                expires_at: Instant::now() + TOKEN_TTL,
            },
        );
        Ok(token)
    }

    pub fn invalidate(&self, account_id: &str) {
        self.tokens().remove(account_id);
    }

    pub async fn login(
        &self,
        username: &str,
        password: &str,
    ) -> std::result::Result<String, YingdaoError> {
        let encrypted_password =
            encrypt_password(password).map_err(|_| YingdaoError::InvalidResponse)?;
        let response = self
            .common_headers(self.client.post(LOGIN_URL))
            .header(
                "Content-Type",
                "application/x-www-form-urlencoded; Charset=UTF-8",
            )
            .header("Authorization", "basic c25zOlQ3c3ZGY0lMNGZvUGoxajk=")
            .header("Referer", LOGIN_URL)
            .form(&[
                ("username", username),
                ("password", encrypted_password.as_str()),
                ("crypt", "metal"),
                ("grant_type", "password"),
                ("scope", "all"),
            ])
            .send()
            .await
            .map_err(|_| YingdaoError::UpstreamUnavailable)?;
        if !response.status().is_success() {
            return Err(if response.status().as_u16() == 401 {
                YingdaoError::CredentialsRejected
            } else {
                YingdaoError::UpstreamUnavailable
            });
        }
        let text = response
            .text()
            .await
            .map_err(|_| YingdaoError::InvalidResponse)?;
        let json_text = text
            .split_once("}{")
            .map(|(first, _)| format!("{first}}}"))
            .unwrap_or(text);
        let payload: LoginResponse =
            serde_json::from_str(&json_text).map_err(|_| YingdaoError::InvalidResponse)?;
        if payload.success.unwrap_or(false) {
            if let Some(token) = payload.access_token.filter(|token| !token.is_empty()) {
                return Ok(token);
            }
        }
        Err(YingdaoError::CredentialsRejected)
    }

    pub async fn list_flows(
        &self,
        token: &str,
        query: &str,
        page: u32,
        page_size: u32,
    ) -> std::result::Result<FlowPage, YingdaoError> {
        let page = page.max(1);
        let page_size = page_size.clamp(1, MAX_FLOW_PAGE_SIZE);
        let response = self
            .auth_headers(
                self.client
                    .post(format!("{API_BASE_URL}/api/client/app/develop/list")),
                token,
            )
            .json(&serde_json::json!({
                "groupId": null,
                "name": query.trim(),
                "pageType": 1,
                "pageDTO": {"page": page, "size": page_size},
                "sortBy": "4"
            }))
            .send()
            .await
            .map_err(|_| YingdaoError::UpstreamUnavailable)?;
        let payload: ApiEnvelope<Vec<CloudFlow>> = self.read_api(response).await?;
        if !payload.success.unwrap_or(false) {
            return Err(YingdaoError::UpstreamUnavailable);
        }
        let items = payload.data.unwrap_or_default();
        let (total_pages, total) = payload
            .page
            .map(|info| (info.pages.max(1), info.total))
            .unwrap_or((1, items.len() as u32));
        Ok(FlowPage {
            items,
            page,
            page_size,
            total,
            total_pages,
        })
    }

    pub async fn get_app_detail(
        &self,
        token: &str,
        app_id: &str,
    ) -> std::result::Result<AppDetail, YingdaoError> {
        let response = self
            .auth_headers(
                self.client
                    .get(format!("{API_BASE_URL}/api/client/app/develop/app/detail")),
                token,
            )
            .query(&[("appId", app_id), ("checkAppRecycle", "True")])
            .send()
            .await
            .map_err(|_| YingdaoError::UpstreamUnavailable)?;
        let payload: ApiEnvelope<AppDetail> = self.read_api(response).await?;
        payload.data.ok_or(YingdaoError::InvalidResponse)
    }

    pub async fn download_bot(
        &self,
        url: &str,
        destination: &Path,
    ) -> std::result::Result<u64, YingdaoError> {
        let mut response = self
            .common_headers(self.client.get(url))
            .send()
            .await
            .map_err(|_| YingdaoError::DownloadFailed)?;
        if !response.status().is_success() {
            return Err(YingdaoError::DownloadFailed);
        }
        if response
            .content_length()
            .is_some_and(|size| size > MAX_BOT_BYTES)
        {
            return Err(YingdaoError::DownloadTooLarge);
        }
        let mut output = File::create(destination)
            .await
            .map_err(|_| YingdaoError::DownloadFailed)?;
        let mut downloaded = 0_u64;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| YingdaoError::DownloadFailed)?
        {
            downloaded += chunk.len() as u64;
            if downloaded > MAX_BOT_BYTES {
                return Err(YingdaoError::DownloadTooLarge);
            }
            output
                .write_all(&chunk)
                .await
                .map_err(|_| YingdaoError::DownloadFailed)?;
        }
        output
            .sync_all()
            .await
            .map_err(|_| YingdaoError::DownloadFailed)?;
        Ok(downloaded)
    }

    pub async fn get_upload_info(
        &self,
        token: &str,
        app_id: &str,
        is_bot: bool,
    ) -> std::result::Result<UploadInfo, YingdaoError> {
        let response = self
            .auth_headers(
                self.client.post(format!(
                    "{API_BASE_URL}/api/client/app/file/assignUploadUrl"
                )),
                token,
            )
            .json(&serde_json::json!({
                "appId": app_id,
                "appType": "app",
                "version": "",
                "isBot": if is_bot { "true" } else { "false" }
            }))
            .send()
            .await
            .map_err(|_| YingdaoError::UpstreamUnavailable)?;
        let payload: ApiEnvelope<UploadInfo> = self.read_api(response).await?;
        payload
            .data
            .filter(|info| !info.upload_url.is_empty())
            .ok_or(YingdaoError::InvalidResponse)
    }

    pub async fn upload_file(
        &self,
        url: &str,
        path: &Path,
    ) -> std::result::Result<(), YingdaoError> {
        let file = File::open(path)
            .await
            .map_err(|_| YingdaoError::UploadFailed)?;
        let size = file
            .metadata()
            .await
            .map_err(|_| YingdaoError::UploadFailed)?
            .len();
        let body = Body::wrap_stream(ReaderStream::new(file));
        let response = self
            .common_headers(self.client.put(url))
            .header("Content-Length", size)
            .body(body)
            .send()
            .await
            .map_err(|_| YingdaoError::UploadFailed)?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(YingdaoError::UploadFailed)
        }
    }

    pub async fn create_app(
        &self,
        token: &str,
        app_id: &str,
        package_data: &serde_json::Value,
        package_md5: &str,
    ) -> std::result::Result<(), YingdaoError> {
        let flow_count = package_data
            .get("flows")
            .and_then(|value| value.as_array())
            .map(Vec::len)
            .unwrap_or(0);
        let response = self
            .auth_headers(
                self.client
                    .post(format!("{API_BASE_URL}/api/client/app/develop/create")),
                token,
            )
            .json(&serde_json::json!({
                "appId": app_id,
                "appPackage": {
                    "activities": [],
                    "appFlowParamList": [],
                    "appIcon": package_data.get("icon").and_then(|v| v.as_str()).unwrap_or(""),
                    "appType": package_data.get("robot_type").and_then(|v| v.as_str()).unwrap_or("app"),
                    "customItems": package_data.get("customItems").cloned().unwrap_or_else(|| serde_json::json!({
                        "gifUrl": "", "imageName": "", "imageUrl": "", "uiaType": "PC", "videoUrl": ""
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
                    "statistics": {"blockCount": flow_count, "flowCount": flow_count, "magicBlockCount": 0, "sourceLineCount": 0},
                    "uiTags": "",
                    "uiaType": package_data.get("uia_type").and_then(|v| v.as_str()).unwrap_or("PC"),
                    "videoUrl": package_data.get("videoName").and_then(|v| v.as_str()).unwrap_or("")
                },
                "elementLibraryStatus": 0,
                "groupId": "",
                "packageMd5": package_md5
            }))
            .send()
            .await
            .map_err(|_| YingdaoError::CreateFailed)?;
        let payload: ApiEnvelope<serde_json::Value> = self.read_api(response).await?;
        let code_ok = payload
            .code
            .as_ref()
            .is_some_and(|code| code.as_i64() == Some(200) || code.as_str() == Some("200"));
        if payload.success.unwrap_or(false) || code_ok {
            Ok(())
        } else {
            Err(YingdaoError::CreateFailed)
        }
    }

    pub async fn delete_flow(
        &self,
        token: &str,
        app_id: &str,
    ) -> std::result::Result<(), YingdaoError> {
        let response = self
            .auth_headers(
                self.client
                    .post(format!("{API_BASE_URL}/api/client/recycle/recycle")),
                token,
            )
            .json(&serde_json::json!({"appId": app_id}))
            .send()
            .await
            .map_err(|_| YingdaoError::DeleteFailed)?;
        let payload: ApiEnvelope<serde_json::Value> = self.read_api(response).await?;
        let code_ok = payload
            .code
            .as_ref()
            .is_some_and(|code| code.as_i64() == Some(200) || code.as_str() == Some("200"));
        if payload.success.unwrap_or(false) || code_ok {
            Ok(())
        } else {
            Err(YingdaoError::DeleteFailed)
        }
    }

    async fn read_api<T: DeserializeOwned>(
        &self,
        response: reqwest::Response,
    ) -> std::result::Result<ApiEnvelope<T>, YingdaoError> {
        if response.status().as_u16() == 401 {
            return Err(YingdaoError::Unauthorized);
        }
        if !response.status().is_success() {
            return Err(YingdaoError::UpstreamUnavailable);
        }
        let text = response
            .text()
            .await
            .map_err(|_| YingdaoError::InvalidResponse)?;
        let json_text = text
            .split_once("}{")
            .map(|(first, _)| format!("{first}}}"))
            .unwrap_or(text);
        serde_json::from_str(&json_text).map_err(|_| YingdaoError::InvalidResponse)
    }

    fn common_headers(&self, request: RequestBuilder) -> RequestBuilder {
        request
            .header("Connection", "Keep-Alive")
            .header("Accept", "*/*")
            .header("Accept-Language", "zh-cn")
            .header(
                "User-Agent",
                "Mozilla/4.0 (compatible; MSIE 9.0; Windows NT 6.1)",
            )
    }

    fn auth_headers(&self, request: RequestBuilder, token: &str) -> RequestBuilder {
        self.common_headers(request)
            .header("Content-Type", "application/json; charset=utf-8")
            .header("Authorization", format!("bearer {token}"))
    }

    fn cached_token(&self, account_id: &str) -> Option<String> {
        let mut tokens = self.tokens();
        let now = Instant::now();
        tokens.retain(|_, token| token.expires_at > now);
        tokens.get(account_id).map(|token| token.token.clone())
    }

    fn tokens(&self) -> std::sync::MutexGuard<'_, HashMap<String, CachedToken>> {
        self.tokens
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }
}

fn encrypt_password(password: &str) -> Result<String> {
    let public_key = RsaPublicKey::from_public_key_pem(RSA_PUBLIC_KEY_PEM)
        .context("failed to parse Yingdao public key")?;
    let encrypted = public_key
        .encrypt(
            &mut rand::thread_rng(),
            Pkcs1v15Encrypt,
            password.as_bytes(),
        )
        .context("failed to encrypt Yingdao password")?;
    Ok(BASE64.encode(encrypted))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_encryption_is_randomized() {
        let first = encrypt_password("example-password").expect("password should encrypt");
        let second = encrypt_password("example-password").expect("password should encrypt");
        assert_ne!(first, second);
    }
}
