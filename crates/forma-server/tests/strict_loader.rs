//! The strict module loader is the default: a bad module for a server-rendered
//! route stops the server before its port binds, naming route, file and code
//! (DR-11, Q13; FORMA-121). The lenient loader is deprecated and behaves as at
//! 0.2.1.
//!
//! The fixtures under `tests/fixtures/modules/` are written by
//! [`fixture_files`] below (run the ignored `regenerate_module_fixtures` to
//! rewrite them) and pinned to it by `module_fixtures_are_what_their_generator_writes`.
//! Each corrupt set also holds a good page (`/`) and a route the build
//! declares `ssr: false` (`/app`, no `ir`), so one bad module is seen among
//! good ones.

use forma_server::assets::try_load_manifest;
use forma_server::{load_ir_modules_strict, IrLoadError, IrModules, RenderMode};
use rust_embed::Embed;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::mpsc;
use std::time::Duration;

#[derive(Embed)]
#[folder = "tests/fixtures/modules/good/"]
struct Good;

#[derive(Embed)]
#[folder = "tests/fixtures/modules/flipped/"]
struct Flipped;

#[derive(Embed)]
#[folder = "tests/fixtures/modules/truncated/"]
struct Truncated;

// -- The fixtures and their generator ----------------------------------------

/// A valid module: island "Hello" around `<p>hello</p>`.
fn good_module() -> Vec<u8> {
    use forma_ir::parser::test_helpers::{
        build_minimal_ir, encode_close_tag, encode_open_tag, encode_text,
    };
    let mut ops = vec![0x0B, 0, 0]; // ISLAND_START 0
    ops.extend_from_slice(&encode_open_tag(0, &[]));
    ops.extend_from_slice(&encode_text(1));
    ops.extend_from_slice(&encode_close_tag(0));
    ops.extend_from_slice(&[0x0C, 0, 0]); // ISLAND_END 0
    build_minimal_ir(
        &["p", "hello", "Hello"],
        &[],
        &ops,
        &[(0, 0x01, 0x01, 2, 0, &[])],
    )
}

/// `bytes` with one byte XORed.
fn flip(mut bytes: Vec<u8>, at: usize, mask: u8) -> Vec<u8> {
    bytes[at] ^= mask;
    bytes
}

