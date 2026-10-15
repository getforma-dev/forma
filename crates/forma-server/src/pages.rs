//! Startup binding between declared TypeScript page props and a derived Rust handler.
use crate::{
    AssetManifest, IrLoadError, IrModules, PageConfig, PageResponse, RenderCtx, RenderError,
    RenderMode, RouteMode,
};
use forma_ir::{
    format::{SlotSource, SlotType},
    props::{BoundProps, PageProps, PropsError, PropsSource, PropsWarning},
    schema::PropType,
    slot::{json_to_slot_value, SlotData},
    IrModule,
};
use rust_embed::Embed;
use std::{
    collections::HashMap,
    fmt,
    marker::PhantomData,
    sync::{Arc, Mutex},
};

type GetModule = dyn Fn(&str) -> Option<(Arc<IrModule>, Arc<AssetManifest>)> + Send + Sync;

/// Strictly loaded pages. Bind each server-rendered handler before opening a listener.
/// Browser-only routes cannot produce a typed SSR handle.
#[derive(Clone)]
pub struct Pages {
    manifest: Arc<AssetManifest>,
    get: Arc<GetModule>,
}
impl fmt::Debug for Pages {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Pages")
            .field("routes", &self.manifest.routes.keys())
            .finish_non_exhaustive()
    }
}
impl Pages {
    pub(crate) fn load<A: Embed + 'static>(
        manifest: &AssetManifest,
    ) -> Result<Self, Vec<IrLoadError>> {
        let modules = IrModules::<A>::load(manifest)?;
        Ok(Self {
            manifest: Arc::new(manifest.clone()),
            get: Arc::new(move |route| modules.snapshot(route)),
        })
    }

    /// Bind a route pattern or a logical page name (`home` resolves the manifest's
    /// `home.ir` alias). Names matching multiple routes are refused: bind the exact
    /// route in that case. Comparison and root-slot validation happen here, once.
    pub fn bind<P: PageProps>(&self, page: &str) -> Result<PageHandle<P>, Vec<PropsError>> {
        let route = self.resolve(page).map_err(|e| vec![e])?;
        let (module, _) = (self.get)(&route).ok_or_else(|| {
            vec![error(
                "BIND-108",
                &route,
                "",
                "page is browser-only or has no current SSR module",
            )]
        })?;
        let binding = Binding::new(module, &route)?;
        for warning in binding.props.warnings() {
            tracing::warn!(code = warning.code, route = %route, path = %warning.path, "{warning}");
        }
        Ok(PageHandle {
            inner: Arc::new(Handle {
                page: page.into(),
                route,
                pages: self.clone(),
                binding: Mutex::new(Arc::new(binding)),
            }),
            marker: PhantomData,
        })
    }

    fn resolve(&self, page: &str) -> Result<String, PropsError> {
        if let Some(route) = self.manifest.routes.get(page) {
            return if route.mode == RouteMode::Browser {
                Err(error(
                    "BIND-108",
                    page,
                    "",
                    "browser-only route cannot bind server props",
                ))
            } else {
                Ok(page.into())
            };
        }
        let logical = format!("{page}.ir");
        let filename = self
            .manifest
            .aliases
            .get(&logical)
            .map(String::as_str)
            .unwrap_or(&logical);
        let mut routes: Vec<_> = self
            .manifest
            .routes
            .iter()
            .filter(|(_, assets)| assets.ir.as_deref() == Some(filename))
            .map(|(route, _)| route.clone())
            .collect();
        routes.sort();
        match routes.len() {
            0 => Err(error(
                "BIND-107",
                page,
                "",
                "unknown page; use a route pattern or the manifest's logical .ir alias",
            )),
            1 => Ok(routes.remove(0)),
            _ => Err(error(
                "BIND-109",
                page,
                "",
                format!(
                    "page name is ambiguous across {}; bind an exact route",
                    routes.join(", ")
                ),
            )),
        }
    }
}

struct Binding<P: PageProps> {
    props: BoundProps<P>,
    roots: Vec<(String, u16)>,
}
impl<P: PageProps> Binding<P> {
    fn new(module: Arc<IrModule>, route: &str) -> Result<Self, Vec<PropsError>> {
        let props = BoundProps::<P>::bind(module, route)?;
        let roots = root_slots(props.module(), route)?;
        Ok(Self { props, roots })
    }
}
struct Handle<P: PageProps> {
    page: String,
    route: String,
    pages: Pages,
    binding: Mutex<Arc<Binding<P>>>,
}

