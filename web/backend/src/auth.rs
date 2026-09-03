use std::{
    collections::{HashMap, VecDeque},
    fs,
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, bail, Context, Result};
use argon2::{
    password_hash::{rand_core::OsRng as PasswordOsRng, PasswordHash, SaltString},
    Argon2, PasswordHasher, PasswordVerifier,
};
use axum::{
    extract::State,
    http::{
        header::{CACHE_CONTROL, COOKIE, SET_COOKIE},
        HeaderMap, HeaderValue, StatusCode,
    },
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

use crate::app::AppState;

pub(crate) type SharedDatabase = Arc<Mutex<Connection>>;

const SESSION_COOKIE: &str = "yingdao_session";
const SESSION_TTL_SECONDS: i64 = 12 * 60 * 60;
const LOGIN_WINDOW: Duration = Duration::from_secs(15 * 60);
const MAX_LOGIN_FAILURES: usize = 5;

#[derive(Clone)]
pub struct AuthService {
    database: SharedDatabase,
    attempts: Arc<Mutex<HashMap<String, VecDeque<Instant>>>>,
    dummy_password_hash: Arc<String>,
    cookie_secure: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct UserInfo {
    pub username: String,
    pub role: String,
}

#[derive(Debug)]
struct UserRecord {
    id: i64,
    username: String,
    password_hash: String,
    role: String,
}

#[derive(Deserialize)]
pub(crate) struct LoginRequest {
    username: String,
    password: String,
}

#[derive(Serialize)]
struct AuthResponse {
    user: UserInfo,
}

#[derive(Serialize)]
struct ApiError {
    error: &'static str,
}

#[derive(Serialize)]
struct LogoutResponse {
    ok: bool,
}

impl AuthService {
    pub fn open(database_path: &Path, cookie_secure: bool) -> Result<Self> {
        if let Some(parent) = database_path.parent() {
            fs::create_dir_all(parent).with_context(|| {
                format!("failed to create database directory {}", parent.display())
            })?;
        }

        let connection = Connection::open(database_path)
            .with_context(|| format!("failed to open database {}", database_path.display()))?;
        Self::from_connection(connection, cookie_secure)
    }

    #[cfg(test)]
    pub fn open_in_memory(cookie_secure: bool) -> Result<Self> {
        Self::from_connection(Connection::open_in_memory()?, cookie_secure)
    }

    fn from_connection(connection: Connection, cookie_secure: bool) -> Result<Self> {
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE COLLATE BINARY,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token_hash BLOB PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
            ",
        )?;

        Ok(Self {
            database: Arc::new(Mutex::new(connection)),
            attempts: Arc::new(Mutex::new(HashMap::new())),
            dummy_password_hash: Arc::new(hash_password("dummy-password-for-timing-only")?),
            cookie_secure,
        })
    }

    pub fn bootstrap_admin(&self, username: &str, password_hash: &str) -> Result<bool> {
        validate_username(username)?;
        PasswordHash::new(password_hash)
            .map_err(|error| anyhow!("invalid bootstrap password hash: {error}"))?;

        let connection = self.connection();
        let user_count: i64 =
            connection.query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))?;
        if user_count > 0 {
            return Ok(false);
        }

        connection.execute(
            "INSERT INTO users (username, password_hash, role, created_at) VALUES (?1, ?2, 'admin', ?3)",
            params![username, password_hash, unix_timestamp()],
        )?;
        Ok(true)
    }

    pub fn has_users(&self) -> Result<bool> {
        let connection = self.connection();
        let count: i64 =
            connection.query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))?;
        Ok(count > 0)
    }

    pub(crate) fn database(&self) -> SharedDatabase {
        Arc::clone(&self.database)
    }

    fn find_user(&self, username: &str) -> Result<Option<UserRecord>> {
        let connection = self.connection();
        connection
            .query_row(
                "SELECT id, username, password_hash, role FROM users WHERE username = ?1",
                params![username],
                |row| {
                    Ok(UserRecord {
                        id: row.get(0)?,
                        username: row.get(1)?,
                        password_hash: row.get(2)?,
                        role: row.get(3)?,
                    })
                },
            )
            .optional()
            .context("failed to query user")
    }

    fn create_session(&self, user_id: i64) -> Result<String> {
        let mut token_bytes = [0_u8; 32];
        OsRng.fill_bytes(&mut token_bytes);
        let token = URL_SAFE_NO_PAD.encode(token_bytes);
        token_bytes.zeroize();
        let token_hash = hash_session_token(&token);
        let now = unix_timestamp();

        let connection = self.connection();
        connection.execute("DELETE FROM sessions WHERE expires_at <= ?1", params![now])?;
        connection.execute(
            "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
            params![token_hash, user_id, now, now + SESSION_TTL_SECONDS],
        )?;

        Ok(token)
    }

    fn authenticated_user(&self, token: &str) -> Result<Option<UserInfo>> {
        let token_hash = hash_session_token(token);
        let now = unix_timestamp();
        let connection = self.connection();
        connection.execute("DELETE FROM sessions WHERE expires_at <= ?1", params![now])?;

        connection
            .query_row(
                "
                SELECT users.username, users.role
                FROM sessions
                INNER JOIN users ON users.id = sessions.user_id
                WHERE sessions.token_hash = ?1 AND sessions.expires_at > ?2
                ",
                params![token_hash, now],
                |row| {
                    Ok(UserInfo {
                        username: row.get(0)?,
                        role: row.get(1)?,
                    })
                },
            )
            .optional()
            .context("failed to query session")
    }

    pub(crate) fn authenticated_session_key(&self, headers: &HeaderMap) -> Result<Option<Vec<u8>>> {
        let Some(token) = session_token(headers) else {
            return Ok(None);
        };
        if self.authenticated_user(token)?.is_none() {
            return Ok(None);
        }
        Ok(Some(hash_session_token(token)))
    }

    fn delete_session(&self, token: &str) -> Result<()> {
        let token_hash = hash_session_token(token);
        self.connection().execute(
            "DELETE FROM sessions WHERE token_hash = ?1",
            params![token_hash],
        )?;
        Ok(())
    }

    fn is_rate_limited(&self, key: &str) -> bool {
        let now = Instant::now();
        let mut attempts = self
            .attempts
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let failures = attempts.entry(key.to_owned()).or_default();
        failures.retain(|attempt| now.duration_since(*attempt) < LOGIN_WINDOW);
        failures.len() >= MAX_LOGIN_FAILURES
    }

    fn record_failure(&self, key: &str) {
        let now = Instant::now();
        let mut attempts = self
            .attempts
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let failures = attempts.entry(key.to_owned()).or_default();
        failures.retain(|attempt| now.duration_since(*attempt) < LOGIN_WINDOW);
        failures.push_back(now);
    }

    fn clear_failures(&self, key: &str) {
        self.attempts
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(key);
    }

    fn session_cookie(&self, token: &str) -> String {
        let secure = if self.cookie_secure { "; Secure" } else { "" };
        format!(
            "{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_TTL_SECONDS}{secure}"
        )
    }

    fn expired_cookie(&self) -> String {
        let secure = if self.cookie_secure { "; Secure" } else { "" };
        format!("{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{secure}")
    }

    fn connection(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.database
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }
}

