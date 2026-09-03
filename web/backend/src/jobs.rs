use std::{
    collections::HashSet,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{bail, Context, Result};
use axum::{
    extract::{Path, State},
    http::{header::CACHE_CONTROL, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use rusqlite::{params, types::Type, OptionalExtension};
use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::{
    accounts::AccountService,
    app::AppState,
    auth::SharedDatabase,
    migration::{render_target_name, MigrationEngine, MigrationFailure},
    yingdao::{YingdaoClient, YingdaoError},
};

const MAX_FLOWS_PER_JOB: usize = 10;

#[derive(Clone)]
pub struct JobService {
    database: SharedDatabase,
    accounts: AccountService,
    yingdao: YingdaoClient,
    engine: MigrationEngine,
    worker_started: Arc<std::sync::atomic::AtomicBool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateJobRequest {
    source_account_id: String,
    target_account_id: String,
    flows: Vec<FlowSelection>,
    #[serde(default)]
    name_template: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FlowSelection {
    app_id: String,
    app_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSummary {
    pub id: String,
    pub source_account_id: String,
    pub source_account_name: String,
    pub source_flow_names: Vec<String>,
    pub target_account_id: String,
    pub target_account_name: String,
    pub status: String,
    pub total_items: u32,
    pub completed_items: u32,
    pub failed_items: u32,
    pub current_stage: String,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobDetail {
    #[serde(flatten)]
    pub summary: JobSummary,
    pub items: Vec<JobItemView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobItemView {
    pub id: String,
    pub source_app_id: String,
    pub source_name: String,
    pub target_name: String,
    pub target_app_id: Option<String>,
    pub status: String,
    pub stage: String,
    pub progress: u32,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub attempt_count: u32,
    pub downloaded_bytes: u64,
    pub uploaded_bytes: u64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobStats {
    pub account_count: u32,
    pub queued_jobs: u32,
    pub running_jobs: u32,
    pub completed_jobs: u32,
    pub failed_jobs: u32,
    pub temp_usage_bytes: u64,
    pub worker_concurrency: u32,
}

#[derive(Serialize)]
struct ApiError {
    error: &'static str,
}

struct JobWork {
    id: String,
    source_account_id: String,
    target_account_id: String,
}

struct ItemWork {
    id: String,
    source_app_id: String,
    target_name: String,
}

impl JobService {
    pub fn new(
        database: SharedDatabase,
        accounts: AccountService,
        yingdao: YingdaoClient,
        engine: MigrationEngine,
    ) -> Result<Self> {
        let service = Self {
            database,
            accounts,
            yingdao,
            engine,
            worker_started: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        };
        service.initialize()?;
        Ok(service)
    }

    fn initialize(&self) -> Result<()> {
        let connection = self.connection();
        connection.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS migration_jobs (
                id TEXT PRIMARY KEY,
                source_account_id TEXT NOT NULL REFERENCES yingdao_accounts(id) ON DELETE RESTRICT,
                target_account_id TEXT NOT NULL REFERENCES yingdao_accounts(id) ON DELETE RESTRICT,
                status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'partial', 'failed')),
                total_items INTEGER NOT NULL,
                completed_items INTEGER NOT NULL DEFAULT 0,
                failed_items INTEGER NOT NULL DEFAULT 0,
                current_stage TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                started_at INTEGER,
                finished_at INTEGER,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS migration_job_items (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL REFERENCES migration_jobs(id) ON DELETE CASCADE,
                source_app_id TEXT NOT NULL,
                source_name TEXT NOT NULL,
                target_name TEXT NOT NULL,
                target_app_id TEXT,
                status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
                stage TEXT NOT NULL,
                progress INTEGER NOT NULL DEFAULT 0,
                error_code TEXT,
                error_message TEXT,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                downloaded_bytes INTEGER NOT NULL DEFAULT 0,
                uploaded_bytes INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                started_at INTEGER,
                finished_at INTEGER,
                updated_at INTEGER NOT NULL,
                UNIQUE(job_id, source_app_id)
            );

            CREATE INDEX IF NOT EXISTS migration_jobs_created_at_idx
            ON migration_jobs(created_at DESC);
            CREATE INDEX IF NOT EXISTS migration_job_items_job_idx
            ON migration_job_items(job_id, created_at);

            UPDATE migration_job_items
            SET status = 'queued', stage = 'queued', progress = 0, updated_at = unixepoch()
            WHERE status = 'running';
            UPDATE migration_jobs
            SET status = 'queued', current_stage = 'queued', updated_at = unixepoch()
            WHERE status = 'running';
            ",
        )?;
        Ok(())
    }

    pub fn start_worker(&self) {
        use std::sync::atomic::Ordering;
        if self.worker_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let service = self.clone();
        tokio::spawn(async move {
            info!("migration worker started");
            loop {
                match service.claim_next_job() {
                    Ok(Some(job)) => service.process_job(job).await,
                    Ok(None) => tokio::time::sleep(Duration::from_secs(1)).await,
                    Err(error) => {
                        error!(%error, "migration worker could not claim a job");
                        tokio::time::sleep(Duration::from_secs(3)).await;
                    }
                }
            }
        });
    }

    pub fn create(&self, input: CreateJobRequest) -> Result<JobDetail> {
        validate_job(&input)?;
        if !self.accounts.exists(&input.source_account_id)?
            || !self.accounts.exists(&input.target_account_id)?
        {
            bail!("account_not_found");
        }
        let id = Uuid::new_v4().to_string();
        let now = unix_timestamp();
        let mut connection = self.connection();
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO migration_jobs
             (id, source_account_id, target_account_id, status, total_items,
              completed_items, failed_items, current_stage, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'queued', ?4, 0, 0, 'queued', ?5, ?5)",
            params![
                id,
                input.source_account_id,
                input.target_account_id,
                input.flows.len() as u32,
                now
            ],
        )?;
        for flow in input.flows {
            transaction.execute(
                "INSERT INTO migration_job_items
                 (id, job_id, source_app_id, source_name, target_name, status,
                  stage, progress, attempt_count, downloaded_bytes, uploaded_bytes,
                  created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'queued', 'queued', 0, 0, 0, 0, ?6, ?6)",
                params![
                    Uuid::new_v4().to_string(),
                    id,
                    flow.app_id,
                    flow.app_name,
                    render_target_name(&input.name_template, &flow.app_name),
                    now
                ],
            )?;
        }
        transaction.commit()?;
        drop(connection);
        self.detail(&id)?
            .ok_or_else(|| anyhow::anyhow!("created migration job could not be read"))
    }

    pub fn list(&self) -> Result<Vec<JobSummary>> {
        let connection = self.connection();
        let mut statement = connection.prepare(&format!(
            "{JOB_SUMMARY_SQL} ORDER BY migration_jobs.created_at DESC, migration_jobs.id DESC"
        ))?;
        let rows = statement.query_map([], job_summary_from_row)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("failed to list migration jobs")
    }

    pub fn detail(&self, id: &str) -> Result<Option<JobDetail>> {
        let summary = self
            .connection()
            .query_row(
                &format!("{JOB_SUMMARY_SQL} AND migration_jobs.id = ?1"),
                params![id],
                job_summary_from_row,
            )
            .optional()?;
        let Some(summary) = summary else {
            return Ok(None);
        };
        let connection = self.connection();
        let mut statement = connection.prepare(
            "SELECT id, source_app_id, source_name, target_name, target_app_id,
                    status, stage, progress, error_code, error_message, attempt_count,
                    downloaded_bytes, uploaded_bytes, started_at, finished_at
             FROM migration_job_items WHERE job_id = ?1 ORDER BY created_at, id",
        )?;
        let rows = statement.query_map(params![id], |row| {
            Ok(JobItemView {
                id: row.get(0)?,
                source_app_id: row.get(1)?,
                source_name: row.get(2)?,
                target_name: row.get(3)?,
                target_app_id: row.get(4)?,
                status: row.get(5)?,
                stage: row.get(6)?,
                progress: row.get(7)?,
                error_code: row.get(8)?,
                error_message: row.get(9)?,
                attempt_count: row.get(10)?,
                downloaded_bytes: (row.get::<_, i64>(11)?).max(0) as u64,
                uploaded_bytes: (row.get::<_, i64>(12)?).max(0) as u64,
                started_at: row.get(13)?,
                finished_at: row.get(14)?,
            })
        })?;
        let items = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(Some(JobDetail { summary, items }))
    }

    pub fn retry(&self, id: &str) -> Result<Option<JobDetail>> {
        let now = unix_timestamp();
        let mut connection = self.connection();
        let transaction = connection.transaction()?;
        let retried = transaction.execute(
            "UPDATE migration_job_items
             SET status = 'queued', stage = 'queued', progress = 0,
                 error_code = NULL, error_message = NULL, started_at = NULL,
                 finished_at = NULL, updated_at = ?2
             WHERE job_id = ?1 AND status = 'failed'",
            params![id, now],
        )?;
        if retried > 0 {
            transaction.execute(
                "UPDATE migration_jobs
                 SET status = 'queued', current_stage = 'queued', failed_items = 0,
                     finished_at = NULL, updated_at = ?2 WHERE id = ?1",
                params![id, now],
            )?;
        }
        transaction.commit()?;
        drop(connection);
        self.detail(id)
    }

    pub fn stats(&self) -> Result<JobStats> {
        let connection = self.connection();
        let account_count =
            connection.query_row("SELECT COUNT(*) FROM yingdao_accounts", [], |row| {
                row.get(0)
            })?;
        let count_status = |status: &str| -> rusqlite::Result<u32> {
            connection.query_row(
                "SELECT COUNT(*) FROM migration_jobs WHERE status = ?1",
                params![status],
                |row| row.get(0),
            )
        };
        let queued_jobs = count_status("queued")?;
        let running_jobs = count_status("running")?;
        let completed_jobs = count_status("succeeded")?;
        let failed_jobs: u32 = connection.query_row(
            "SELECT COUNT(*) FROM migration_jobs WHERE status IN ('failed', 'partial')",
            [],
            |row| row.get(0),
        )?;
        drop(connection);
        Ok(JobStats {
            account_count,
            queued_jobs,
            running_jobs,
            completed_jobs,
            failed_jobs,
            temp_usage_bytes: self.engine.temp_usage_bytes(),
            worker_concurrency: 1,
        })
    }

    fn claim_next_job(&self) -> Result<Option<JobWork>> {
        let mut connection = self.connection();
        let transaction = connection.transaction()?;
        let job = transaction
            .query_row(
                "SELECT id, source_account_id, target_account_id
                 FROM migration_jobs WHERE status = 'queued'
                 ORDER BY created_at, id LIMIT 1",
                [],
                |row| {
                    Ok(JobWork {
                        id: row.get(0)?,
                        source_account_id: row.get(1)?,
                        target_account_id: row.get(2)?,
                    })
                },
            )
            .optional()?;
        if let Some(job) = &job {
            let now = unix_timestamp();
            transaction.execute(
                "UPDATE migration_jobs
                 SET status = 'running', current_stage = 'authenticating',
                     started_at = COALESCE(started_at, ?2), updated_at = ?2
                 WHERE id = ?1",
                params![job.id, now],
            )?;
        }
        transaction.commit()?;
        Ok(job)
    }

    async fn process_job(&self, job: JobWork) {
        info!(job_id = %job.id, "migration job started");
        let source = match self.accounts.credentials(&job.source_account_id) {
            Ok(Some(credentials)) => credentials,
            _ => {
                self.fail_remaining(&job.id, "source_account_unavailable", "无法读取源账号凭据");
                return;
            }
        };
        let target = match self.accounts.credentials(&job.target_account_id) {
            Ok(Some(credentials)) => credentials,
            _ => {
                self.fail_remaining(
                    &job.id,
                    "target_account_unavailable",
                    "无法读取目标账号凭据",
                );
                return;
            }
        };
        let source_token = match self
            .yingdao
            .token_for(&job.source_account_id, &source.username, &source.password)
            .await
        {
            Ok(token) => token,
            Err(error) => {
                self.fail_for_yingdao(&job.id, error);
                return;
            }
        };
        let target_token = match self
            .yingdao
            .token_for(&job.target_account_id, &target.username, &target.password)
            .await
        {
            Ok(token) => token,
            Err(error) => {
                self.fail_for_yingdao(&job.id, error);
                return;
            }
        };
        drop(source);
        drop(target);

        loop {
            let item = match self.next_item(&job.id) {
                Ok(Some(item)) => item,
                Ok(None) => break,
                Err(error) => {
                    error!(job_id = %job.id, %error, "failed to read migration item");
                    self.fail_remaining(&job.id, "database_error", "无法读取迁移任务");
                    return;
                }
            };
            self.start_item(&job.id, &item.id);
            let service = self.clone();
            let progress_job_id = job.id.clone();
            let progress_item_id = item.id.clone();
            let outcome = self
                .engine
                .migrate(
                    &job.id,
                    &item.id,
                    &source_token,
                    &target_token,
                    &item.source_app_id,
                    &item.target_name,
                    move |stage, progress, downloaded| {
                        service.update_progress(
                            &progress_job_id,
                            &progress_item_id,
                            stage,
                            progress,
                            downloaded,
                        );
                    },
                )
                .await;
            match outcome {
                Ok(outcome) => self.succeed_item(
                    &job.id,
                    &item.id,
                    &outcome.target_app_id,
                    outcome.downloaded_bytes,
                    outcome.uploaded_bytes,
                ),
                Err(failure) => {
                    warn!(job_id = %job.id, item_id = %item.id, code = failure.code, "migration item failed");
                    self.fail_item(&job.id, &item.id, failure);
                    if matches!(failure.code, "upstream_session_expired") {
                        self.yingdao.invalidate(&job.source_account_id);
                        self.yingdao.invalidate(&job.target_account_id);
                    }
                }
            }
        }
        self.finalize_job(&job.id);
        self.engine.cleanup_job(&job.id);
        info!(job_id = %job.id, "migration job finished");
    }

    fn next_item(&self, job_id: &str) -> Result<Option<ItemWork>> {
        self.connection()
            .query_row(
                "SELECT id, source_app_id, target_name FROM migration_job_items
                 WHERE job_id = ?1 AND status = 'queued' ORDER BY created_at, id LIMIT 1",
                params![job_id],
                |row| {
                    Ok(ItemWork {
                        id: row.get(0)?,
                        source_app_id: row.get(1)?,
                        target_name: row.get(2)?,
                    })
                },
            )
            .optional()
            .context("failed to read next migration item")
    }

    fn start_item(&self, job_id: &str, item_id: &str) {
        let now = unix_timestamp();
        let _ = self.connection().execute(
            "UPDATE migration_job_items
             SET status = 'running', stage = 'authenticating', progress = 2,
                 attempt_count = attempt_count + 1, started_at = ?3, finished_at = NULL,
                 error_code = NULL, error_message = NULL, updated_at = ?3
             WHERE id = ?2 AND job_id = ?1",
            params![job_id, item_id, now],
        );
    }

    fn update_progress(
        &self,
        job_id: &str,
        item_id: &str,
        stage: &str,
        progress: u32,
        downloaded_bytes: u64,
    ) {
        let now = unix_timestamp();
        let connection = self.connection();
        let _ = connection.execute(
            "UPDATE migration_job_items
             SET stage = ?3, progress = ?4, downloaded_bytes = MAX(downloaded_bytes, ?5), updated_at = ?6
             WHERE job_id = ?1 AND id = ?2",
            params![job_id, item_id, stage, progress, downloaded_bytes as i64, now],
        );
        let _ = connection.execute(
            "UPDATE migration_jobs SET current_stage = ?2, updated_at = ?3 WHERE id = ?1",
            params![job_id, stage, now],
        );
    }

    fn succeed_item(
        &self,
        job_id: &str,
        item_id: &str,
        target_app_id: &str,
        downloaded_bytes: u64,
        uploaded_bytes: u64,
    ) {
        let now = unix_timestamp();
        let _ = self.connection().execute(
            "UPDATE migration_job_items
             SET status = 'succeeded', stage = 'completed', progress = 100,
                 target_app_id = ?3, downloaded_bytes = ?4, uploaded_bytes = ?5,
                 finished_at = ?6, updated_at = ?6 WHERE job_id = ?1 AND id = ?2",
            params![
                job_id,
                item_id,
                target_app_id,
                downloaded_bytes as i64,
                uploaded_bytes as i64,
                now
            ],
        );
    }

    fn fail_item(&self, job_id: &str, item_id: &str, failure: MigrationFailure) {
        let now = unix_timestamp();
        let _ = self.connection().execute(
            "UPDATE migration_job_items
             SET status = 'failed', stage = 'failed', error_code = ?3,
                 error_message = ?4, finished_at = ?5, updated_at = ?5
             WHERE job_id = ?1 AND id = ?2",
            params![job_id, item_id, failure.code, failure.message, now],
        );
    }

    fn fail_for_yingdao(&self, job_id: &str, error: YingdaoError) {
        self.fail_remaining(job_id, error.code(), error.message());
    }

    fn fail_remaining(&self, job_id: &str, code: &'static str, message: &'static str) {
        let now = unix_timestamp();
        let connection = self.connection();
        let _ = connection.execute(
            "UPDATE migration_job_items SET status = 'failed', stage = 'failed',
             error_code = ?2, error_message = ?3, finished_at = ?4, updated_at = ?4
             WHERE job_id = ?1 AND status IN ('queued', 'running')",
            params![job_id, code, message, now],
        );
        drop(connection);
        self.finalize_job(job_id);
        self.engine.cleanup_job(job_id);
    }

    fn finalize_job(&self, job_id: &str) {
        let now = unix_timestamp();
        let connection = self.connection();
        let (succeeded, failed): (u32, u32) = connection
            .query_row(
                "SELECT
                    SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)
                 FROM migration_job_items WHERE job_id = ?1",
                params![job_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or((0, 0));
        let status = if failed == 0 {
            "succeeded"
        } else if succeeded == 0 {
            "failed"
        } else {
            "partial"
        };
        let _ = connection.execute(
            "UPDATE migration_jobs
             SET status = ?2, completed_items = ?3, failed_items = ?4,
                 current_stage = 'completed', finished_at = ?5, updated_at = ?5
             WHERE id = ?1",
            params![job_id, status, succeeded, failed, now],
        );
    }

    fn connection(&self) -> std::sync::MutexGuard<'_, rusqlite::Connection> {
        self.database
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }
}

pub(crate) async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<CreateJobRequest>,
) -> Response {
    if let Some(response) = require_auth(&state, &headers) {
        return response;
    }
    match state.jobs.create(input) {
        Ok(job) => no_store_json(StatusCode::CREATED, job),
        Err(error) if error.to_string().contains("account_not_found") => {
            error_response(StatusCode::BAD_REQUEST, "account_not_found")
        }
        Err(error) if error.to_string().contains("invalid_") => {
            error_response(StatusCode::BAD_REQUEST, "invalid_migration")
        }
        Err(_) => error_response(StatusCode::INTERNAL_SERVER_ERROR, "migration_create_failed"),
    }
}

pub(crate) async fn list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(response) = require_auth(&state, &headers) {
        return response;
    }
    match state.jobs.list() {
        Ok(jobs) => no_store_json(StatusCode::OK, jobs),
        Err(_) => error_response(StatusCode::INTERNAL_SERVER_ERROR, "migrations_unavailable"),
    }
}

pub(crate) async fn detail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Some(response) = require_auth(&state, &headers) {
        return response;
    }
    match state.jobs.detail(&id) {
        Ok(Some(job)) => no_store_json(StatusCode::OK, job),
        Ok(None) => error_response(StatusCode::NOT_FOUND, "migration_not_found"),
        Err(_) => error_response(StatusCode::INTERNAL_SERVER_ERROR, "migration_unavailable"),
    }
}

pub(crate) async fn retry(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Some(response) = require_auth(&state, &headers) {
        return response;
    }
    match state.jobs.retry(&id) {
        Ok(Some(job)) => no_store_json(StatusCode::OK, job),
        Ok(None) => error_response(StatusCode::NOT_FOUND, "migration_not_found"),
        Err(_) => error_response(StatusCode::INTERNAL_SERVER_ERROR, "migration_retry_failed"),
    }
}

pub(crate) async fn diagnostics(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(response) = require_auth(&state, &headers) {
        return response;
    }
    match state.jobs.stats() {
        Ok(stats) => no_store_json(StatusCode::OK, stats),
        Err(_) => error_response(StatusCode::INTERNAL_SERVER_ERROR, "diagnostics_unavailable"),
    }
}

fn validate_job(input: &CreateJobRequest) -> Result<()> {
    if input.source_account_id == input.target_account_id {
        bail!("invalid_same_account");
    }
    if input.flows.is_empty() || input.flows.len() > MAX_FLOWS_PER_JOB {
        bail!("invalid_flow_count");
    }
    if input.name_template.chars().count() > 200 {
        bail!("invalid_name_template");
    }
    let mut ids = HashSet::new();
    for flow in &input.flows {
        if flow.app_id.trim().is_empty()
            || flow.app_id.len() > 128
            || flow.app_name.trim().is_empty()
            || flow.app_name.chars().count() > 200
            || !ids.insert(flow.app_id.as_str())
        {
            bail!("invalid_flow");
        }
    }
    Ok(())
}

const JOB_SUMMARY_SQL: &str = "SELECT migration_jobs.id,
            migration_jobs.source_account_id, source.display_name,
            migration_jobs.target_account_id, target.display_name,
            migration_jobs.status, migration_jobs.total_items,
            migration_jobs.completed_items, migration_jobs.failed_items,
            migration_jobs.current_stage, migration_jobs.created_at,
            migration_jobs.started_at, migration_jobs.finished_at, migration_jobs.updated_at,
            COALESCE((SELECT json_group_array(source_name)
                      FROM migration_job_items
                      WHERE job_id = migration_jobs.id), '[]')
     FROM migration_jobs
     INNER JOIN yingdao_accounts AS source ON source.id = migration_jobs.source_account_id
     INNER JOIN yingdao_accounts AS target ON target.id = migration_jobs.target_account_id
     WHERE 1 = 1";

fn job_summary_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<JobSummary> {
    let source_flow_names_json: String = row.get(14)?;
    let source_flow_names = serde_json::from_str(&source_flow_names_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(14, Type::Text, Box::new(error))
    })?;
    Ok(JobSummary {
        id: row.get(0)?,
        source_account_id: row.get(1)?,
        source_account_name: row.get(2)?,
        source_flow_names,
        target_account_id: row.get(3)?,
        target_account_name: row.get(4)?,
        status: row.get(5)?,
        total_items: row.get(6)?,
        completed_items: row.get(7)?,
        failed_items: row.get(8)?,
        current_stage: row.get(9)?,
        created_at: row.get(10)?,
        started_at: row.get(11)?,
        finished_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{auth::AuthService, migration::MigrationEngine};
    use std::fs;

    #[test]
    fn jobs_are_persisted_with_multiple_items() {
        let auth = AuthService::open_in_memory(false).expect("database should open");
        let accounts =
            AccountService::new(auth.database(), [5_u8; 32]).expect("accounts should open");
        let source = accounts
            .create("源账号", "source-user", "source-password")
            .expect("source should be stored");
        let target = accounts
            .create("目标账号", "target-user", "target-password")
            .expect("target should be stored");
        let yingdao = YingdaoClient::new().expect("client should open");
        let temp_root = std::env::temp_dir().join(format!("yingdao-jobs-{}", Uuid::new_v4()));
        let engine =
            MigrationEngine::new(temp_root.clone(), yingdao.clone()).expect("engine should open");
        let jobs =
            JobService::new(auth.database(), accounts, yingdao, engine).expect("jobs should open");

        let created = jobs
            .create(CreateJobRequest {
                source_account_id: source.id,
                target_account_id: target.id,
                flows: vec![
                    FlowSelection {
                        app_id: "flow-1".to_owned(),
                        app_name: "流程一".to_owned(),
                    },
                    FlowSelection {
                        app_id: "flow-2".to_owned(),
                        app_name: "流程二".to_owned(),
                    },
                ],
                name_template: "{name}_copy".to_owned(),
            })
            .expect("job should be stored");
        assert_eq!(created.summary.status, "queued");
        assert_eq!(created.summary.total_items, 2);
        let mut source_names = created.summary.source_flow_names.clone();
        source_names.sort();
        assert_eq!(source_names, ["流程一", "流程二"]);
        assert_eq!(created.items.len(), 2);
        let mut target_names = created
            .items
            .iter()
            .map(|item| item.target_name.as_str())
            .collect::<Vec<_>>();
        target_names.sort();
        assert_eq!(target_names, ["流程一_copy", "流程二_copy"]);
        assert_eq!(jobs.list().expect("jobs should list").len(), 1);
        fs::remove_dir_all(temp_root).expect("test directory should be removed");
    }

    #[test]
    fn same_account_and_more_than_ten_flows_are_rejected() {
        let same = CreateJobRequest {
            source_account_id: "same".to_owned(),
            target_account_id: "same".to_owned(),
            flows: vec![FlowSelection {
                app_id: "1".to_owned(),
                app_name: "one".to_owned(),
            }],
            name_template: String::new(),
        };
        assert!(validate_job(&same).is_err());

        let too_many = CreateJobRequest {
            source_account_id: "source".to_owned(),
            target_account_id: "target".to_owned(),
            flows: (0..11)
                .map(|index| FlowSelection {
                    app_id: index.to_string(),
                    app_name: index.to_string(),
                })
                .collect(),
            name_template: String::new(),
        };
        assert!(validate_job(&too_many).is_err());
    }
}