/// A verified handler contract. Clone it into application state; no constructor
/// accepts raw slots or an unverified module. Request values are checked before any
/// HTML is returned. In debug builds a changed module is bound again; an invalid
/// file keeps the loader's last good module, while a valid incompatible schema
/// returns `RENDER-405` until the handler or page is corrected.
pub struct PageHandle<P: PageProps> {
    inner: Arc<Handle<P>>,
    marker: PhantomData<fn() -> P>,
}
impl<P: PageProps> Clone for PageHandle<P> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            marker: PhantomData,
        }
    }
}
impl<P: PageProps> fmt::Debug for PageHandle<P> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PageHandle")
            .field("page", &self.inner.page)
            .field("route", &self.inner.route)
            .finish_non_exhaustive()
    }
}
impl<P: PageProps> PageHandle<P> {
    /// The exact route pattern associated with this handle.
    pub fn route(&self) -> &str {
        &self.inner.route
    }
    /// Extra Rust fields reported by the currently verified contract. They are
    /// omitted from encoded page data, even when their values are unsafe.
    pub fn warnings(&self) -> Vec<PropsWarning> {
        self.inner
            .binding
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .props
            .warnings()
            .to_vec()
    }
    /// Render with checked handler props and per-request metadata. The default
    /// document title is the name passed to `bind`; `RenderCtx::with_title`
    /// overrides it for this request. Head/policy/preload settings keep their
    /// existing typed wrappers. No raw script or HTML string enters this API.
    pub fn render(&self, props: &P, ctx: &RenderCtx) -> Result<PageResponse, RenderError> {
        let route = &self.inner.route;
        let (current, manifest) =
            (self.inner.pages.get)(route).ok_or_else(|| RenderError::Binding {
                route: route.clone(),
                errors: vec![error(
                    "BIND-108",
                    route,
                    "",
                    "bound route no longer has an SSR module",
                )],
            })?;
        let binding = {
            let mut stored = self.inner.binding.lock().unwrap_or_else(|p| p.into_inner());
            if !Arc::ptr_eq(stored.props.module_arc(), &current) {
                let fresh =
                    Binding::new(current, route).map_err(|errors| RenderError::Binding {
                        route: route.clone(),
                        errors,
                    })?;
                for warning in fresh.props.warnings() {
                    tracing::warn!(code = warning.code, route = %route, path = %warning.path, "{warning}");
                }
                *stored = Arc::new(fresh);
            }
            Arc::clone(&stored)
        };
        let values = binding
            .props
            .encode(props)
            .map_err(|cause| RenderError::Props { cause })?;
        let mut slots = SlotData::new_from_defaults(&binding.props.module().slots);
        for (name, id) in &binding.roots {
            slots.set(
                *id,
                json_to_slot_value(values.get(name).unwrap_or(&serde_json::Value::Null)),
            );
        }
        #[allow(deprecated)]
        let config = PageConfig {
            title: ctx.title().unwrap_or(&self.inner.page),
            route_pattern: route,
            manifest: &manifest,
            config_json: None,
            body_class: ctx.body_class(),
            personality_css: None,
            body_prefix: None,
            render_mode: RenderMode::Phase2SsrReconcile,
            ir_module: Some(binding.props.module()),
            slots: Some(&slots),
        };
        crate::try_render(&config, ctx)
    }
}

