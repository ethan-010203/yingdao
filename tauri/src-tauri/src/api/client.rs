//! HTTP 客户端工具
use reqwest::Client;

/// 创建配置好的 HTTP 客户端
pub fn create_client() -> Result<Client, String> {
    Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))
}

/// 获取带认证的请求头
pub fn get_auth_headers(token: &str) -> Vec<(&'static str, String)> {
    vec![
        ("Connection", "Keep-Alive".to_string()),
        ("Content-Type", "application/json; charset=utf-8".to_string()),
        ("Accept", "*/*".to_string()),
        ("Accept-Language", "zh-cn".to_string()),
        ("Authorization", format!("bearer {}", token)),
        ("User-Agent", "Mozilla/4.0 (compatible; MSIE 9.0; Windows NT 6.1)".to_string()),
    ]
}
