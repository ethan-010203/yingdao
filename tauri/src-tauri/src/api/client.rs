//! HTTP 客户端工具
use reqwest::{Client, RequestBuilder};
use std::sync::OnceLock;

static SHARED_CLIENT: OnceLock<Client> = OnceLock::new();

/// 获取共享的 HTTP 客户端（单例，复用连接池）
pub fn get_client() -> &'static Client {
    SHARED_CLIENT.get_or_init(|| {
        Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("创建HTTP客户端失败")
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
