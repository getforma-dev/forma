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

/// Every `.rs` file under `dir`, recursively, as (path relative to `src/`,
/// text).
fn sources(dir: &Path, root: &Path) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).expect("src is readable") {
        let path = entry.expect("entry").path();
        if path.is_dir() {
            out.extend(sources(&path, root));
        } else if path.extension().is_some_and(|e| e == "rs") {
            let text = std::fs::read_to_string(&path).expect("utf-8 source");
            let relative = path.strip_prefix(root).expect("under src");
            out.push((relative.display().to_string().replace('\\', "/"), text));
        }
    }
    out
}

/// A source file as the checks read it: comment lines (doc comments and their
/// examples included) dropped; a path before `RawHtml` dropped, so
/// `crate::RawHtml`, `super::RawHtml` and `raw::RawHtml` read `RawHtml`;
/// braces and commas spaced; every run of whitespace one space.
fn normalised(text: &str) -> String {
    let code: Vec<&str> = text
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect();
    let code = code.join(" ");
    let mut out = String::with_capacity(code.len());
    let mut rest = code.as_str();
    while let Some(at) = rest.find("RawHtml") {
        let mut head = &rest[..at];
        // Drop `ident::` segments that end right before the name.
        while let Some(path) = head.strip_suffix("::") {
            let ident = path.trim_end_matches(|c: char| c.is_ascii_alphanumeric() || c == '_');
            head = ident;
        }
        out.push_str(head);
        out.push_str("RawHtml");
        rest = &rest[at + "RawHtml".len()..];
    }
    out.push_str(rest);
    let spaced = out
        .replace('{', " { ")
        .replace('}', " } ")
        .replace(',', " , ")
        .replace("->", " -> ");
    spaced.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The block that opens at `text[open]` (a `{`), braces included.
fn block(text: &str, open: usize) -> &str {
    let mut depth = 0usize;
    for (i, c) in text[open..].char_indices() {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return &text[open..=open + i];
                }
            }
            _ => {}
        }
    }
    &text[open..]
}

