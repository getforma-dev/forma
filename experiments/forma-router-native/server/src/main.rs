//! Local-only FORMA-301 production API fixture. Not a production authentication example.
use axum::{
    extract::{Form, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
    Json, Router,
};
use forma_ir::PageProps;
use forma_server::{
    assets, load_ir_modules,
    navigation::{ACTION_MEDIA_TYPE, NAVIGATION_MEDIA_TYPE},
    ActionResponse, CspNonce, NavigationBranch, NavigationConfig, PageHandle, PolicyExtensions,
    RenderCtx, SealedNavigationPolicy,
};
use rust_embed::{Embed, EmbeddedFile};
use serde::Deserialize;
use serde_json::json;
use std::{
    borrow::Cow,
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
struct Files;
fn root() -> PathBuf {
    std::env::var_os("FORMA_NATIVE_DIST")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist"))
}
impl Embed for Files {
    fn get(name: &str) -> Option<EmbeddedFile> {
        if Path::new(name)
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
        {
            return None;
        }
        rust_embed::utils::read_file_from_fs(&root().join(name)).ok()
    }
    fn iter() -> impl Iterator<Item = Cow<'static, str>> {
        fn walk(path: &Path, prefix: &str, out: &mut Vec<Cow<'static, str>>) {
            if let Ok(entries) = std::fs::read_dir(path) {
                for entry in entries.flatten() {
                    let name = format!("{prefix}{}", entry.file_name().to_string_lossy());
                    if entry.path().is_dir() {
                        walk(&entry.path(), &format!("{name}/"), out);
                    } else {
                        out.push(Cow::Owned(name));
                    }
                }
            }
        }
        let mut files = Vec::new();
        walk(&root(), "", &mut files);
        files.into_iter()
    }
}
struct NextFiles;
impl Embed for NextFiles {
    fn get(name: &str) -> Option<EmbeddedFile> {
        if Path::new(name)
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
        {
            return None;
        }
        rust_embed::utils::read_file_from_fs(&root().with_file_name("dist-next").join(name)).ok()
    }
    fn iter() -> impl Iterator<Item = Cow<'static, str>> {
        std::fs::read_dir(root().with_file_name("dist-next"))
            .into_iter()
            .flatten()
            .flatten()
            .filter(|entry| entry.path().is_file())
            .map(|entry| Cow::Owned(entry.file_name().to_string_lossy().into_owned()))
            .collect::<Vec<_>>()
            .into_iter()
    }
}
async fn serve_asset(path: axum::extract::Path<String>, headers: HeaderMap) -> Response {
    if Files::get(&path.0).is_some() {
        assets::serve_asset::<Files>(path, headers).await
    } else {
        assets::serve_asset::<NextFiles>(path, headers).await
    }
}
#[derive(PageProps)]
struct Props {
    count: u32,
    name: String,
    csrf: String,
    error: String,
}
#[derive(PageProps)]
struct ShellProps {
    seed: u32,
}
#[derive(Default)]
struct Data {
    count: u32,
    name: String,
    posts: u32,
    gets: u32,
    context_generation: u32,
}
struct App {
    shell: PageHandle<ShellProps>,
    next_shell: PageHandle<ShellProps>,
    next_a: PageHandle<Props>,
    next_b: PageHandle<Props>,
    a: PageHandle<Props>,
    b: PageHandle<Props>,
    data: Mutex<Data>,
    csrf: String,
    session: String,
    origin: String,
}
fn accepts(headers: &HeaderMap, media: &str) -> bool {
    headers
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.split(',').any(|part| {
                let mut pieces = part.trim().split(';');
                pieces.next() == Some(media) && !pieces.any(|x| x.trim() == "q=0")
            })
        })
}
fn context(app: &App, query: &HashMap<String, String>) -> RenderCtx {
    let policy = if query.get("policy").is_some_and(|x| x == "changed") {
        PolicyExtensions::new().img_src("https:")
    } else {
        PolicyExtensions::new()
    };
    RenderCtx::new()
        .with_navigation(
            NavigationConfig::new(
                "native",
                "shell-v1",
                if query.get("context").is_some_and(|value| value == "changed") {
                    "public-v999".to_string()
                } else {
                    format!("public-v{}", app.data.lock().unwrap().context_generation)
                },
            )
            .expect("fixture identity")
            .with_sealed_policy(
                SealedNavigationPolicy::page_response_only(["/native/update"])
                    .expect("fixture endpoints"),
            ),
        )
        .with_policy(policy.report_uri("/__native/csp"))
}
fn props(app: &App, error: String, name: Option<String>) -> Props {
    let data = app.data.lock().unwrap();
    Props {
        count: data.count,
        name: name.unwrap_or_else(|| data.name.clone()),
        csrf: app.csrf.clone(),
        error,
    }
}
fn cookie(app: &App, mut response: Response) -> Response {
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&format!(
            "native_session={}; HttpOnly; SameSite=Strict; Path=/",
            app.session
        ))
        .unwrap(),
    );
    response
}
fn make_branch(
    app: &App,
    props: &Props,
    ctx: &RenderCtx,
    which_b: bool,
    pathname: &str,
    next: bool,
) -> Result<NavigationBranch, String> {
    let shell = if next { &app.next_shell } else { &app.shell };
    let shell = shell
        .render_owner(&ShellProps { seed: 0 }, ctx, "persistent-shell")
        .map_err(|error| error.to_string())?;
    let leaf = match (next, which_b) {
        (false, false) => &app.a,
        (false, true) => &app.b,
        (true, false) => &app.next_a,
        (true, true) => &app.next_b,
    };
    let leaf = leaf
        .render_owner(props, ctx, "route-data")
        .map_err(|error| error.to_string())?;
    NavigationBranch::new(pathname, vec![shell, leaf]).map_err(|error| error.to_string())
}
async fn render(
    app: Arc<App>,
    headers: HeaderMap,
    query: HashMap<String, String>,
    which_b: bool,
) -> Response {
    if let Some(ms) = query.get("delay").and_then(|v| v.parse::<u64>().ok()) {
        tokio::time::sleep(Duration::from_millis(ms.min(3000))).await;
    }
    {
        app.data.lock().unwrap().gets += 1;
    }
    let ctx = context(&app, &query).with_title(if which_b { "Proof B" } else { "Proof A" });
    let p = props(&app, String::new(), None);
    let result = make_branch(
        &app,
        &p,
        &ctx,
        which_b,
        if which_b { "/native/b" } else { "/native/a" },
        query.get("build").is_some_and(|value| value == "changed"),
    );
    let result = result.and_then(|branch| {
        let status = query
            .get("status")
            .and_then(|value| value.parse::<u16>().ok())
            .and_then(|code| StatusCode::from_u16(code).ok())
            .unwrap_or(StatusCode::OK);
        branch
            .with_status(status)
            .map_err(|error| error.to_string())
    });
    let response = result.and_then(|branch| {
        if accepts(&headers, NAVIGATION_MEDIA_TYPE) {
            if query.contains_key("redirect") {
                branch
                    .into_redirect("/native/b")
                    .map(IntoResponse::into_response)
                    .map_err(|error| error.to_string())
            } else {
                branch
                    .into_navigation_response()
                    .map(IntoResponse::into_response)
                    .map_err(|error| error.to_string())
            }
        } else {
            branch
                .into_document_response()
                .map(IntoResponse::into_response)
                .map_err(|error| error.to_string())
        }
    });
    cookie(
        &app,
        response
            .unwrap_or_else(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()),
    )
}
async fn a(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    render(app, headers, query, false).await
}
async fn b(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    render(app, headers, query, true).await
}
#[derive(Deserialize)]
struct Update {
    name: String,
    csrf: String,
    #[serde(default)]
    redirect: bool,
    #[serde(default)]
    delay: u64,
    #[serde(default)]
    fail_after: bool,
}
async fn update(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Form(input): Form<Update>,
) -> Response {
    let enhanced = accepts(&headers, ACTION_MEDIA_TYPE);
    // Derive admission from the actual bound app/build/policy before mutation.
    // This identity is not an authorization check; the checks below still own that.
    let admission = match app
        .a
        .action_context(&context(&app, &HashMap::new()), "/native/update")
    {
        Ok(value) => value,
        Err(error) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response()
        }
    };
    let cookie_ok = headers
        .get(header::COOKIE)
        .and_then(|h| h.to_str().ok())
        .is_some_and(|v| {
            v.split(';')
                .any(|piece| piece.trim() == format!("native_session={}", app.session))
        });
    let origin_ok =
        headers.get(header::ORIGIN).and_then(|h| h.to_str().ok()) == Some(app.origin.as_str());
    if !cookie_ok || !origin_ok || input.csrf != app.csrf {
        return if enhanced {
            ActionResponse::error(
                &admission,
                StatusCode::FORBIDDEN,
                json!({"message":"Session or CSRF refused"}),
            )
            .unwrap()
            .into_response()
        } else {
            (StatusCode::FORBIDDEN, "Session or CSRF refused").into_response()
        };
    }
    if input.name.trim().is_empty() || input.name.len() > 80 {
        let error = "Name must contain 1 to 80 characters";
        return if enhanced {
            ActionResponse::validation(
                &admission,
                json!({"fields":{"name":error},"values":{"name":input.name},"message":error}),
            )
            .unwrap()
            .into_response()
        } else {
            let mut r = make_branch(
                &app,
                &props(&app, error.into(), Some(input.name)),
                &context(&app, &HashMap::new()).with_title("Validation"),
                false,
                "/native/a",
                false,
            )
            .unwrap()
            .into_document_response()
            .unwrap()
            .into_response();
            *r.status_mut() = StatusCode::UNPROCESSABLE_ENTITY;
            r
        };
    }
    if input.delay > 0 {
        tokio::time::sleep(Duration::from_millis(input.delay.min(3000))).await;
    }
    let count = {
        let mut data = app.data.lock().unwrap();
        data.name = input.name;
        data.count += 1;
        data.posts += 1;
        data.count
    };
    // Deliberately unreadable outcome after confirmed mutation: client must not retry.
    if input.fail_after {
        return (
            StatusCode::BAD_GATEWAY,
            "Proof: mutation committed but response lost",
        )
            .into_response();
    }
    if enhanced {
        if input.redirect {
            ActionResponse::redirect(&admission, "/native/b")
                .unwrap()
                .into_response()
        } else {
            ActionResponse::success(&admission, json!({"count":count}))
                .unwrap()
                .into_response()
        }
    } else {
        Redirect::to("/native/a").into_response()
    }
}
async fn state(State(app): State<Arc<App>>) -> Json<serde_json::Value> {
    let d = app.data.lock().unwrap();
    Json(json!({"count":d.count,"name":d.name,"posts":d.posts,"gets":d.gets}))
}
async fn reset(State(app): State<Arc<App>>) -> StatusCode {
    *app.data.lock().unwrap() = Data {
        name: "Initial".into(),
        context_generation: 1,
        ..Default::default()
    };
    StatusCode::NO_CONTENT
}
async fn current_context(State(app): State<Arc<App>>) -> impl IntoResponse {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(json!({"context":format!("public-v{}",app.data.lock().unwrap().context_generation)})),
    )
}
async fn change_context(State(app): State<Arc<App>>) -> StatusCode {
    app.data.lock().unwrap().context_generation += 1;
    StatusCode::NO_CONTENT
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest = assets::try_load_manifest::<Files>()?;
    let pages = load_ir_modules::<Files>(&manifest).map_err(|e| format!("{e:?}"))?;
    let shell = pages.bind("/native/_shell").map_err(|e| format!("{e:?}"))?;
    let a = pages.bind("/native/a").map_err(|e| format!("{e:?}"))?;
    let b = pages.bind("/native/b").map_err(|e| format!("{e:?}"))?;
    pages.finalize().map_err(|e| format!("{e:?}"))?;
    let next_manifest = assets::try_load_manifest::<NextFiles>()?;
    let next_pages = load_ir_modules::<NextFiles>(&next_manifest).map_err(|e| format!("{e:?}"))?;
    let next_shell = next_pages
        .bind("/native/_shell")
        .map_err(|e| format!("{e:?}"))?;
    let next_a = next_pages.bind("/native/a").map_err(|e| format!("{e:?}"))?;
    let next_b = next_pages.bind("/native/b").map_err(|e| format!("{e:?}"))?;
    next_pages.finalize().map_err(|e| format!("{e:?}"))?;
    let port = std::env::var("PORT").unwrap_or("0".into()).parse::<u16>()?;
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    let origin = format!("http://{}", listener.local_addr()?);
    let app = Arc::new(App {
        shell,
        next_shell,
        next_a,
        next_b,
        a,
        b,
        data: Mutex::new(Data {
            name: "Initial".into(),
            context_generation: 1,
            ..Default::default()
        }),
        csrf: CspNonce::generate()?.to_string(),
        session: CspNonce::generate()?.to_string(),
        origin: origin.clone(),
    });
    let router = Router::new()
        .route("/native/a", get(a_handler))
        .route("/native/b", get(b_handler))
        .route("/native/update", post(update))
        .route("/_assets/{*filename}", get(serve_asset))
        .route("/__native/state", get(state))
        .route(
            "/__native/context",
            get(current_context).post(change_context),
        )
        .route("/__native/reset", post(reset))
        .route("/__native/csp", post(|| async { StatusCode::NO_CONTENT }))
        .with_state(app);
    println!("{origin}");
    axum::serve(listener, router).await?;
    Ok(())
}
async fn a_handler(
    state: State<Arc<App>>,
    headers: HeaderMap,
    query: Query<HashMap<String, String>>,
) -> Response {
    a(state, headers, query).await
}
async fn b_handler(
    state: State<Arc<App>>,
    headers: HeaderMap,
    query: Query<HashMap<String, String>>,
) -> Response {
    b(state, headers, query).await
}
