//! RSA 加密和认证模块
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use rsa::{RsaPublicKey, pkcs8::DecodePublicKey, Pkcs1v15Encrypt};
use serde::{Deserialize, Serialize};

/// RSA 公钥 (从 xbot 软件提取)
const RSA_PUBLIC_KEY_PEM: &str = r#"-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCte0XfPY9GUpQ3ZasH1kVbDhRw
yRAqWSeyxj290OqFHtyiZ+5SQjrEr79mk0hcZqV03fb5oYf385E3gopSERIKxVQy
GoloNeDgyLu7rHHWMPo8KPDpUBlpRpHlGMgBNzJZ2BI6p7LvGAhCoA7XRuetyTlA
W6EbSXBpSu1sNGBhkQIDAQAB
-----END PUBLIC KEY-----"#;

/// 使用 RSA 公钥加密密码
pub fn encrypt_password(password: &str) -> Result<String, String> {
    let public_key = RsaPublicKey::from_public_key_pem(RSA_PUBLIC_KEY_PEM)
        .map_err(|e| format!("解析公钥失败: {}", e))?;
    
    let mut rng = rand::thread_rng();
    let encrypted = public_key
        .encrypt(&mut rng, Pkcs1v15Encrypt, password.as_bytes())
        .map_err(|e| format!("加密失败: {}", e))?;
    
    Ok(BASE64.encode(&encrypted))
}

/// 登录响应
#[derive(Debug, Deserialize)]
pub struct LoginResponse {
    pub success: Option<bool>,
    pub access_token: Option<String>,
    pub msg: Option<String>,
}

/// 登录账号并获取 access_token
pub async fn login(username: &str, password: &str) -> Result<String, String> {
    let encrypted_password = encrypt_password(password)?;
    
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;
    
    let params = [
        ("username", username),
        ("password", &encrypted_password),
        ("crypt", "metal"),
        ("grant_type", "password"),
        ("scope", "all"),
    ];
    
    let response = client
        .post("https://api.yingdao.com/oauth/token")
        .header("Connection", "Keep-Alive")
        .header("Content-Type", "application/x-www-form-urlencoded; Charset=UTF-8")
        .header("Accept", "*/*")
        .header("Accept-Language", "zh-cn")
        .header("Authorization", "basic c25zOlQ3c3ZGY0lMNGZvUGoxajk=")
        .header("Referer", "https://api.yingdao.com/oauth/token")
        .header("User-Agent", "Mozilla/4.0 (compatible; MSIE 9.0; Windows NT 6.1)")
        .header("Host", "api.yingdao.com")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("登录请求失败: {}", e))?;
    
    let text = response.text().await.map_err(|e| format!("读取响应失败: {}", e))?;
    
    // 处理可能的多个 JSON 响应
    let json_text = if text.contains("}{") {
        text.split("}{").next().unwrap_or(&text).to_string() + "}"
    } else {
        text
    };
    
    let result: LoginResponse = serde_json::from_str(&json_text)
        .map_err(|e| format!("解析响应失败: {} - {}", e, json_text))?;
    
    if result.success.unwrap_or(false) {
        if let Some(token) = result.access_token {
            return Ok(token);
        }
    }
    
    Err(result.msg.unwrap_or_else(|| "登录失败".to_string()))
}
