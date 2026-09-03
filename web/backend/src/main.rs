mod accounts;
mod app;
mod auth;
mod jobs;
mod migration;
mod source;
mod yingdao;

use std::{
    env,
    io::{self, Read},
    net::SocketAddr,
    path::PathBuf,
};

use accounts::{load_or_create_key, AccountService};
use anyhow::{bail, Context, Result};
use auth::AuthService;
use jobs::JobService;
use migration::MigrationEngine;
use source::SourceService;
use tokio::net::TcpListener;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;
use yingdao::YingdaoClient;

const DEFAULT_BIND_ADDR: &str = "127.0.0.1:18080";

#[tokio::main]
async fn main() -> Result<()> {
    if env::args().nth(1).as_deref() == Some("--hash-password") {
        return hash_password_from_stdin();
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("yingdao_web=info")),
        )
        .init();

    let bind_addr: SocketAddr = env::var("YINGDAO_BIND_ADDR")
        .unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_owned())
        .parse()?;
    let static_dir = env::var_os("YINGDAO_STATIC_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(default_static_dir);
    let database_path = env::var_os("YINGDAO_DATABASE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(default_database_path);
    let account_key_path = env::var_os("YINGDAO_ACCOUNT_KEY_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(default_account_key_path);
    let temp_root = env::var_os("YINGDAO_TEMP_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(default_temp_root);
    let cookie_secure = env::var("YINGDAO_COOKIE_SECURE")
        .map(|value| value != "false" && value != "0")
        .unwrap_or(false);
    let auth = AuthService::open(&database_path, cookie_secure)?;
    let source = SourceService::new()?;
    let yingdao = YingdaoClient::new()?;
    let account_key = load_or_create_key(&account_key_path)?;
    let accounts = AccountService::new(auth.database(), account_key)?;
    let migration = MigrationEngine::new(temp_root, yingdao.clone())?;
    migration.remove_abandoned_temp_files()?;
    let jobs = JobService::new(
        auth.database(),
        accounts.clone(),
        yingdao.clone(),
        migration,
    )?;
    jobs.start_worker();

    if !auth.has_users()? {
        match (
            env::var("YINGDAO_BOOTSTRAP_ADMIN_USERNAME").ok(),
            env::var("YINGDAO_BOOTSTRAP_ADMIN_PASSWORD_HASH").ok(),
        ) {
            (Some(username), Some(password_hash)) => {
                if auth.bootstrap_admin(&username, &password_hash)? {
                    info!(username, "bootstrap administrator created");
                }
            }
            _ => warn!(
                path = %database_path.display(),
                "no users exist; configure bootstrap administrator variables"
            ),
        }
    }

    if !static_dir.join("index.html").is_file() {
        warn!(path = %static_dir.display(), "frontend build is missing; API will still be available");
    }

    let listener = TcpListener::bind(bind_addr).await?;
    info!(address = %bind_addr, static_dir = %static_dir.display(), "yingdao web server started");

    axum::serve(
        listener,
        app::build_app(static_dir, auth, source, accounts, yingdao, jobs),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    Ok(())
}

fn default_static_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend/dist")
}

fn default_database_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("data/yingdao-web.sqlite3")
}

fn default_account_key_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("data/account.key")
}

fn default_temp_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("data/tmp")
}

fn hash_password_from_stdin() -> Result<()> {
    let mut password = String::new();
    io::stdin()
        .read_to_string(&mut password)
        .context("failed to read password from stdin")?;
    while password.ends_with(['\r', '\n']) {
        password.pop();
    }
    if password.is_empty() {
        bail!("password must not be empty");
    }
    println!("{}", auth::hash_password(&password)?);
    Ok(())
}

async fn shutdown_signal() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        warn!(%error, "failed to install shutdown signal handler");
    }
}