pub fn hash_password(password: &str) -> Result<String> {
    if password.len() < 8 {
        bail!("password must contain at least 8 characters");
    }
    let salt = SaltString::generate(&mut PasswordOsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| anyhow!("failed to hash password: {error}"))
}

pub(crate) async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut input): Json<LoginRequest>,
) -> Response {
    let username = input.username.trim().to_owned();
    let rate_limit_key = login_rate_limit_key(&headers, &username);
    if username.is_empty() || username.len() > 64 || input.password.len() > 1024 {
        input.password.zeroize();
        return error_response(StatusCode::UNAUTHORIZED, "invalid_credentials");
    }
    if state.auth.is_rate_limited(&rate_limit_key) {
        input.password.zeroize();
        return error_response(StatusCode::TOO_MANY_REQUESTS, "rate_limited");
    }

    let user = match state.auth.find_user(&username) {
        Ok(user) => user,
        Err(_) => {
            input.password.zeroize();
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, "authentication_failed");
        }
    };
    let password_hash = user
        .as_ref()
        .map(|record| record.password_hash.clone())
        .unwrap_or_else(|| (*state.auth.dummy_password_hash).clone());
    let mut password = input.password;
    let verified = tokio::task::spawn_blocking(move || {
        let result = verify_password(&password, &password_hash);
        password.zeroize();
        result
    })
    .await
    .unwrap_or(false);

    let Some(user) = user.filter(|_| verified) else {
        state.auth.record_failure(&rate_limit_key);
        return error_response(StatusCode::UNAUTHORIZED, "invalid_credentials");
    };

    state.auth.clear_failures(&rate_limit_key);
    let token = match state.auth.create_session(user.id) {
        Ok(token) => token,
        Err(_) => {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, "authentication_failed")
        }
    };
    let cookie = state.auth.session_cookie(&token);

    response_with_cookie(
        StatusCode::OK,
        &cookie,
        AuthResponse {
            user: UserInfo {
                username: user.username,
                role: user.role,
            },
        },
    )
}