/// Every way the crate's sources could make a `RawHtml` other than
/// `RawHtml::trusted`, as findings; none means the search for that one name
/// finds every raw entry (DR-19). `files` are (path under `src/`, text).
///
/// A heuristic over the source text, a guard against accidents and not a
/// proof: a macro can still spell the type or the field where no check looks
/// (`macro_rules! ty { () => { RawHtml } }`), and review stays the check for
/// that.
fn second_constructors(files: &[(String, String)]) -> Vec<String> {
    let files: Vec<(String, String)> = files
        .iter()
        .map(|(path, text)| (path.clone(), normalised(text)))
        .collect();
    let mut findings = Vec::new();

    // 1. The field is private to the `raw` module, so only `raw.rs` (and a
    //    `raw/` directory) can write a `RawHtml` value: count every
    //    initialiser of its `html` field there, whatever type name or `Self`
    //    precedes it. Exactly one, in `fn trusted`.
    let mut initialisers = Vec::new();
    for (path, text) in files
        .iter()
        .filter(|(p, _)| p == "raw.rs" || p.starts_with("raw/"))
    {
        for pattern in ["{ html }", "{ html ,", "{ html:", "{ html :"] {
            for (at, _) in text.match_indices(pattern) {
                if !text[..at].ends_with("struct RawHtml ") {
                    let function = text[..at].rfind(" fn ").map_or("", |f| &text[f + 4..]);
                    let name: String = function
                        .chars()
                        .take_while(|c| c.is_alphanumeric() || *c == '_')
                        .collect();
                    initialisers.push(format!("{path}: in fn {name}"));
                }
            }
        }
    }
    if initialisers != ["raw.rs: in fn trusted"] {
        findings.push(format!(
            "the html field is initialised outside RawHtml::trusted: {initialisers:?}"
        ));
    }

    // 2. The traits it implements, wherever the impl is and however its type
    //    is named: none of them makes one from text.
    let mut traits = Vec::new();
    for (_, text) in &files {
        for (at, _) in text.match_indices(" for RawHtml ") {
            let start = text[..at].rfind("impl").map_or(0, |i| i + "impl".len());
            traits.push(text[start..at].trim().to_string());
        }
    }
    traits.sort();
    if traits != ["Clone", "Deref", "Drop", "Eq", "PartialEq", "fmt::Debug"] {
        findings.push(format!("RawHtml implements {traits:?}"));
    }

    // 3. Its inherent functions, in any module: `trusted` and `as_str`.
    let mut functions = Vec::new();
    for (_, text) in &files {
        for (at, _) in text.match_indices("RawHtml {") {
            let before = text[..at].trim_end();
            let inherent =
                before.ends_with("impl") || (before.ends_with('>') && before.contains("impl<"));
            if !inherent {
                continue;
            }
            let body = block(text, at + "RawHtml ".len());
            for (f, _) in body.match_indices(" fn ") {
                let name: String = body[f + 4..]
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_')
                    .collect();
                functions.push(name);
            }
        }
    }
    functions.sort();
    if functions != ["as_str", "trusted"] {
        findings.push(format!("RawHtml's inherent functions are {functions:?}"));
    }

    // 4. A function anywhere whose return type names RawHtml: only `trusted`.
    let mut returning = Vec::new();
    for (path, text) in &files {
        for (at, _) in text.match_indices(" -> ") {
            let ret = &text[at + 4..];
            let end = ret
                .find(" { ")
                .unwrap_or(ret.len())
                .min(ret.find(" where ").unwrap_or(ret.len()));
            if ret[..end].contains("RawHtml") {
                let function = text[..at].rfind(" fn ").map_or("", |f| &text[f + 4..]);
                let name: String = function
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_')
                    .collect();
                returning.push(format!("{path}: fn {name}"));
            }
        }
    }
    if returning != ["raw.rs: fn trusted"] {
        findings.push(format!("functions returning a RawHtml: {returning:?}"));
    }

    // 5. No derive in raw.rs: a derived Default or Deserialize is a
    //    constructor that writes no initialiser.
    if files
        .iter()
        .any(|(p, t)| p == "raw.rs" && t.contains("derive("))
    {
        findings.push("a derive in raw.rs".to_string());
    }

    // 6. No other name for it, and no raw identifier for its field: a type
    //    alias (`type Markup = RawHtml;`) or a renaming import
    //    (`use crate::RawHtml as Markup;`) hides the type from every check
    //    above and from the search, and `r#html` hides the field.
    for (path, text) in &files {
        for (at, _) in text.match_indices("= RawHtml") {
            if !text[at + "= RawHtml".len()..].starts_with("::") {
                findings.push(format!("{path}: a type alias for RawHtml"));
            }
        }
        if text.contains("RawHtml as ") {
            findings.push(format!("{path}: RawHtml imported under another name"));
        }
        if text.contains("r#html") {
            findings.push(format!("{path}: the field as a raw identifier"));
        }
    }
    findings
}

/// Second constructors the check must catch, each added to a copy of the
/// crate's real sources, never to the crate: (what, file, code appended).
/// The first two are the review's (5516933079).
const SECOND_CONSTRUCTORS: [(&str, &str, &str); 14] = [
    (
        "an inherent fn building Self",
        "raw.rs",
        "impl RawHtml { pub fn sneaky(html: Box<str>) -> Self { Self { html } } }",
    ),
    (
        "From for a path-qualified target",
        "raw.rs",
        "impl From<Box<str>> for crate::RawHtml { fn from(html: Box<str>) -> Self { Self { html } } }",
    ),
    (
        "the same without spaces",
        "raw.rs",
        "impl RawHtml{pub fn s(h:Box<str>)->Self{Self{html:h}}}",
    ),
    (
        "From through the constructor",
        "raw.rs",
        "impl From<String> for RawHtml { fn from(s: String) -> Self { RawHtml::trusted(s) } }",
    ),
    (
        "Default in a child module",
        "raw.rs",
        "mod sneaky { impl Default for super::RawHtml { fn default() -> Self { Self::trusted(String::new()) } } }",
    ),
    (
        "FromStr writing the field",
        "raw.rs",
        "impl std::str::FromStr for RawHtml { type Err = (); fn from_str(s: &str) -> Result<Self, ()> { Ok(Self { html: s.into() }) } }",
    ),
    (
        "an inherent wrapper in another module",
        "template.rs",
        "impl crate::RawHtml { pub fn wrap(s: String) -> Self { Self::trusted(s) } }",
    ),
    (
        "a free wrapper returning it in an Option",
        "render.rs",
        "pub fn raw(s: &str) -> Option<crate::raw::RawHtml> { Some(crate::RawHtml::trusted(s)) }",
    ),
    (
        "a derive",
        "raw.rs",
        "#[derive(Default)] struct Shadow;",
    ),
    // The second review's five (FORMA-126 follow-up): another name for the
    // type, or a raw identifier for the field.
    (
        "a macro behind a type alias",
        "raw.rs",
        "macro_rules! build_raw { ($t:ident, $f:ident, $v:expr) => { $t { $f: $v } }; }\ntype Markup = RawHtml;\nimpl Markup { pub fn via_macro(h: Box<str>) -> Self { build_raw!(Self, html, h) } }",
    ),
    (
        "a wrapper under a renaming import",
        "template.rs",
        "use crate::raw::RawHtml as Markup;\nimpl Markup { pub fn wrap(s: String) -> Self { Self::trusted(s) } }",
    ),
    (
        "a trait impl through an alias",
        "raw.rs",
        "type R = RawHtml;\nimpl From<Box<str>> for R { fn from(h: Box<str>) -> Self { Self::trusted(h) } }",
    ),
    (
        "a raw identifier through an alias",
        "raw.rs",
        "type R = RawHtml;\nimpl R { pub fn r_ident(h: Box<str>) -> Self { Self { r#html: h } } }",
    ),
    (
        "a free function returning an alias",
        "render.rs",
        "pub type Markup = crate::RawHtml;\npub fn markup(s: &str) -> Markup { Markup::trusted(s) }",
    ),
];

