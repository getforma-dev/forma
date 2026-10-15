//! This test is compiled in an isolated source copy stamped 3.1.0-dev. It uses
//! the public production loader; no expected-reader injection is available.
use forma_server::{assets, load_ir_modules, AssetManifest};
#[derive(forma_ir::PageProps)] struct WindowProps { title: String }
use rust_embed::Embed;
use std::net::TcpListener;
#[derive(Embed)] #[folder="tests/fixtures/renderer-window/same/"] struct Same;
#[derive(Embed)] #[folder="tests/fixtures/renderer-window/older/"] struct Older;
#[derive(Embed)] #[folder="tests/fixtures/renderer-window/patch/"] struct Patch;
#[derive(Embed)] #[folder="tests/fixtures/renderer-window/newer/"] struct Newer;
fn start<A:Embed + 'static>(manifest:&AssetManifest,bound:&mut bool)->Result<TcpListener,String> {
    let pages=load_ir_modules::<A>(manifest).map_err(|errors|errors.iter().map(ToString::to_string).collect::<Vec<_>>().join("; "))?;
    pages.bind::<WindowProps>("/").map_err(|e|format!("{e:?}"))?;
    pages.finalize().map_err(|e|format!("{e:?}"))?;
    let listener=TcpListener::bind("127.0.0.1:0").map_err(|e|e.to_string())?;
    *bound=true;Ok(listener)
}
fn accepts<A:Embed + 'static>() {
    let manifest=assets::try_load_manifest::<A>().unwrap();
    let mut bound=false;let listener=start::<A>(&manifest,&mut bound).unwrap();
    assert!(bound);assert_ne!(listener.local_addr().unwrap().port(),0);
}
#[test]
fn real_3_1_renderer_accepts_older_same_and_different_patch_writers() {
    assert_eq!(env!("CARGO_PKG_VERSION"),"3.1.0-dev");
    assert_eq!(forma_ir::format::reader_version(),[3,1,0]);
    accepts::<Older>();accepts::<Same>();accepts::<Patch>();
}
#[test]
fn real_3_1_renderer_refuses_3_2_module_and_manifest_before_binding() {
    assert_eq!(env!("CARGO_PKG_VERSION"),"3.1.0-dev");
    let manifest=assets::try_load_manifest::<Newer>().unwrap();
    let mut bound=false;let error=start::<Newer>(&manifest,&mut bound).unwrap_err();
    assert!(!bound);for expected in ["LOAD-108","3.2.0","3.1.0","route /","page.ir"] {assert!(error.contains(expected),"{error}");}
    let mut manifest=assets::try_load_manifest::<Same>().unwrap();manifest.writer="3.2.0".into();
    let error=start::<Same>(&manifest,&mut bound).unwrap_err();
    assert!(!bound);for expected in ["MANIFEST-102","3.2.0","3.1.0"] {assert!(error.contains(expected),"{error}");}
}
