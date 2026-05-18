//! HTTP 客户端工具
use reqwest::{Client, RequestBuilder};
use std::sync::OnceLock;
use std::time::Duration;

static SHARED_CLIENT: OnceLock<Client> = OnceLock::new();
static UPDATER_CLIENT: OnceLock<Client> = OnceLock::new();

/// 获取共享的 HTTP 客户端（用于影刀 API 等业务请求，30s 超时）
pub fn get_client() -> &'static Client {
    SHARED_CLIENT.get_or_init(|| {
        Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(Duration::from_secs(30))
            .build()
            .expect("创建HTTP客户端失败")
    })
}

/// 获取共享的更新检查 / 下载客户端（GitHub API & Release 资源，长超时 + 多重定向）
pub fn get_updater_client() -> &'static Client {
    UPDATER_CLIENT.get_or_init(|| {
        Client::builder()
            .user_agent("yingdao-updater")
            .redirect(reqwest::redirect::Policy::limited(10))
            .timeout(Duration::from_secs(300))
            .build()
            .expect("创建更新客户端失败")
    })
}

/// 为请求构建器附加通用认证 headers
pub fn with_auth(builder: RequestBuilder, token: &str) -> RequestBuilder {
    builder
        .header("Connection", "Keep-Alive")
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Accept", "*/*")
        .header("Accept-Language", "zh-cn")
        .header("Authorization", format!("bearer {}", token))
        .header("User-Agent", "Mozilla/4.0 (compatible; MSIE 9.0; Windows NT 6.1)")
}

/// 为请求构建器附加通用 headers（无认证）
pub fn with_common_headers(builder: RequestBuilder) -> RequestBuilder {
    builder
        .header("Connection", "Keep-Alive")
        .header("Accept", "*/*")
        .header("Accept-Language", "zh-cn")
        .header("User-Agent", "Mozilla/4.0 (compatible; MSIE 9.0; Windows NT 6.1)")
}
