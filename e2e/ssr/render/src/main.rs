//! Render actual compiler output through the public typed Pages API.
//! Fixed declared fixture props come from each case's slots.json; no slot-name
//! search, low-level walker, or arbitrary handler SlotData is used.
//! Writes paired SSR/explicit-Browser HTML and PageResponse headers for E2E.

use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};

use forma_ir::PageProps;
use forma_server::{
    load_ir_modules, render_browser_shell, AssetManifest, PageConfig, PageResponse, RenderCtx,
    RouteMode,
};
use rust_embed::Embed;
use std::borrow::Cow;
use std::sync::{Mutex, OnceLock};

// Cases run sequentially. The ordinary production loader reads the selected
// fixture build through Embed; application-facing code still only sees Pages.
fn fixture_root() -> &'static Mutex<PathBuf> {
    static ROOT: OnceLock<Mutex<PathBuf>> = OnceLock::new();
    ROOT.get_or_init(Default::default)
}
struct FixtureAssets;
impl Embed for FixtureAssets {
    fn get(name: &str) -> Option<rust_embed::EmbeddedFile> {
        rust_embed::utils::read_file_from_fs(&fixture_root().lock().unwrap().join(name)).ok()
    }
    fn iter() -> impl Iterator<Item = Cow<'static, str>> {
        std::iter::empty()
    }
}
#[derive(PageProps)]
struct Empty {}
#[derive(PageProps)]
struct CountProps {
    count: u32,
}
#[derive(PageProps)]
struct ArrivalProps {
    arrival_title: String,
    arrival_cash: String,
    arrival_status: String,
    arrival_summary: bool,
}
fn render_typed<P: PageProps>(
    manifest: &AssetManifest,
    props: &P,
) -> Result<PageResponse, Box<dyn Error>> {
    let pages = load_ir_modules::<FixtureAssets>(manifest).map_err(|e| format!("{e:?}"))?;
    let page = pages.bind::<P>(ROUTE).map_err(|e| format!("{e:?}"))?;
    pages.finalize().map_err(|e| format!("{e:?}"))?;
    Ok(page.render(props, &RenderCtx::new().with_title(TITLE))?)
}

/// The route every case is built and rendered under.
const ROUTE: &str = "/";
/// The page title the renderer writes into `<head>`.
const TITLE: &str = "Forma SSR fixture";

fn main() {
    if let Err(err) = run() {
        eprintln!("forma-e2e-render: {err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [cases_dir, build_dir, site_dir] = args.as_slice() else {
        return Err("usage: forma-e2e-render <cases-dir> <build-dir> <site-dir>".into());
    };
    let (cases_dir, build_dir, site_dir) = (
        Path::new(cases_dir),
        Path::new(build_dir),
        Path::new(site_dir),
    );

    let mut cases: Vec<PathBuf> = fs::read_dir(build_dir)?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| path.join("manifest.json").is_file())
        .collect();
    cases.sort();
    if cases.is_empty() {
        return Err(format!("no built cases under {}", build_dir.display()).into());
    }

    for dist in &cases {
        let name = dist
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("case directory name is not UTF-8")?;
        render_case(name, dist, &cases_dir.join(name), &site_dir.join(name))
            .map_err(|err| format!("case {name}: {err}"))?;
    }
    Ok(())
}

fn render_case(name: &str, dist: &Path, source: &Path, out: &Path) -> Result<(), Box<dyn Error>> {
    let manifest: AssetManifest =
        serde_json::from_str(&fs::read_to_string(dist.join("manifest.json"))?)?;
    let ir_file = manifest
        .route(ROUTE)
        .and_then(|route| route.ir.clone())
        .ok_or("the manifest names no .ir module for route / (the build emitted no IR)")?;
    *fixture_root().lock().unwrap() = dist.to_path_buf();
    let input = source.join("slots.json");
    let input: serde_json::Value = if input.is_file() {
        serde_json::from_str(&fs::read_to_string(input)?)?
    } else {
        serde_json::json!({})
    };
    let ssr = match name {
        "generic-state" => render_typed(
            &manifest,
            &CountProps {
                count: input["count"]
                    .as_u64()
                    .and_then(|n| n.try_into().ok())
                    .ok_or("missing u32 count")?,
            },
        )?,
        "ledger-arrival" => render_typed(
            &manifest,
            &ArrivalProps {
                arrival_title: input["arrivalTitle"]
                    .as_str()
                    .ok_or("missing arrivalTitle")?
                    .into(),
                arrival_cash: input["arrivalCash"]
                    .as_str()
                    .ok_or("missing arrivalCash")?
                    .into(),
                arrival_status: input["arrivalStatus"]
                    .as_str()
                    .ok_or("missing arrivalStatus")?
                    .into(),
                arrival_summary: input["arrivalSummary"]
                    .as_bool()
                    .ok_or("missing arrivalSummary")?,
            },
        )?,
        _ => render_typed(&manifest, &Empty {})?,
    };
    // The paired CSR comparison is an explicit Browser route declaration.
    let mut browser = manifest.clone();
    let route = browser
        .routes
        .get_mut(ROUTE)
        .ok_or("missing browser route")?;
    route.mode = RouteMode::Browser;
    route.ir = None;
    let csr = render_browser_shell(
        &PageConfig {
            title: TITLE,
            route_pattern: ROUTE,
            manifest: &browser,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
        },
        &RenderCtx::new(),
    )?;
    fs::create_dir_all(out)?;
    for (file, is_ssr, response) in [("index", true, ssr), ("csr", false, csr)] {
        let page = response.into_parts_unchecked();

        let server_rendered = page.html.contains("<div id=\"app\" data-forma-ssr>");
        if server_rendered != is_ssr {
            return Err(format!(
                "{file}.html: expected SSR={is_ssr}, but the page {} server-rendered \
                 (the selected checked renderer must preserve its declared mode)",
                if server_rendered { "is" } else { "is not" }
            )
            .into());
        }

        let mut headers = serde_json::Map::new();
        for (header, value) in &page.headers {
            headers.insert(
                header.as_str().to_string(),
                serde_json::Value::String(value.to_str()?.to_string()),
            );
        }
        fs::write(out.join(format!("{file}.html")), &page.html)?;
        fs::write(
            out.join(format!("{file}.headers.json")),
            serde_json::to_string_pretty(&headers)?,
        )?;
    }

    println!("rendered {name}: index.html (Phase 2), csr.html (Phase 1), module {ir_file}");
    Ok(())
}
