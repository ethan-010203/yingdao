use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::Path,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng, Payload},
    Aes256Gcm, Nonce,
};
use anyhow::{anyhow, bail, Context, Result};
use axum::{
    extract::{Path as AxumPath, Query, State},
    http::{header::CACHE_CONTROL, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroize;

use crate::{
    app::AppState,
    auth::SharedDatabase,
    yingdao::{FlowPage, YingdaoError},
};

const KEY_BYTES: usize = 32;

#[derive(Clone)]
pub struct AccountService {
    database: SharedDatabase,
    cipher: Arc<Aes256Gcm>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    pub id: String,
    pub display_name: String,
    pub username_masked: String,
    pub status: String,
    pub last_verified_at: Option<i64>,
    pub last_error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub struct AccountCredentials {
    pub username: String,
    pub password: String,
}

impl Drop for AccountCredentials {
    fn drop(&mut self) {
        self.password.zeroize();
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateAccountRequest {
    display_name: String,
    username: String,
    password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateAccountRequest {
    display_name: Option<String>,
    username: Option<String>,
    password: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FlowQuery {
    #[serde(default)]
    q: String,
    #[serde(default = "default_page")]
    page: u32,
    #[serde(default = "default_page_size")]
    page_size: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteFlowsRequest {
    app_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteFlowsResponse {
    success_count: usize,
    failure_count: usize,
    results: Vec<DeleteFlowResult>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteFlowResult {
    app_id: String,
    success: bool,
    error: Option<&'static str>,
}

#[derive(Serialize)]
struct ApiError {
    error: &'static str,
}

impl AccountService {
    pub fn new(database: SharedDatabase, key: [u8; KEY_BYTES]) -> Result<Self> {
        let service = Self {
            database,
            cipher: Arc::new(Aes256Gcm::new_from_slice(&key).expect("AES-256 key length is fixed")),
        };
        service.initialize()?;
        Ok(service)
    }

    fn initialize(&self) -> Result<()> {
        self.connection().execute_batch(
            "
            CREATE TABLE IF NOT EXISTS yingdao_accounts (
                id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                username TEXT NOT NULL UNIQUE COLLATE BINARY,
                password_nonce BLOB NOT NULL,
                password_ciphertext BLOB NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('verified', 'invalid', 'unknown')),
                last_verified_at INTEGER,
                last_error TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS yingdao_accounts_updated_at_idx
            ON yingdao_accounts(updated_at DESC);
            ",
        )?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<AccountView>> {
        let connection = self.connection();
        let mut statement = connection.prepare(
            "SELECT id, display_name, username, status, last_verified_at, last_error, created_at, updated_at
             FROM yingdao_accounts ORDER BY display_name COLLATE NOCASE, created_at",
        )?;
        let rows = statement.query_map([], account_view_from_row)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("failed to list Yingdao accounts")
    }

    pub fn get(&self, id: &str) -> Result<Option<AccountView>> {
        self.connection()
            .query_row(
                "SELECT id, display_name, username, status, last_verified_at, last_error, created_at, updated_at
                 FROM yingdao_accounts WHERE id = ?1",
                params![id],
                account_view_from_row,
            )
            .optional()
            .context("failed to read Yingdao account")
    }

    pub fn create(
        &self,
        display_name: &str,
        username: &str,
        password: &str,
    ) -> Result<AccountView> {
        validate_fields(display_name, username, password)?;
        let id = Uuid::new_v4().to_string();
        let (nonce, ciphertext) = self.encrypt(&id, password)?;
        let now = unix_timestamp();
        self.connection()
            .execute(
                "INSERT INTO yingdao_accounts
                 (id, display_name, username, password_nonce, password_ciphertext, status,
                  last_verified_at, last_error, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'verified', ?6, NULL, ?6, ?6)",
                params![
                    id,
                    display_name.trim(),
                    username.trim(),
                    nonce,
                    ciphertext,
                    now
                ],
            )
            .map_err(|error| map_database_error(error, "failed to create Yingdao account"))?;
        self.get(&id)?
            .ok_or_else(|| anyhow!("created Yingdao account could not be read"))
    }

    pub fn update(
        &self,
        id: &str,
        display_name: &str,
        username: &str,
        password: &str,
    ) -> Result<Option<AccountView>> {
        validate_fields(display_name, username, password)?;
        let (nonce, ciphertext) = self.encrypt(id, password)?;
        let now = unix_timestamp();
        let changed = self
            .connection()
            .execute(
                "UPDATE yingdao_accounts
                 SET display_name = ?2, username = ?3, password_nonce = ?4,
                     password_ciphertext = ?5, status = 'verified', last_verified_at = ?6,
                     last_error = NULL, updated_at = ?6
                 WHERE id = ?1",
                params![
                    id,
                    display_name.trim(),
                    username.trim(),
                    nonce,
                    ciphertext,
                    now
                ],
            )
            .map_err(|error| map_database_error(error, "failed to update Yingdao account"))?;
        if changed == 0 {
            return Ok(None);
        }
        self.get(id)
    }

    pub fn delete(&self, id: &str) -> Result<bool> {
        self.connection()
            .execute("DELETE FROM yingdao_accounts WHERE id = ?1", params![id])
            .map(|changed| changed > 0)
            .map_err(|error| map_database_error(error, "failed to delete Yingdao account"))
    }

    pub fn credentials(&self, id: &str) -> Result<Option<AccountCredentials>> {
        let record = self
            .connection()
            .query_row(
                "SELECT username, password_nonce, password_ciphertext
                 FROM yingdao_accounts WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Vec<u8>>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((username, nonce, ciphertext)) = record else {
            return Ok(None);
        };
        let password_bytes = self
            .cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &ciphertext,
                    aad: id.as_bytes(),
                },
            )
            .map_err(|_| anyhow!("failed to decrypt Yingdao account credentials"))?;
        let password = String::from_utf8(password_bytes)
            .context("decrypted Yingdao password is not valid UTF-8")?;
        Ok(Some(AccountCredentials { username, password }))
    }

    pub fn mark_verification(
        &self,
        id: &str,
        success: bool,
        error: Option<&str>,
    ) -> Result<Option<AccountView>> {
        let now = unix_timestamp();
        self.connection().execute(
            "UPDATE yingdao_accounts
             SET status = ?2,
                 last_verified_at = CASE WHEN ?3 THEN ?4 ELSE last_verified_at END,
                 last_error = ?5,
                 updated_at = ?4
             WHERE id = ?1",
            params![
                id,
                if success { "verified" } else { "invalid" },
                success,
                now,
                error
            ],
        )?;
        self.get(id)
    }

    pub fn exists(&self, id: &str) -> Result<bool> {
        let count: i64 = self.connection().query_row(
            "SELECT COUNT(*) FROM yingdao_accounts WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    fn encrypt(&self, id: &str, password: &str) -> Result<(Vec<u8>, Vec<u8>)> {
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = self
            .cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: password.as_bytes(),
                    aad: id.as_bytes(),
                },
            )
            .map_err(|_| anyhow!("failed to encrypt Yingdao account credentials"))?;
        Ok((nonce.to_vec(), ciphertext))
    }

    fn connection(&self) -> std::sync::MutexGuard<'_, rusqlite::Connection> {
        self.database
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }
}

pub fn load_or_create_key(path: &Path) -> Result<[u8; KEY_BYTES]> {
    if path.exists() {
        let mut bytes = Vec::new();
        fs::File::open(path)
            .with_context(|| format!("failed to open account key {}", path.display()))?
            .read_to_end(&mut bytes)?;
        if bytes.len() != KEY_BYTES {
            bail!("account key must contain exactly {KEY_BYTES} bytes");
        }
        let mut key = [0_u8; KEY_BYTES];
        key.copy_from_slice(&bytes);
        bytes.zeroize();
        return Ok(key);
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "failed to create account key directory {}",
                parent.display()
            )
        })?;
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .with_context(|| format!("failed to create account key {}", path.display()))?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let mut key = [0_u8; KEY_BYTES];
    key[..nonce.len()].copy_from_slice(&nonce);
    use rand::RngCore;
    rand::rngs::OsRng.fill_bytes(&mut key[nonce.len()..]);
    file.write_all(&key)?;
    file.sync_all()?;
    Ok(key)
}

pub(crate) async fn list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(response) = require_auth(&state, &headers) {
        return response;
    }
    match state.accounts.list() {
        Ok(accounts) => no_store_json(StatusCode::OK, accounts),
        Err(_) => error_response(StatusCode::INTERNAL_SERVER_ERROR, "accounts_unavailable"),
    }
}

pub(crate) async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut input): Json<CreateAccountRequest>,
) -> Response {
    if let Some(response) = require_auth(&state, &headers) {
        input.password.zeroize();
        return response;
    }
    if validate_fields(&input.display_name, &input.username, &input.password).is_err() {
        input.password.zeroize();
        return error_response(StatusCode::BAD_REQUEST, "invalid_account");
    }
    let login = state
        .yingdao
        .login(input.username.trim(), &input.password)
        .await;
    match login {
        Ok(mut token) => {
            token.zeroize();
            let result =
                state
                    .accounts
                    .create(&input.display_name, &input.username, &input.password);
            input.password.zeroize();
            match result {
                Ok(account) => no_store_json(StatusCode::CREATED, account),
                Err(error) if error.to_string().contains("account_already_exists") => {
                    error_response(StatusCode::CONFLICT, "account_already_exists")
                }
                Err(_) => {
                    error_response(StatusCode::INTERNAL_SERVER_ERROR, "account_create_failed")
                }
            }
        }
        Err(error) => {
            input.password.zeroize();
            yingdao_error_response(error)
        }
    }
}

pub(crate) async fn update(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(mut input): Json<UpdateAccountRequest>,
) -> Response {
    if let Some(response) = require_auth(&state, &headers) {
        if let Some(password) = input.password.as_mut() {
            password.zeroize();
        }
        return response;
    }
    let Some(mut current) = state.accounts.credentials(&id).ok().flatten() else {
        return error_response(StatusCode::NOT_FOUND, "account_not_found");
    };
    let current_view = match state.accounts.get(&id) {
        Ok(Some(account)) => account,
        _ => return error_response(StatusCode::NOT_FOUND, "account_not_found"),
    };
    let display_name = input
        .display_name
        .as_deref()
        .unwrap_or(&current_view.display_name)
        .trim()
        .to_owned();
    let username = input
        .username
        .as_deref()
        .unwrap_or(&current.username)
        .trim()
        .to_owned();
    let mut password = input
        .password
        .take()
        .unwrap_or_else(|| current.password.clone());
    current.password.zeroize();
    if validate_fields(&display_name, &username, &password).is_err() {
        password.zeroize();
        return error_response(StatusCode::BAD_REQUEST, "invalid_account");
    }
    let login = state.yingdao.login(&username, &password).await;
    if let Err(error) = login {
        password.zeroize();
        return yingdao_error_response(error);
    }
    state.yingdao.invalidate(&id);
    let result = state
        .accounts
        .update(&id, &display_name, &username, &password);
    password.zeroize();
    match result {
        Ok(Some(account)) => no_store_json(StatusCode::OK, account),
        Ok(None) => error_response(StatusCode::NOT_FOUND, "account_not_found"),
        Err(error) if error.to_string().contains("account_already_exists") => {
            error_response(StatusCode::CONFLICT, "account_already_exists")
        }
        Err(_) => error_response(StatusCode::INTERNAL_SERVER_ERROR, "account_update_failed"),
    }
}

pub(crate) async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Response {
    if let Some(response) = require_auth(&state, &headers) {
        return response;
    }
    match state.accounts.delete(&id) {
        Ok(true) => {
            state.yingdao.invalidate(&id);
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(false) => error_response(StatusCode::NOT_FOUND, "account_not_found"),
        Err(error) if error.to_string().contains("FOREIGN KEY") => {
            error_response(StatusCode::CONFLICT, "account_in_use")
        }
        Err(_) => error_response(StatusCode::INTERNAL_SERVER_ERROR, "account_delete_failed"),
    }
}

pub(crate) async fn verify(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Response {
    if let Some(response) = require_auth(&state, &headers) {
        return response;
    }
    let Some(credentials) = state.accounts.credentials(&id).ok().flatten() else {
        return error_response(StatusCode::NOT_FOUND, "account_not_found");
    };
    state.yingdao.invalidate(&id);
    match state
        .yingdao
        .token_for(&id, &credentials.username, &credentials.password)
        .await
    {
        Ok(_) => match state.accounts.mark_verification(&id, true, None) {
            Ok(Some(account)) => no_store_json(StatusCode::OK, account),
            _ => error_response(StatusCode::INTERNAL_SERVER_ERROR, "account_verify_failed"),
        },
        Err(error) => {
            let _ = state
                .accounts
                .mark_verification(&id, false, Some(error.code()));
            yingdao_error_response(error)
        }
    }
}

pub(crate) async fn flows(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Query(query): Query<FlowQuery>,
) -> Response {
    if let Some(response) = require_auth(&state, &headers) {
        return response;
    }
    let Some(credentials) = state.accounts.credentials(&id).ok().flatten() else {
        return error_response(StatusCode::NOT_FOUND, "account_not_found");
    };
    let token = match state
        .yingdao
        .token_for(&id, &credentials.username, &credentials.password)
        .await
    {
        Ok(token) => token,
        Err(error) => return yingdao_error_response(error),
    };
    match state
        .yingdao
        .list_flows(&token, &query.q, query.page, query.page_size)
        .await
    {
        Ok(page) => no_store_json::<FlowPage>(StatusCode::OK, page),
        Err(error) => {
            if matches!(error, YingdaoError::Unauthorized) {
                state.yingdao.invalidate(&id);
            }
            yingdao_error_response(error)
        }
    }
}

pub(crate) async fn delete_flows(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(input): Json<DeleteFlowsRequest>,
) -> Response {
    if let Some(response) = require_auth(&state, &headers) {
        return response;
    }
    if validate_flow_ids(&input.app_ids).is_err() {
        return error_response(StatusCode::BAD_REQUEST, "invalid_flow_selection");
    }
    let Some(credentials) = state.accounts.credentials(&id).ok().flatten() else {
        return error_response(StatusCode::NOT_FOUND, "account_not_found");
    };
    let token = match state
        .yingdao
        .token_for(&id, &credentials.username, &credentials.password)
        .await
    {
        Ok(token) => token,
        Err(error) => return yingdao_error_response(error),
    };

    let mut results = Vec::with_capacity(input.app_ids.len());
    for app_id in input.app_ids {
        let result = state.yingdao.delete_flow(&token, &app_id).await;
        let unauthorized = matches!(result, Err(YingdaoError::Unauthorized));
        results.push(DeleteFlowResult {
            app_id,
            success: result.is_ok(),
            error: result.err().map(YingdaoError::code),
        });
        if unauthorized {
            state.yingdao.invalidate(&id);
        }
    }
    let success_count = results.iter().filter(|result| result.success).count();
    no_store_json(
        StatusCode::OK,
        DeleteFlowsResponse {
            success_count,
            failure_count: results.len() - success_count,
            results,
        },
    )
}

fn require_auth(state: &AppState, headers: &HeaderMap) -> Option<Response> {
    match state.auth.authenticated_session_key(headers) {
        Ok(Some(_)) => None,
        Ok(None) => Some(error_response(
            StatusCode::UNAUTHORIZED,
            "not_authenticated",
        )),
        Err(_) => Some(error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "authentication_failed",
        )),
    }
}

fn yingdao_error_response(error: YingdaoError) -> Response {
    let status = match error {
        YingdaoError::CredentialsRejected => StatusCode::UNPROCESSABLE_ENTITY,
        YingdaoError::Unauthorized => StatusCode::BAD_GATEWAY,
        _ => StatusCode::BAD_GATEWAY,
    };
    error_response(status, error.code())
}

fn validate_fields(display_name: &str, username: &str, password: &str) -> Result<()> {
    if display_name.trim().is_empty() || display_name.chars().count() > 64 {
        bail!("invalid display name");
    }
    if username.trim().is_empty() || username.chars().count() > 128 {
        bail!("invalid username");
    }
    if password.is_empty() || password.len() > 1024 {
        bail!("invalid password");
    }
    Ok(())
}

fn validate_flow_ids(app_ids: &[String]) -> Result<()> {
    if app_ids.is_empty() || app_ids.len() > 50 {
        bail!("invalid flow count");
    }
    let mut unique = HashSet::with_capacity(app_ids.len());
    if app_ids.iter().any(|app_id| {
        let trimmed = app_id.trim();
        trimmed.is_empty() || trimmed.len() > 128 || !unique.insert(trimmed)
    }) {
        bail!("invalid flow id");
    }
    Ok(())
}

fn account_view_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AccountView> {
    let username: String = row.get(2)?;
    Ok(AccountView {
        id: row.get(0)?,
        display_name: row.get(1)?,
        username_masked: mask_username(&username),
        status: row.get(3)?,
        last_verified_at: row.get(4)?,
        last_error: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn map_database_error(error: rusqlite::Error, context: &'static str) -> anyhow::Error {
    if error.to_string().contains("UNIQUE constraint failed") {
        anyhow!("account_already_exists")
    } else {
        anyhow!(error).context(context)
    }
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

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn default_page() -> u32 {
    1
}

fn default_page_size() -> u32 {
    10
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
    use crate::auth::AuthService;

    #[test]
    fn credentials_are_encrypted_and_can_be_decrypted() {
        let auth = AuthService::open_in_memory(false).expect("auth database should open");
        let service =
            AccountService::new(auth.database(), [9_u8; 32]).expect("account service should open");
        let account = service
            .create("主账号", "19375216067", "secret-password")
            .expect("account should be created");
        assert_eq!(account.username_masked, "19*******67");
        let credentials = service
            .credentials(&account.id)
            .expect("credentials should load")
            .expect("account should exist");
        assert_eq!(credentials.password, "secret-password");

        let connection = auth.database();
        let encrypted: Vec<u8> = connection
            .lock()
            .expect("database lock should open")
            .query_row(
                "SELECT password_ciphertext FROM yingdao_accounts WHERE id = ?1",
                params![account.id],
                |row| row.get(0),
            )
            .expect("ciphertext should load");
        assert!(!String::from_utf8_lossy(&encrypted).contains("secret-password"));
    }

    #[test]
    fn flow_deletion_selection_is_bounded_and_unique() {
        assert!(validate_flow_ids(&["flow-1".to_owned(), "flow-2".to_owned()]).is_ok());
        assert!(validate_flow_ids(&[]).is_err());
        assert!(validate_flow_ids(&["same".to_owned(), "same".to_owned()]).is_err());
        assert!(
            validate_flow_ids(&(0..51).map(|index| index.to_string()).collect::<Vec<_>>()).is_err()
        );
    }
}