/// A manifest naming `/` (good), `/app` (`ssr: false`, no module) and the
/// given routes' modules.
fn manifest_json(bad: &[(&str, &str)]) -> String {
    let route = |ir: Option<&str>| {
        let ir = ir.map_or(String::new(), |f| format!(r#","ir":"{f}""#));
        format!(
            r#"{{"js":["app.js"],"css":[],"fonts":[],"total_size_br":0,"budget_warn_threshold":0{ir}}}"#
        )
    };
    let mut routes = vec![
        format!(r#""/":{}"#, route(Some("page.0f0f.ir"))),
        format!(r#""/app":{}"#, route(None)),
    ];
    for (path, file) in bad {
        routes.push(format!(r#""{path}":{}"#, route(Some(file))));
    }
    format!(
        "{{\"version\":1,\"build_hash\":\"fixture\",\"assets\":{{}},\"routes\":{{{}}}}}\n",
        routes.join(",")
    )
}

/// Every fixture file: (set, file name, bytes).
fn fixture_files() -> Vec<(&'static str, &'static str, Vec<u8>)> {
    let good = good_module();
    let flipped = [
        // byte 0, the magic: "FMIR" becomes "GMIR"
        ("/magic", "magic.ir", flip(good.clone(), 0, 0x01)),
        // byte 4, the version: 2 becomes 3
        ("/version", "version.ir", flip(good.clone(), 4, 0x01)),
        // byte 16, the bytecode section's offset: 48 becomes 176, past the end
        ("/section", "section.ir", flip(good.clone(), 16, 0x80)),
        // byte 51, the second opcode: OPEN_TAG (0x01) becomes 0x81
        ("/opcode", "opcode.ir", flip(good.clone(), 51, 0x80)),
        // byte 8, the source hash: FMIR v2 checks nothing here, so this one
        // LOADS. Pinned below as the known gap that FMIR v3's CRC-32 closes
        // (DR-28, FORMA-114); not a module this loader can refuse.
        ("/hash", "hash.ir", flip(good.clone(), 8, 0x01)),
    ];
    let truncated = [
        // inside the 16-byte header
        ("/header", "header.ir", good[..10].to_vec()),
        // the last byte gone: the island table runs past the end
        ("/tail", "tail.ir", good[..good.len() - 1].to_vec()),
    ];

    let mut files = vec![
        ("good", "manifest.json", manifest_json(&[]).into_bytes()),
        ("good", "page.0f0f.ir", good.clone()),
    ];
    let routes: Vec<_> = flipped.iter().map(|(r, f, _)| (*r, *f)).collect();
    files.push((
        "flipped",
        "manifest.json",
        manifest_json(&routes).into_bytes(),
    ));
    files.push(("flipped", "page.0f0f.ir", good.clone()));
    for (_, file, bytes) in flipped {
        files.push(("flipped", file, bytes));
    }
    let routes: Vec<_> = truncated.iter().map(|(r, f, _)| (*r, *f)).collect();
    files.push((
        "truncated",
        "manifest.json",
        manifest_json(&routes).into_bytes(),
    ));
    files.push(("truncated", "page.0f0f.ir", good));
    for (_, file, bytes) in truncated {
        files.push(("truncated", file, bytes));
    }
    files
}

fn fixture_path(set: &str, file: &str) -> String {
    format!(
        "{}/tests/fixtures/modules/{set}/{file}",
        env!("CARGO_MANIFEST_DIR")
    )
}

#[test]
#[ignore = "writes the fixtures; run by hand after changing the generator"]
fn regenerate_module_fixtures() {
    for (set, file, bytes) in fixture_files() {
        let path = fixture_path(set, file);
        std::fs::create_dir_all(std::path::Path::new(&path).parent().expect("dir"))
            .expect("fixture dir");
        std::fs::write(&path, bytes).expect("fixture written");
    }
}

#[test]
fn module_fixtures_are_what_their_generator_writes() {
    for (set, file, bytes) in fixture_files() {
        let on_disk = std::fs::read(fixture_path(set, file)).unwrap_or_else(|e| {
            panic!("{set}/{file} missing ({e}); run regenerate_module_fixtures")
        });
        assert_eq!(on_disk, bytes, "{set}/{file} differs from its generator");
    }
}

// -- The default loader ---------------------------------------------------------

/// The one error naming `route`.
fn error_for<'a>(errors: &'a [IrLoadError], route: &str) -> &'a IrLoadError {
    let named: Vec<_> = errors.iter().filter(|e| e.route == route).collect();
    assert_eq!(named.len(), 1, "one error for {route}: {errors:?}");
    named[0]
}

#[test]
fn a_flipped_byte_fails_the_default_loader_naming_route_file_and_code() {
    let manifest = try_load_manifest::<Flipped>().expect("manifest");
    let errors = load_ir_modules_strict::<Flipped>(&manifest).expect_err("bad modules refuse");

    for (route, file, code, cause) in [
        ("/magic", "magic.ir", "LOAD-102", "bad magic"),
        (
            "/version",
            "version.ir",
            "LOAD-102",
            "unsupported IR version: 3",
        ),
        ("/section", "section.ir", "LOAD-103", "out of bounds"),
        ("/opcode", "opcode.ir", "LOAD-103", "invalid opcode: 0x81"),
    ] {
        let error = error_for(&errors, route);
        assert_eq!(error.ir_file, file);
        assert_eq!(error.code(), Some(code), "{error}");
        assert!(error.reason.contains(cause), "{error}");
        let message = error.to_string();
        assert!(
            message.contains(route) && message.contains(file) && message.contains(code),
            "the message names route, file and code: {message}"
        );
    }
    // The good page and the `ssr: false` route are not errors, and a flip in
    // the source hash is one FMIR v2 cannot see (FMIR v3's CRC-32, FORMA-114).
    assert_eq!(errors.len(), 4, "{errors:?}");
    for route in ["/", "/app", "/hash"] {
        assert!(
            errors.iter().all(|e| e.route != route),
            "{route}: {errors:?}"
        );
    }
}

#[test]
fn a_truncated_module_fails_the_default_loader_naming_route_file_and_code() {
    let manifest = try_load_manifest::<Truncated>().expect("manifest");
    let errors = load_ir_modules_strict::<Truncated>(&manifest).expect_err("refuses");
    assert_eq!(errors.len(), 2, "{errors:?}");
    for (route, file, cause) in [
        ("/header", "header.ir", "buffer too short"),
        ("/tail", "tail.ir", "out of bounds"),
    ] {
        let error = error_for(&errors, route);
        assert_eq!(error.ir_file, file);
        assert_eq!(error.code(), Some("LOAD-103"), "{error}");
        assert!(error.reason.contains(cause), "{error}");
    }
}

#[test]
fn a_route_declared_ssr_false_needs_no_module() {
    let manifest = try_load_manifest::<Good>().expect("manifest");
    let (modes, modules) = load_ir_modules_strict::<Good>(&manifest).expect("all good");
    assert_eq!(modes.get("/"), Some(&RenderMode::Phase2SsrReconcile));
    assert!(modules.contains_key("/"));
    // `/app` has no `ir`: nothing to load, nothing to refuse.
    assert_eq!(modes.get("/app"), None);
    assert!(!modules.contains_key("/app"));
}

#[test]
fn ir_modules_load_refuses_exactly_what_the_strict_loader_refuses() {
    // `IrModules::load` (FORMA-166) is the strict loader with a development
    // reload on top: the same modules load, and the same failures, with the
    // same codes, refuse the start.
    fn sorted(mut errors: Vec<IrLoadError>) -> Vec<IrLoadError> {
        errors.sort_by(|a, b| a.route.cmp(&b.route));
        errors
    }
    let flipped = try_load_manifest::<Flipped>().expect("manifest");
    assert_eq!(
        sorted(IrModules::<Flipped>::load(&flipped).expect_err("refused")),
        sorted(load_ir_modules_strict::<Flipped>(&flipped).expect_err("refused"))
    );
    let truncated = try_load_manifest::<Truncated>().expect("manifest");
    assert_eq!(
        sorted(IrModules::<Truncated>::load(&truncated).expect_err("refused")),
        sorted(load_ir_modules_strict::<Truncated>(&truncated).expect_err("refused"))
    );
    let good = try_load_manifest::<Good>().expect("manifest");
    let modules = IrModules::<Good>::load(&good).expect("loads");
    let (_, strict) = load_ir_modules_strict::<Good>(&good).expect("loads");
    let page = modules.get("/").expect("the good page");
    assert_eq!(page.opcodes, strict["/"].opcodes);
    assert!(modules.get("/app").is_none(), "ssr: false has no module");
}

#[test]
#[allow(deprecated)]
fn the_deprecated_lenient_loader_behaves_as_at_0_2_1() {
    // Every bad route degrades to Phase 1 and the rest load: exactly what
    // 0.2.1's `load_ir_modules` returned for the same files.
    let manifest = try_load_manifest::<Flipped>().expect("manifest");
    let (modes, modules) = forma_server::load_ir_modules::<Flipped>(&manifest);
    for route in ["/magic", "/version", "/section", "/opcode"] {
        assert_eq!(
            modes.get(route),
            Some(&RenderMode::Phase1ClientMount),
            "{route}"
        );
        assert!(!modules.contains_key(route), "{route}");
    }
    for route in ["/", "/hash"] {
        assert_eq!(
            modes.get(route),
            Some(&RenderMode::Phase2SsrReconcile),
            "{route}"
        );
        assert!(modules.contains_key(route), "{route}");
    }
    assert_eq!(modes.get("/app"), None);
    assert_eq!(modes.len(), 6);
}

// -- A fixture server: load, then bind ----------------------------------------

/// Which loader the fixture server starts with.
#[derive(Debug, Clone, Copy)]
enum Loader {
    /// The default: `load_ir_modules_strict`.
    Default,
    /// The deprecated `load_ir_modules`.
    Lenient,
}

#[derive(Debug)]
#[allow(dead_code)] // the payloads are read through `Debug`, in failure messages
enum StartError {
    Manifest(String),
    Modules(Vec<IrLoadError>),
    Io(std::io::Error),
}

/// A server's start in the order DR-11 asks for: load every module, then bind
/// the port, then serve. It answers one connection with the number of pages
/// it can server-render, and returns.
fn serve<A: Embed>(
    loader: Loader,
    bind: impl FnOnce() -> std::io::Result<TcpListener>,
) -> Result<(), StartError> {
    let manifest = try_load_manifest::<A>().map_err(StartError::Manifest)?;
    let modules = match loader {
        Loader::Default => {
            load_ir_modules_strict::<A>(&manifest)
                .map_err(StartError::Modules)?
                .1
        }
        #[allow(deprecated)]
        Loader::Lenient => forma_server::load_ir_modules::<A>(&manifest).1,
    };
    let listener = bind().map_err(StartError::Io)?;
    let (mut stream, _) = listener.accept().map_err(StartError::Io)?;
    write!(stream, "{} server-rendered pages", modules.len()).map_err(StartError::Io)?;
    Ok(())
}

/// Start `serve` on its own thread. Report the address only after binding an
/// OS-assigned port; probing and releasing a "free" port races other tests.
fn spawn<A: Embed + 'static>(
    loader: Loader,
) -> (
    mpsc::Receiver<Result<(), StartError>>,
    mpsc::Receiver<SocketAddr>,
) {
    let (tx, rx) = mpsc::channel();
    let (bound_tx, bound_rx) = mpsc::channel();
    std::thread::spawn(move || {
        let result = serve::<A>(loader, move || {
            let listener = TcpListener::bind("127.0.0.1:0")?;
            let _ = bound_tx.send(listener.local_addr()?);
            Ok(listener)
        });
        let _ = tx.send(result);
    });
    (rx, bound_rx)
}

#[test]
fn with_a_bad_module_the_fixture_server_binds_no_port() {
    let (started, bound) = spawn::<Flipped>(Loader::Default);

    // It refuses at once, naming the bad modules...
    match started.recv_timeout(Duration::from_secs(5)) {
        Ok(Err(StartError::Modules(errors))) => {
            let routes: Vec<_> = errors.iter().map(|e| e.route.as_str()).collect();
            assert_eq!(errors.len(), 4, "{routes:?}");
        }
        other => panic!("expected a refused start, got {other:?}"),
    }
    // ...and the binding closure was never called. An unrelated listener can
    // no longer masquerade as this fixture's server or consume its connection.
    assert_eq!(
        bound.try_recv(),
        Err(mpsc::TryRecvError::Disconnected),
        "a refused server must not have bound a port"
    );
}

#[test]
fn the_same_server_binds_and_serves_with_good_modules_or_the_lenient_loader() {
    // The other side of the test above: this server does bind and answer when
    // its modules are good, and the deprecated lenient loader starts it even
    // with the bad ones, serving their routes in Phase 1 (what DR-11 ends).
    for (set, loader, expected) in [
        ("good", Loader::Default, "1 server-rendered pages"),
        ("flipped", Loader::Lenient, "2 server-rendered pages"),
    ] {
        let (started, bound) = match set {
            "good" => spawn::<Good>(loader),
            _ => spawn::<Flipped>(loader),
        };
        let addr = bound
            .recv_timeout(Duration::from_secs(5))
            .unwrap_or_else(|error| panic!("{set}: server did not bind: {error}"));
        let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(5))
            .unwrap_or_else(|error| panic!("{set}: cannot connect to {addr}: {error}"));
        let mut reply = String::new();
        stream.read_to_string(&mut reply).expect("reply");
        assert_eq!(reply, expected, "{set} with {loader:?}");
        assert!(matches!(
            started.recv_timeout(Duration::from_secs(5)),
            Ok(Ok(()))
        ));
    }
}
