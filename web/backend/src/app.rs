use std::{path::PathBuf, sync::Arc, time::Instant};

use axum::{
    body::Body,
    extract::State,
    http::{
        header::{CONTENT_SECURITY_POLICY, REFERRER_POLICY, X_CONTENT_TYPE_OPTIONS},
        HeaderValue, Request, StatusCode,
    },
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Json, Router,
};
use serde::Serialize;
use tower_http::{
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};

use crate::accounts::{self, AccountService};
use crate::auth::{self, AuthService};
use crate::jobs::{self, JobService};
use crate::source::{self, SourceService};
use crate::yingdao::YingdaoClient;

const SERVICE_NAME: &str = "yingdao-web";

#[derive(Clone)]
pub(crate) struct AppState {
    started_at: Arc<Instant>,
    pub(crate) auth: AuthService,
    pub(crate) source: SourceService,
    pub(crate) accounts: AccountService,
    pub(crate) yingdao: YingdaoClient,
    pub(crate) jobs: JobService,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    version: &'static str,
    uptime_seconds: u64,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: &'static str,
}

pub fn build_app(
    static_dir: PathBuf,
    auth: AuthService,
    source: SourceService,
    accounts: AccountService,
    yingdao: YingdaoClient,
    jobs: JobService,
) -> Router {
    let state = AppState {
        started_at: Arc::new(Instant::now()),
        auth,
        source,
        accounts,
        yingdao,
        jobs,
    };
    let index_file = static_dir.join("index.html");
    let static_files = ServeDir::new(static_dir).not_found_service(ServeFile::new(index_file));

    let api = Router::new()
        .route("/health", get(health))
        .route("/auth/login", post(auth::login))
        .route("/auth/me", get(auth::me))
        .route("/auth/logout", post(auth::logout))
        .route("/source", get(source::status))
        .route("/source/connect", post(source::connect))
        .route("/source/select", post(source::select_flow))
        .route("/source/disconnect", post(source::disconnect))
        .route("/accounts", get(accounts::list).post(accounts::create))
        .route(
            "/accounts/{id}",
            patch(accounts::update).delete(accounts::delete),
        )
        .route("/accounts/{id}/verify", post(accounts::verify))
        .route("/accounts/{id}/flows", get(accounts::flows))
        .route("/accounts/{id}/flows/delete", post(accounts::delete_flows))
        .route("/migrations", get(jobs::list).post(jobs::create))
        .route("/migrations/{id}", get(jobs::detail))
        .route("/migrations/{id}/retry", post(jobs::retry))
        .route("/diagnostics", get(jobs::diagnostics))
        .fallback(api_not_found);

    Router::new()
        .nest("/api", api)
        .fallback_service(static_files)
        .with_state(state)
        .layer(SetResponseHeaderLayer::if_not_present(
            X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            REFERRER_POLICY,
            HeaderValue::from_static("no-referrer"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(
                "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
            ),
        ))
        .layer(TraceLayer::new_for_http())
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: SERVICE_NAME,
        version: env!("CARGO_PKG_VERSION"),
        uptime_seconds: state.started_at.elapsed().as_secs(),
    })
}

async fn api_not_found(_request: Request<Body>) -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: "api_not_found",
        }),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use http_body_util::BodyExt;
    use serde_json::Value;
    use tower::ServiceExt;

    const TEST_PASSWORD: &str = "correct horse battery staple";

    fn test_app(cookie_secure: bool) -> Router {
        let auth = AuthService::open_in_memory(cookie_secure).expect("in-memory auth should open");
        let password_hash = auth::hash_password(TEST_PASSWORD).expect("password should hash");
        auth.bootstrap_admin("Ethan", &password_hash)
            .expect("admin should bootstrap");
        let source = SourceService::new().expect("source service should open");
        let accounts =
            AccountService::new(auth.database(), [7_u8; 32]).expect("account service should open");
        let yingdao = YingdaoClient::new().expect("Yingdao client should open");
        let temp_root =
            std::env::temp_dir().join(format!("yingdao-web-test-{}", uuid::Uuid::new_v4()));
        let migration = crate::migration::MigrationEngine::new(temp_root, yingdao.clone())
            .expect("migration engine should open");
        let jobs = JobService::new(
            auth.database(),
            accounts.clone(),
            yingdao.clone(),
            migration,
        )
        .expect("job service should open");
        build_app(
            PathBuf::from("missing-static-directory"),
            auth,
            source,
            accounts,
            yingdao,
            jobs,
        )
    }

    #[tokio::test]
    async fn health_endpoint_reports_ready() {
        let response = test_app(false)
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .expect("request should be valid"),
            )
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(X_CONTENT_TYPE_OPTIONS),
            Some(&HeaderValue::from_static("nosniff"))
        );

        let body = response
            .into_body()
            .collect()
            .await
            .expect("response body should be readable")
            .to_bytes();
        let payload: Value = serde_json::from_slice(&body).expect("health response should be JSON");

        assert_eq!(payload["status"], "ok");
        assert_eq!(payload["service"], SERVICE_NAME);
    }

    #[tokio::test]
    async fn unknown_api_route_returns_json_404() {
        let response = test_app(false)
            .oneshot(
                Request::builder()
                    .uri("/api/unknown")
                    .body(Body::empty())
                    .expect("request should be valid"),
            )
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn source_endpoint_requires_an_authenticated_admin_session() {
        let response = test_app(false)
            .oneshot(
                Request::builder()
                    .uri("/api/source")
                    .body(Body::empty())
                    .expect("request should be valid"),
            )
            .await
            .expect("request should succeed");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response.headers().get("cache-control"),
            Some(&HeaderValue::from_static("no-store"))
        );
    }

    #[tokio::test]
    async fn login_creates_secure_session_and_me_restores_it() {
        let app = test_app(true);
        let login_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/auth/login")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        r#"{{"username":"Ethan","password":"{TEST_PASSWORD}"}}"#
                    )))
                    .expect("request should be valid"),
            )
            .await
            .expect("login should complete");

        assert_eq!(login_response.status(), StatusCode::OK);
        let set_cookie = login_response
            .headers()
            .get("set-cookie")
            .expect("session cookie should be present")
            .to_str()
            .expect("session cookie should be valid");
        assert!(set_cookie.contains("HttpOnly"));
        assert!(set_cookie.contains("SameSite=Strict"));
        assert!(set_cookie.contains("Secure"));
        let cookie = set_cookie
            .split(';')
            .next()
            .expect("cookie value should be present")
            .to_owned();

        let me_response = app
            .oneshot(
                Request::builder()
                    .uri("/api/auth/me")
                    .header("cookie", cookie)
                    .body(Body::empty())
                    .expect("request should be valid"),
            )
            .await
            .expect("me request should complete");

        assert_eq!(me_response.status(), StatusCode::OK);
        let body = me_response
            .into_body()
            .collect()
            .await
            .expect("response body should be readable")
            .to_bytes();
        let payload: Value = serde_json::from_slice(&body).expect("me response should be JSON");
        assert_eq!(payload["user"]["username"], "Ethan");
        assert_eq!(payload["user"]["role"], "admin");
    }

    #[tokio::test]
    async fn login_rejects_wrong_password() {
        let response = test_app(false)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/auth/login")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"username":"Ethan","password":"wrong password"}"#,
                    ))
                    .expect("request should be valid"),
            )
            .await
            .expect("login should complete");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response.headers().get("cache-control"),
            Some(&HeaderValue::from_static("no-store"))
        );
    }
}