/// A second constructor made by changing a line, not adding one: (what, file,
/// text, replaced by). The clone writing the field itself is found only by
/// counting initialisers, and writing it as `r#html` only by check 6.
const CHANGED_CONSTRUCTORS: [(&str, &str, &str, &str); 2] = [
    (
        "Clone writing the field",
        "raw.rs",
        "RawHtml::trusted(&*self.html)",
        "Self { html: self.html.clone() }",
    ),
    (
        "Clone writing the field as a raw identifier",
        "raw.rs",
        "RawHtml::trusted(&*self.html)",
        "Self { r#html: self.html.clone() }",
    ),
];

#[test]
fn a_search_finds_one_raw_constructor() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let files = sources(&src, &src);
    assert!(
        files.iter().any(|(p, _)| p == "raw.rs"),
        "read the crate's sources"
    );

    // The crate as it is: RawHtml::trusted is the one constructor.
    assert_eq!(second_constructors(&files), Vec::<String>::new());

    // Each second constructor, added to a copy of the sources, is found.
    for (what, file, code) in SECOND_CONSTRUCTORS {
        let mut probe = files.clone();
        let target = probe
            .iter_mut()
            .find(|(p, _)| p == file)
            .unwrap_or_else(|| panic!("{file} is a source file"));
        target.1.push('\n');
        target.1.push_str(code);
        target.1.push('\n');
        assert!(
            !second_constructors(&probe).is_empty(),
            "{what} ({file}) is not found"
        );
    }
    for (what, file, text, replaced_by) in CHANGED_CONSTRUCTORS {
        let mut probe = files.clone();
        let target = probe
            .iter_mut()
            .find(|(p, _)| p == file)
            .unwrap_or_else(|| panic!("{file} is a source file"));
        assert_eq!(
            target.1.matches(text).count(),
            1,
            "{what}: {text} is in {file}"
        );
        target.1 = target.1.replace(text, replaced_by);
        assert!(
            !second_constructors(&probe).is_empty(),
            "{what} ({file}) is not found"
        );
    }
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

/// The form the docs, the `RAW-101` warning and the CHANGELOGs suggest, in a
/// handler's shape: the `RawHtml` bound first, then borrowed in the literal.
/// CI's MSRV job (`cargo +1.85 check -p forma-server --all-targets`) compiles
/// this file, so a suggestion that does not build on the MSRV fails there:
/// written inline, `Some(&RawHtml::trusted(..))` is E0716 on 1.85.
#[test]
fn the_documented_body_prefix_form_compiles_on_the_msrv_and_renders() {
    let manifest = manifest();
    let logo = RawHtml::trusted("<img src=\"/logo.svg\" alt=\"\">");
    let config = PageConfig {
        title: "Tenant",
        route_pattern: ROUTE,
        manifest: &manifest,
        config_script: None,
        config_json: None,
        body_class: None,
        personality_css: None,
        body_prefix: Some(&logo),
        render_mode: RenderMode::Phase1ClientMount,
        ir_module: None,
        slots: None,
    };
    let html = render_browser_shell(&config, &RenderCtx::new())
        .expect("renders")
        .into_parts_unchecked()
        .html;
    assert!(
        html.contains("<img src=\"/logo.svg\" alt=\"\"><div id=\"app\"></div>"),
        "{html}"
    );
}
