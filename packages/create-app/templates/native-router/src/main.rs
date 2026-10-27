use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use forma_ir::PageProps;
use forma_server::{
    assets, load_ir_modules, navigation::NAVIGATION_MEDIA_TYPE, sw, NavigationBranch,
    NavigationConfig, PageHandle, RenderCtx, RenderError, SealedNavigationPolicy,
};
use rust_embed::Embed;
use std::sync::Arc;

#[derive(Embed)]
#[folder = "admin/dist/"]
struct Assets;

#[derive(PageProps)]
struct CountProps {
    count: u32,
}
#[derive(PageProps)]
struct AboutProps {}

struct AppState {
    shell: PageHandle<CountProps>,
    home: PageHandle<CountProps>,
    about: PageHandle<AboutProps>,
    navigation: NavigationConfig,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    if Assets::get("manifest.json").is_none() {
        eprintln!("Frontend not built: cd admin && npm ci && npm run build");
        std::process::exit(1);
    }
    let manifest = assets::try_load_manifest::<Assets>().unwrap_or_else(|error| {
        eprintln!("admin/dist/manifest.json: {error}");
        std::process::exit(1);
    });
    let pages = load_ir_modules::<Assets>(&manifest).unwrap_or_else(|errors| {
        for error in errors {
            eprintln!("{error}");
        }
        std::process::exit(1);
    });
    let shell = pages.bind::<CountProps>("shell").unwrap_or_else(|errors| {
        for error in errors {
            eprintln!("{error}");
        }
        std::process::exit(1);
    });
    let home_page = pages.bind::<CountProps>("home").unwrap_or_else(|errors| {
        for error in errors {
            eprintln!("{error}");
        }
        std::process::exit(1);
    });
    let about_page = pages.bind::<AboutProps>("about").unwrap_or_else(|errors| {
        for error in errors {
            eprintln!("{error}");
        }
        std::process::exit(1);
    });
    pages.finalize().unwrap_or_else(|errors| {
        for error in errors {
            eprintln!("{error}");
        }
        std::process::exit(1);
    });
    // This public demo has no authenticated sessions or enhanced form actions.
    // Typed PageResponse is the complete policy: do not add CSP in a proxy,
    // middleware or meta element without disabling native navigation first.
    let navigation = NavigationConfig::new("main", "layout-v1", "public-v1")
        .expect("static navigation identities")
        .with_sealed_policy(
            SealedNavigationPolicy::page_response_only(Vec::<String>::new())
                .expect("no enhanced actions"),
        );
    sw::configure(sw::ServiceWorker::off()).expect("configured once, before the first page");
    let state = Arc::new(AppState {
        shell,
        home: home_page,
        about: about_page,
        navigation,
    });
    let app = Router::new()
        .route("/", get(home))
        .route("/about", get(about))
        .route("/favicon.ico", get(favicon))
        .route("/sw.js", get(sw::serve_sw::<Assets>))
        .route("/_assets/{*filename}", get(assets::serve_asset::<Assets>))
        .with_state(state);
    // Port zero asks the OS for an available port; useful for isolated tests.
    let port = match std::env::var("FORMA_PORT") {
        Ok(value) if !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()) => {
            value.parse::<u16>().unwrap_or_else(|_| {
                eprintln!("FORMA_PORT must be an integer from 0 to 65535");
                std::process::exit(1);
            })
        }
        Err(std::env::VarError::NotPresent) => 3000,
        _ => {
            eprintln!("FORMA_PORT must be an integer from 0 to 65535");
            std::process::exit(1);
        }
    };
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
        .await
        .unwrap();
    // Emit readiness only while this process owns the successfully bound socket.
    println!("FORMA_LISTENING http://{}", listener.local_addr().unwrap());
    axum::serve(listener, app).await.unwrap();
}

fn branch(state: &AppState, about: bool) -> Result<NavigationBranch, RenderError> {
    let ctx = RenderCtx::new()
        .with_title(if about { "About" } else { "Home" })
        .with_navigation(state.navigation.clone());
    let shell = state
        .shell
        .render_owner(&CountProps { count: 0 }, &ctx, "persistent-layout")?;
    let leaf = if about {
        state.about.render_owner(&AboutProps {}, &ctx, "about-v1")?
    } else {
        state
            .home
            .render_owner(&CountProps { count: 7 }, &ctx, "home-v1")?
    };
    NavigationBranch::new(if about { "/about" } else { "/" }, vec![shell, leaf])
}

async fn render(state: Arc<AppState>, headers: HeaderMap, about: bool) -> Response {
    // Negotiation only selects the representation. Each request still renders
    // the same finalized typed owners and validates all branch identities.
    let enhanced = headers
        .get(header::ACCEPT)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == NAVIGATION_MEDIA_TYPE);
    let rendered = branch(&state, about).and_then(|branch| {
        if enhanced {
            branch
                .into_navigation_response()
                .map(IntoResponse::into_response)
        } else {
            branch
                .into_document_response()
                .map(IntoResponse::into_response)
        }
    });
    match rendered {
        Ok(page) => page.into_response(),
        Err(error) => {
            tracing::error!(code = error.code(), route = error.route(), "{error}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                [
                    (header::CACHE_CONTROL, "no-store"),
                    (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                ],
                "Internal Server Error",
            )
                .into_response()
        }
    }
}
async fn home(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    render(state, headers, false).await
}
async fn about(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    render(state, headers, true).await
}
async fn favicon() -> StatusCode {
    StatusCode::NO_CONTENT
}
