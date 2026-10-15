//! The fauth fixture application: three handlers' worth of declared props, shaped like an
//! authentication service's pages (a tenant's hosted login, the platform's get-started page
//! and a results page), each bound to its route at start. The pages are shaped after the service's; labels and values are synthetic.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use forma_fixture_apps as fixture;
use forma_ir::PageProps;
use forma_server::{PageHandle, RenderCtx};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "out/fauth/dist/"]
struct Assets;

#[derive(PageProps, Clone, Copy, PartialEq)]
enum Provider {
    #[props(rename = "google")]
    Google,
    #[props(rename = "github")]
    Github,
    #[props(rename = "email")]
    Email,
}

#[derive(PageProps, Clone, Copy, PartialEq)]
enum SignupMode {
    #[props(rename = "public")]
    Public,
    #[props(rename = "invite_only")]
    InviteOnly,
}

#[derive(PageProps)]
struct TenantLoginProps {
    slug: String,
    app_name: String,
    logo_url: Option<String>,
    has_logo: bool,
    primary_color: String,
    providers: Vec<Provider>,
    signup_mode: SignupMode,
    login_redirect_url: String,
    start_login: bool,
    start_register: bool,
    has_google: bool,
    has_github: bool,
    // `hasOAuth` is how the page spells it; the derive's snake-to-camel rule would write `hasOauth`.
    #[props(rename = "hasOAuth")]
    has_oauth: bool,
    has_email: bool,
    invite_only: bool,
    allow_public_signup: bool,
    invite_notice: String,
}

#[derive(PageProps)]
struct OnboardingProps {
    client_id: String,
    server_url: Option<String>,
    has_google: bool,
    has_github: bool,
    // `hasOAuth` is how the page spells it; the derive's snake-to-camel rule would write `hasOauth`.
    #[props(rename = "hasOAuth")]
    has_oauth: bool,
}

#[derive(PageProps)]
struct BenchmarkRow {
    id: u32,
    name: String,
    score: f64,
    verdict: String,
    passed: bool,
    failure: Option<String>,
}

#[derive(PageProps)]
enum SortColumn {
    #[props(rename = "name")]
    Name,
    #[props(rename = "score")]
    Score,
}

#[derive(PageProps)]
struct BenchmarkProps {
    rows: Vec<BenchmarkRow>,
    row_count: u32,
    failure_count: u32,
    query: String,
    sort_column: SortColumn,
    has_rows: bool,
    no_rows: bool,
    error: Option<String>,
    has_error: bool,
}

struct App {
    login: PageHandle<TenantLoginProps>,
    onboarding: PageHandle<OnboardingProps>,
    benchmark: PageHandle<BenchmarkProps>,
}

/// The tenant table a hosted-login handler would read from its store.
struct Tenant {
    name: &'static str,
    logo: Option<&'static str>,
    color: &'static str,
    providers: &'static [Provider],
    signup: SignupMode,
}