fn error(code: &'static str, route: &str, path: &str, message: impl Into<String>) -> PropsError {
    PropsError {
        code,
        route: route.into(),
        path: path.into(),
        message: message.into(),
        typescript: None,
        rust: None,
    }
}
fn slot_type(kind: &PropType) -> SlotType {
    match kind {
        PropType::Optional(inner) => slot_type(inner),
        PropType::Boolean => SlotType::Bool,
        PropType::Number | PropType::Date => SlotType::Number,
        PropType::Array(_) => SlotType::Array,
        PropType::Object(_) => SlotType::Object,
        PropType::String | PropType::Enum(_) => SlotType::Text,
    }
}
fn root_slots(module: &IrModule, route: &str) -> Result<Vec<(String, u16)>, Vec<PropsError>> {
    let Some(fields) = module.schema.objects.first() else {
        return Err(vec![error(
            "BIND-106",
            route,
            "",
            "page has no root schema",
        )]);
    };
    let mut declared = HashMap::new();
    let mut errors = Vec::new();
    for field in fields {
        if let Ok(name) = module.strings.get(field.name) {
            declared.insert(name, field);
        }
    }
    let mut bindings = HashMap::new();
    for slot in module.slots.entries() {
        if slot.source != SlotSource::Server {
            continue;
        }
        let name = module.strings.get(slot.name_str_idx).unwrap_or("");
        let problem = match declared.get(name) {
            None => Some("SERVER slot is not an exact declared root field"),
            Some(field) if slot.type_hint != slot_type(&field.kind) => {
                Some("SERVER slot type differs from its declared field")
            }
            Some(_) if !slot.default_bytes.is_empty() => {
                Some("SERVER root slot must not have a client default")
            }
            Some(_) if bindings.contains_key(name) => {
                Some("multiple SERVER slots bind the same declared root")
            }
            Some(_) => None,
        };
        if let Some(problem) = problem {
            errors.push(error("BIND-106", route, name, problem));
        } else {
            bindings.insert(name.to_owned(), slot.slot_id);
        }
    }
    let mut roots = Vec::new();
    for field in fields {
        let name = module.strings.get(field.name).unwrap_or("");
        if let Some(id) = bindings.remove(name) {
            roots.push((name.into(), id));
        } else {
            let mut refusal = error(
                "BIND-106",
                route,
                name,
                "declared root field has no unique SERVER slot",
            );
            refusal.typescript = module
                .strings
                .get(field.file)
                .ok()
                .map(|file| Box::new(PropsSource::new(file, field.line, field.column)));
            errors.push(refusal);
        }
    }
    if errors.is_empty() {
        Ok(roots)
    } else {
        Err(errors)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use forma_ir::{format::SlotEntry, parser::SlotTable};
    const EMITTED: &[u8] = include_bytes!("../tests/fixtures/props-contract/home.ir");
    fn slots(entries: &[SlotEntry]) -> SlotTable {
        let mut bytes = (entries.len() as u16).to_le_bytes().to_vec();
        for slot in entries {
            bytes.extend(slot.slot_id.to_le_bytes());
            bytes.extend(slot.name_str_idx.to_le_bytes());
            bytes.push(slot.type_hint as u8);
            bytes.push(slot.source as u8);
            bytes.extend((slot.default_bytes.len() as u16).to_le_bytes());
            bytes.extend(&slot.default_bytes);
        }
        SlotTable::parse(&bytes).unwrap()
    }
    #[test]
    fn root_bindings_reject_missing_duplicate_unknown_defaulted_and_wrong_type_slots() {
        let original = IrModule::parse(EMITTED).unwrap();
        assert_eq!(root_slots(&original, "/").unwrap().len(), 9);
        for change in 0..5 {
            let mut module = IrModule::parse(EMITTED).unwrap();
            let mut entries = module.slots.entries().to_vec();
            match change {
                0 => entries[0].source = SlotSource::Client,
                1 => {
                    let mut duplicate = entries[0].clone();
                    duplicate.slot_id = entries.len() as u16;
                    entries.push(duplicate);
                }
                2 => {
                    entries[0].name_str_idx = (0..module.strings.len() as u32)
                        .find(|&i| module.strings.get(i) == Ok("main"))
                        .unwrap()
                }
                3 => entries[0].default_bytes = b"untrusted default".to_vec(),
                _ => entries[0].type_hint = SlotType::Bool,
            }
            module.slots = slots(&entries);
            assert!(root_slots(&module, "/")
                .unwrap_err()
                .iter()
                .all(|e| e.code == "BIND-106"));
        }
    }
    #[test]
    fn a_same_named_client_slot_never_becomes_a_handler_target() {
        let mut module = IrModule::parse(EMITTED).unwrap();
        let mut entries = module.slots.entries().to_vec();
        let mut local = entries[0].clone();
        local.slot_id = entries.len() as u16;
        local.source = SlotSource::Client;
        local.default_bytes = b"local-only".to_vec();
        let local_id = local.slot_id;
        entries.push(local);
        module.slots = slots(&entries);
        assert!(!root_slots(&module, "/")
            .unwrap()
            .iter()
            .any(|(_, id)| *id == local_id));
    }
}