pub(crate) async fn me(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Some(token) = session_token(&headers) else {
        return error_response(StatusCode::UNAUTHORIZED, "not_authenticated");
    };

    match state.auth.authenticated_user(token) {
        Ok(Some(user)) => no_store_json(StatusCode::OK, AuthResponse { user }),
        Ok(None) => error_response(StatusCode::UNAUTHORIZED, "not_authenticated"),
        Err(_) => error_response(StatusCode::INTERNAL_SERVER_ERROR, "authentication_failed"),
    }
}

pub(crate) async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(token) = session_token(&headers) {
        state.source.disconnect_session(&hash_session_token(token));
        if state.auth.delete_session(token).is_err() {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, "logout_failed");
        }
    }

    response_with_cookie(
        StatusCode::OK,
        &state.auth.expired_cookie(),
        LogoutResponse { ok: true },
    )
}

fn validate_username(username: &str) -> Result<()> {
    if username.is_empty() || username.len() > 64 {
        bail!("username must contain between 1 and 64 characters");
    }
    Ok(())
}

fn verify_password(password: &str, password_hash: &str) -> bool {
    PasswordHash::new(password_hash)
        .ok()
        .and_then(|hash| {
            Argon2::default()
                .verify_password(password.as_bytes(), &hash)
                .ok()
        })
        .is_some()
}

fn session_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .filter_map(|cookie| cookie.trim().split_once('='))
        .find_map(|(name, value)| (name == SESSION_COOKIE).then_some(value))
}

fn login_rate_limit_key(headers: &HeaderMap, username: &str) -> String {
    let client_ip = headers
        .get("cf-connecting-ip")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .unwrap_or("direct");
    format!("{client_ip}:{}", username.to_ascii_lowercase())
}

pub(crate) fn hash_session_token(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
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

fn response_with_cookie<T: Serialize>(status: StatusCode, cookie: &str, payload: T) -> Response {
    let mut response = no_store_json(status, payload);
    if let Ok(value) = HeaderValue::from_str(cookie) {
        response.headers_mut().insert(SET_COOKIE, value);
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_hashes_are_salted_and_verifiable() {
        let first = hash_password("correct horse battery staple").expect("hash should succeed");
        let second = hash_password("correct horse battery staple").expect("hash should succeed");

        assert_ne!(first, second);
        assert!(verify_password("correct horse battery staple", &first));
        assert!(!verify_password("wrong password", &first));
    }
}