fn tenant(slug: &str) -> Option<Tenant> {
    match slug {
        "acme" => Some(Tenant {
            name: "Acme Cloud",
            logo: Some("/fixture/logo.svg"),
            color: "#4a6fa5",
            providers: &[Provider::Google, Provider::Github, Provider::Email],
            signup: SignupMode::Public,
        }),
        "lockbox" => Some(Tenant {
            name: "Lockbox",
            logo: None,
            color: "#3f8f6b",
            providers: &[Provider::Email],
            signup: SignupMode::InviteOnly,
        }),
        // A tenant who names itself with markup and script: it must reach the page as text.
        "quote" => Some(Tenant {
            name: "\";alert(1);//</script><b>bold</b>",
            logo: None,
            color: "#aa3377",
            providers: &[Provider::Email],
            signup: SignupMode::Public,
        }),
        _ => None,
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let start = fixture::load::<Assets>();
    let login = fixture::bind::<TenantLoginProps>(&start.pages, "/t/:slug/login");
    let onboarding = fixture::bind::<OnboardingProps>(&start.pages, "/platform/onboarding");
    let benchmark = fixture::bind::<BenchmarkProps>(&start.pages, "/platform/benchmark");
    fixture::finalize(&start.pages);
    let router = Router::new()
        .route("/t/{slug}/login", get(login_page))
        .route("/platform/onboarding", get(onboarding_page))
        .route("/platform/benchmark", get(benchmark_page))
        .route("/fixture/logo.svg", get(logo))
        .with_state(Arc::new(App {
            login,
            onboarding,
            benchmark,
        }));
    fixture::serve(fixture::with_assets::<Assets>(router)).await;
}

async fn login_page(
    State(app): State<Arc<App>>,
    Path(slug): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let Some(tenant) = tenant(&slug) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let has = |provider: Provider| tenant.providers.contains(&provider);
    let invite_only = tenant.signup == SignupMode::InviteOnly;
    // An invite link opens sign-up on an invite-only tenant, as the hosted page does.
    let invited = query.contains_key("invite_token");
    let allow_public_signup = !invite_only || invited;
    let start_register =
        query.get("mode").map(String::as_str) == Some("register") && allow_public_signup;
    let invite_notice = if !invite_only {
        String::new()
    } else if allow_public_signup {
        "An invitation was found. You may sign in or register with it.".to_string()
    } else {
        "Registration here is by invitation only. Ask for an invitation link.".to_string()
    };
    let props = TenantLoginProps {
        slug: slug.clone(),
        app_name: tenant.name.into(),
        logo_url: tenant.logo.map(Into::into),
        has_logo: tenant.logo.is_some(),
        primary_color: tenant.color.into(),
        providers: tenant.providers.to_vec(),
        signup_mode: tenant.signup,
        login_redirect_url: format!("/t/{slug}/"),
        start_login: !start_register,
        start_register,
        has_google: has(Provider::Google),
        has_github: has(Provider::Github),
        has_oauth: has(Provider::Google) || has(Provider::Github),
        has_email: has(Provider::Email),
        invite_only,
        allow_public_signup,
        invite_notice,
    };
    fixture::respond(app.login.render(
        &props,
        &RenderCtx::new().with_title(format!("{} Sign in", tenant.name)),
    ))
}

async fn onboarding_page(State(app): State<Arc<App>>) -> Response {
    let props = OnboardingProps {
        client_id: "onboarding-client".into(),
        server_url: Some("https://auth.example.test".into()),
        has_google: true,
        has_github: false,
        has_oauth: true,
    };
    fixture::respond(
        app.onboarding
            .render(&props, &RenderCtx::new().with_title("Get started")),
    )
}

async fn benchmark_page(
    State(app): State<Arc<App>>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    // The filter and the sort the old page did in the browser are the handler's now.
    let needle = query.get("q").cloned().unwrap_or_else(|| "gate".into());
    let by_name = query.get("sort").map(String::as_str) == Some("name");
    let mut rows = vec![
        BenchmarkRow {
            id: 1,
            name: "gate-allow".into(),
            score: 98.5,
            verdict: "pass".into(),
            passed: true,
            failure: None,
        },
        BenchmarkRow {
            id: 2,
            name: "gate-deny".into(),
            score: 71.25,
            verdict: "pass".into(),
            passed: true,
            failure: None,
        },
        BenchmarkRow {
            id: 3,
            name: "gate-timeout".into(),
            score: 12.0,
            verdict: "fail".into(),
            passed: false,
            failure: Some("timed out after 30 s".into()),
        },
    ];
    rows.retain(|row| row.name.contains(&needle));
    if by_name {
        rows.sort_by(|a, b| a.name.cmp(&b.name));
    } else {
        rows.sort_by(|a, b| b.score.total_cmp(&a.score));
    }
    let props = BenchmarkProps {
        row_count: rows.len() as u32,
        failure_count: rows.iter().filter(|row| !row.passed).count() as u32,
        has_rows: !rows.is_empty(),
        no_rows: rows.is_empty(),
        rows,
        query: needle,
        sort_column: if by_name {
            SortColumn::Name
        } else {
            SortColumn::Score
        },
        error: None,
        has_error: false,
    };
    fixture::respond(
        app.benchmark
            .render(&props, &RenderCtx::new().with_title("Benchmark")),
    )
}

/// A tenant's uploaded logo, standing in for the object store the real handler links.
async fn logo() -> impl IntoResponse {
    (
        [
            (axum::http::header::CONTENT_TYPE, "image/svg+xml"),
            (axum::http::header::CACHE_CONTROL, "no-store"),
        ],
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\"><rect width=\"24\" height=\"24\" fill=\"#4a6fa5\"/></svg>",
    )
}
