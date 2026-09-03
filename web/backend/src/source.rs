use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use axum::{
    extract::State,
    http::{header::CACHE_CONTROL, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use reqwest::Client;
use rsa::{pkcs8::DecodePublicKey, Pkcs1v15Encrypt, RsaPublicKey};
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

use crate::app::AppState;

const LOGIN_URL: &str = "https://api.yingdao.com/oauth/token";
const API_BASE_URL: &str = "https://api.winrobot360.com";
const SOURCE_SESSION_TTL: Duration = Duration::from_secs(45 * 60);
const MAX_FLOW_PAGES: u32 = 100;
const PAGE_SIZE: u32 = 30;
const RSA_PUBLIC_KEY_PEM: &str = r#"-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCte0XfPY9GUpQ3ZasH1kVbDhRw
yRAqWSeyxj290OqFHtyiZ+5SQjrEr79mk0hcZqV03fb5oYf385E3gopSERIKxVQy
GoloNeDgyLu7rHHWMPo8KPDpUBlpRpHlGMgBNzJZ2BI6p7LvGAhCoA7XRuetyTlA
W6EbSXBpSu1sNGBhkQIDAQAB
-----END PUBLIC KEY-----"#;

#[derive(Clone)]
pub struct SourceService {
    client: Client,
    login_url: Arc<str>,
    api_base_url: Arc<str>,
    connections: Arc<Mutex<HashMap<Vec<u8>, SourceConnection>>>,
}

struct SourceConnection {
    token: String,
    account_label: String,
    flows: Vec<CloudFlow>,
    selected_app_id: Option<String>,
    expires_at: Instant,
}

impl Drop for SourceConnection {
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

#[derive(Deserialize)]
pub(crate) struct ConnectRequest {
    username: String,
    password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SelectFlowRequest {
    app_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceSnapshot {
    connected: bool,
    account_label: Option<String>,
    flows: Vec<CloudFlow>,
    selected_app_id: Option<String>,
}

#[derive(Serialize)]
struct ApiError {
    error: &'static str,
}

#[derive(Deserialize)]
struct LoginResponse {
    success: Option<bool>,
    access_token: Option<String>,
}

#[derive(Deserialize)]
struct FlowListResponse {
    success: bool,
    data: Option<Vec<CloudFlow>>,
    page: Option<PageInfo>,
}

#[derive(Deserialize)]
struct PageInfo {
    pages: u32,
}

#[derive(Debug)]
enum ConnectError {
    InvalidInput,
    CredentialsRejected,
    UpstreamUnavailable,
}

impl SourceService {
    pub fn new() -> Result<Self> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(40))
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .context("failed to create Yingdao HTTP client")?;
        Ok(Self {
            client,
            login_url: Arc::from(LOGIN_URL),
            api_base_url: Arc::from(API_BASE_URL),
            connections: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    async fn connect(
        &self,
        session_key: Vec<u8>,
        username: String,
        mut password: String,
    ) -> std::result::Result<SourceSnapshot, ConnectError> {
        let username = username.trim().to_owned();
        if username.is_empty()
            || username.len() > 128
            || password.is_empty()
            || password.len() > 1024
        {
            password.zeroize();
            return Err(ConnectError::InvalidInput);
        }

        let encrypted_password = encrypt_password(&password).map_err(|_| {
            password.zeroize();
            ConnectError::UpstreamUnavailable
        })?;
        password.zeroize();
        let token = self.login(&username, &encrypted_password).await?;
        let flows = self.list_flows(&token).await?;
        let snapshot = SourceSnapshot {
            connected: true,
            account_label: Some(mask_username(&username)),
            flows: flows.clone(),
            selected_app_id: None,
        };

        self.connections().insert(
            session_key,
            SourceConnection {
                token,
                account_label: mask_username(&username),
                flows,
                selected_app_id: None,
                expires_at: Instant::now() + SOURCE_SESSION_TTL,
            },
        );
        Ok(snapshot)
    }

    async fn login(
        &self,
        username: &str,
        encrypted_password: &str,
    ) -> std::result::Result<String, ConnectError> {
        let response = self
            .client
            .post(self.login_url.as_ref())
            .header("Connection", "Keep-Alive")
            .header(
                "Content-Type",
                "application/x-www-form-urlencoded; Charset=UTF-8",
            )
            .header("Accept", "*/*")
            .header("Accept-Language", "zh-cn")
            .header("Authorization", "basic c25zOlQ3c3ZGY0lMNGZvUGoxajk=")
            .header("Referer", self.login_url.as_ref())
            .header(
                "User-Agent",
                "Mozilla/4.0 (compatible; MSIE 9.0; Windows NT 6.1)",
            )
            .form(&[
                ("username", username),
                ("password", encrypted_password),
                ("crypt", "metal"),
                ("grant_type", "password"),
                ("scope", "all"),
            ])
            .send()
            .await
            .map_err(|_| ConnectError::UpstreamUnavailable)?;

        if !response.status().is_success() {
            return Err(ConnectError::UpstreamUnavailable);
        }
        let text = response
            .text()
            .await
            .map_err(|_| ConnectError::UpstreamUnavailable)?;
        let json_text = text
            .split_once("}{")
            .map(|(first, _)| format!("{first}}}"))
            .unwrap_or(text);
        let result: LoginResponse =
            serde_json::from_str(&json_text).map_err(|_| ConnectError::UpstreamUnavailable)?;

        if result.success.unwrap_or(false) {
            if let Some(token) = result.access_token.filter(|token| !token.is_empty()) {
                return Ok(token);
            }
        }
        Err(ConnectError::CredentialsRejected)
    }

    async fn list_flows(&self, token: &str) -> std::result::Result<Vec<CloudFlow>, ConnectError> {
        let mut flows = Vec::new();
        let mut page = 1;
        let mut total_pages = 1;

        while page <= total_pages {
            let response = self
                .client
                .post(format!("{}/api/client/app/develop/list", self.api_base_url))
                .header("Connection", "Keep-Alive")
                .header("Content-Type", "application/json; charset=utf-8")
                .header("Accept", "*/*")
                .header("Accept-Language", "zh-cn")
                .header("Authorization", format!("bearer {token}"))
                .header(
                    "User-Agent",
                    "Mozilla/4.0 (compatible; MSIE 9.0; Windows NT 6.1)",
                )
                .json(&serde_json::json!({
                    "groupId": null,
                    "name": "",
                    "pageType": 1,
                    "pageDTO": {"page": page, "size": PAGE_SIZE},
                    "sortBy": "4"
                }))
                .send()
                .await
                .map_err(|_| ConnectError::UpstreamUnavailable)?;

            if !response.status().is_success() {
                return Err(ConnectError::UpstreamUnavailable);
            }
            let result: FlowListResponse = response
                .json()
                .await
                .map_err(|_| ConnectError::UpstreamUnavailable)?;
            if !result.success {
                return Err(ConnectError::UpstreamUnavailable);
            }
            flows.extend(result.data.unwrap_or_default());

            total_pages = result.page.map(|info| info.pages.max(1)).unwrap_or(1);
            if total_pages > MAX_FLOW_PAGES {
                return Err(ConnectError::UpstreamUnavailable);
            }
            page += 1;
        }

        Ok(flows)
    }

    fn snapshot(&self, session_key: &[u8]) -> SourceSnapshot {
        let mut connections = self.connections();
        remove_expired(&mut connections);
        match connections.get(session_key) {
            Some(connection) => SourceSnapshot {
                connected: true,
                account_label: Some(connection.account_label.clone()),
                flows: connection.flows.clone(),
                selected_app_id: connection.selected_app_id.clone(),
            },
            None => disconnected_snapshot(),
        }
    }

    fn select(&self, session_key: &[u8], app_id: &str) -> Option<SourceSnapshot> {
        let mut connections = self.connections();
        remove_expired(&mut connections);
        let connection = connections.get_mut(session_key)?;
        if !connection.flows.iter().any(|flow| flow.app_id == app_id) {
            return None;
        }
        connection.selected_app_id = Some(app_id.to_owned());
        Some(SourceSnapshot {
            connected: true,
            account_label: Some(connection.account_label.clone()),
            flows: connection.flows.clone(),
            selected_app_id: connection.selected_app_id.clone(),
        })
    }

    pub(crate) fn disconnect_session(&self, session_key: &[u8]) {
        self.connections().remove(session_key);
    }

    fn connections(&self) -> std::sync::MutexGuard<'_, HashMap<Vec<u8>, SourceConnection>> {
        self.connections
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }
}

pub(crate) async fn connect(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<ConnectRequest>,
) -> Response {
    let session_key = match authenticated_session_key(&state, &headers) {
        Ok(key) => key,
        Err(response) => return response,
    };

    match state
        .source
        .connect(session_key, input.username, input.password)
        .await
    {
        Ok(snapshot) => no_store_json(StatusCode::OK, snapshot),
        Err(ConnectError::InvalidInput) => {
            error_response(StatusCode::BAD_REQUEST, "invalid_source_credentials")
        }
        Err(ConnectError::CredentialsRejected) => {
            error_response(StatusCode::UNPROCESSABLE_ENTITY, "source_login_rejected")
        }
        Err(ConnectError::UpstreamUnavailable) => {
            error_response(StatusCode::BAD_GATEWAY, "source_service_unavailable")
        }
    }
}

pub(crate) async fn status(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let session_key = match authenticated_session_key(&state, &headers) {
        Ok(key) => key,
        Err(response) => return response,
    };
    no_store_json(StatusCode::OK, state.source.snapshot(&session_key))
}

pub(crate) async fn select_flow(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<SelectFlowRequest>,
) -> Response {
    let session_key = match authenticated_session_key(&state, &headers) {
        Ok(key) => key,
        Err(response) => return response,
    };
    match state.source.select(&session_key, &input.app_id) {
        Some(snapshot) => no_store_json(StatusCode::OK, snapshot),
        None => error_response(StatusCode::BAD_REQUEST, "flow_not_found"),
    }
}

pub(crate) async fn disconnect(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let session_key = match authenticated_session_key(&state, &headers) {
        Ok(key) => key,
        Err(response) => return response,
    };
    state.source.disconnect_session(&session_key);
    no_store_json(StatusCode::OK, disconnected_snapshot())
}

fn authenticated_session_key(
    state: &AppState,
    headers: &HeaderMap,
) -> std::result::Result<Vec<u8>, Response> {
    match state.auth.authenticated_session_key(headers) {
        Ok(Some(key)) => Ok(key),
        Ok(None) => Err(error_response(
            StatusCode::UNAUTHORIZED,
            "not_authenticated",
        )),
        Err(_) => Err(error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "authentication_failed",
        )),
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

fn mask_username(username: &str) -> String {
    let characters: Vec<char> = username.chars().collect();
    if characters.len() <= 4 {
        return "*".repeat(characters.len());
    }
    format!(
        "{}{}{}",
        characters[..2].iter().collect::<String>(),
        "*".repeat(characters.len() - 4),
        characters[characters.len() - 2..]
            .iter()
            .collect::<String>()
    )
}

fn remove_expired(connections: &mut HashMap<Vec<u8>, SourceConnection>) {
    let now = Instant::now();
    connections.retain(|_, connection| connection.expires_at > now);
}

fn disconnected_snapshot() -> SourceSnapshot {
    SourceSnapshot {
        connected: false,
        account_label: None,
        flows: Vec::new(),
        selected_app_id: None,
    }
}

fn error_response(status: StatusCode, error: &'static str) -> Response {
    no_store_json(status, ApiError { error })
}

fn no_store_json<T: Serialize>(status: StatusCode, payload: T) -> Response {
    let mut response = (status, Json(payload)).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_encryption_uses_randomized_rsa_ciphertext() {
        let first = encrypt_password("example-password").expect("password should encrypt");
        let second = encrypt_password("example-password").expect("password should encrypt");
        assert_ne!(first, second);
        assert_eq!(
            BASE64
                .decode(first)
                .expect("ciphertext should decode")
                .len(),
            128
        );
    }

    #[test]
    fn usernames_are_masked_without_breaking_unicode() {
        assert_eq!(mask_username("19375216067"), "19*******67");
        assert_eq!(mask_username("用户账号六"), "用户*号六");
        assert_eq!(mask_username("abc"), "***");
    }
}
