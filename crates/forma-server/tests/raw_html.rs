//! `RawHtml`: the one named raw-HTML type in Rust (DR-19, SR15; FORMA-126).
//!
//! Two guarantees: one constructor, so a search for `RawHtml::trusted` finds
//! every raw entry; and a `RawHtml` in `body_prefix` is written exactly as the
//! same text passed as a string was, on every render path, so moving a call
//! site to it changes nothing in the page.
// `render_page` and `render_page_with_nonce` (deprecated in 0.2.2) are two of
// the paths, and `config_script` is a field every 0.2.x literal names.
#![allow(deprecated)]

use forma_ir::parser::test_helpers::{
    build_minimal_ir, encode_close_tag, encode_open_tag, encode_text,
};
use forma_ir::{IrModule, SlotData};
use forma_server::{
    render_browser_shell, render_page, render_page_with_nonce, try_render, AssetManifest, CspNonce,
    PageConfig, RawHtml, RenderCtx, RenderMode, RouteAssets,
};
use std::collections::HashMap;
use std::path::Path;

// -- One constructor ----------------------------------------------------------

/// Every `.rs` file under `dir`, recursively, as (path, code): comment lines
/// (doc comments and their examples included) dropped, and each run of
/// whitespace collapsed to one space.
fn sources(dir: &Path) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).expect("src is readable") {
        let path = entry.expect("entry").path();
        if path.is_dir() {
            out.extend(sources(&path));
        } else if path.extension().is_some_and(|e| e == "rs") {
            let text = std::fs::read_to_string(&path).expect("utf-8 source");
            let code: Vec<&str> = text
                .lines()
                .filter(|line| !line.trim_start().starts_with("//"))
                .collect();
            let collapsed = code
                .join(" ")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            out.push((path.display().to_string(), collapsed));
        }
    }
    out
}

#[test]
fn a_search_finds_one_raw_constructor() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let files = sources(&src);
    assert!(files.len() > 5, "read the crate's sources");

    // A `RawHtml` value can only be written as a struct literal, its field
    // being private: exactly one, in `RawHtml::trusted`.
    let mut literals = Vec::new();
    for (path, text) in &files {
        for (at, _) in text.match_indices("RawHtml { html") {
            if !text[..at].ends_with("struct ") {
                literals.push((path.clone(), at));
            }
        }
    }
    assert_eq!(
        literals.len(),
        1,
        "exactly one struct literal makes a RawHtml: {literals:?}"
    );
    let (path, at) = &literals[0];
    assert!(path.ends_with("raw.rs"), "{path}");
    let raw = &files.iter().find(|(p, _)| p == path).expect("raw.rs").1;
    let constructor = raw[..*at].rfind("pub fn ").expect("inside a function");
    assert!(
        raw[constructor..].starts_with("pub fn trusted("),
        "the literal is in RawHtml::trusted"
    );

    // One function returns a RawHtml by name, the constructor; and no trait
    // gives another way in (no From, Default, FromStr, Deserialize). A new
    // impl fails here until this list, and the review, say why it is not a
    // second constructor.
    let returning: usize = files
        .iter()
        .map(|(_, t)| t.matches("-> RawHtml").count())
        .sum();
    assert_eq!(returning, 1, "only RawHtml::trusted returns a RawHtml");
    let mut impls: Vec<String> = Vec::new();
    for (_, text) in &files {
        for (at, _) in text.match_indices(" for RawHtml ") {
            let start = text[..at].rfind("impl ").expect("an impl") + "impl ".len();
            impls.push(text[start..at].to_string());
        }
    }
    impls.sort();
    assert_eq!(
        impls,
        ["Clone", "Deref", "Drop", "Eq", "PartialEq", "fmt::Debug"],
        "the traits RawHtml implements"
    );
    assert!(raw.contains("pub struct RawHtml {"), "declared in raw.rs");
    assert!(
        !raw.contains("derive("),
        "no derive in raw.rs (a derived Default or Deserialize is a constructor)"
    );
}

// -- Written as it is, on every path -------------------------------------------

const ROUTE: &str = "/r";

fn manifest() -> AssetManifest {
    let mut routes = HashMap::new();
    routes.insert(
        ROUTE.to_string(),
        RouteAssets {
            js: vec!["app.1.js".into()],
            css: vec!["s.2.css".into()],
            fonts: vec![],
            total_size_br: 0,
            budget_warn_threshold: 0,
            ir: Some("p.3.ir".into()),
        },
    );
    AssetManifest {
        version: 1,
        build_hash: "h".into(),
        assets: HashMap::new(),
        routes,
        wasm: None,
    }
}

fn module() -> IrModule {
    let mut ops = encode_open_tag(0, &[]);
    ops.extend_from_slice(&encode_text(1));
    ops.extend_from_slice(&encode_close_tag(0));
    IrModule::parse(&build_minimal_ir(&["p", "walked"], &[], &ops, &[])).expect("module")
}

fn config<'a>(
    manifest: &'a AssetManifest,
    module: &'a IrModule,
    slots: &'a SlotData,
    body_prefix: Option<&'a str>,
) -> PageConfig<'a> {
    PageConfig {
        title: "Raw",
        route_pattern: ROUTE,
        manifest,
        config_script: None,
        config_json: None,
        body_class: None,
        personality_css: None,
        body_prefix,
        render_mode: RenderMode::Phase2SsrReconcile,
        ir_module: Some(module),
        slots: Some(slots),
    }
}

/// The four renders that write a page's document, each returning (HTML,
/// nonce). The nonce is drawn per render on three of them, so documents are
/// compared with it replaced.
type Render = fn(&PageConfig) -> (String, String);

const PATHS: [(&str, Render); 4] = [
    ("render_page", |c| {
        let page = render_page(c);
        (page.html, page.nonce.to_string())
    }),
    ("render_page_with_nonce", |c| {
        let nonce = CspNonce::parse("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=").expect("nonce");
        let page = render_page_with_nonce(c, &nonce);
        (page.html, page.nonce.to_string())
    }),
    ("try_render", |c| {
        let parts = try_render(c, &RenderCtx::new())
            .expect("renders")
            .into_parts_unchecked();
        (parts.html, parts.nonce.to_string())
    }),
    ("render_browser_shell", |c| {
        let parts = render_browser_shell(c, &RenderCtx::new())
            .expect("renders")
            .into_parts_unchecked();
        (parts.html, parts.nonce.to_string())
    }),
];

#[test]
fn a_raw_html_body_prefix_is_written_exactly_as_the_same_string_on_every_path() {
    let manifest = manifest();
    let module = module();
    let slots = SlotData::new(0);
    // Markup a string would carry: a tag, an entity, a quote and a non-ASCII
    // character, none of which may be escaped or altered.
    let markup = "<header data-x=\"1\">Caf\u{e9} &amp; <b>bar</b></header>";
    let raw = RawHtml::trusted(markup);
    let as_string = String::from(markup);

    for (name, render) in PATHS {
        let (with_raw, nonce_raw) = render(&config(&manifest, &module, &slots, Some(&raw)));
        let (with_string, nonce_string) =
            render(&config(&manifest, &module, &slots, Some(&as_string)));
        let (without, nonce_none) = render(&config(&manifest, &module, &slots, None));

        let with_raw = with_raw.replace(&nonce_raw, "N");
        let with_string = with_string.replace(&nonce_string, "N");
        let without = without.replace(&nonce_none, "N");
        assert_eq!(
            with_raw, with_string,
            "{name}: RawHtml and string write the same page"
        );
        // Present, once, verbatim, right before the root...
        assert_eq!(with_raw.matches(markup).count(), 1, "{name}");
        assert!(
            with_raw.contains(&format!("{markup}<div id=\"app\"")),
            "{name}: before the root"
        );
        // ...and the only difference from a page with no prefix.
        assert_eq!(with_raw.replacen(markup, "", 1), without, "{name}");
    }
}
