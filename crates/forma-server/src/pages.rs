//! Startup binding between declared TypeScript page props and a derived Rust handler.
use crate::{
    AssetManifest, IrLoadError, Limits, PageConfig, PageResponse, RenderCtx, RenderError, RouteMode,
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
    collections::{HashMap, HashSet},
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
    seal: Arc<dyn Fn() -> Result<(), String> + Send + Sync>,
    registration: Arc<Mutex<Registration>>,
}
#[derive(Default)]
struct Registration {
    bound: HashSet<String>,
    finalized: bool,
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
        let modules = Arc::new(crate::ir::IrModules::<A>::load(manifest)?);
        let cache = Arc::clone(&modules);
        Ok(Self {
            manifest: Arc::new(manifest.clone()),
            get: Arc::new(move |route| modules.snapshot(route)),
            seal: Arc::new(move || cache.freeze_topology()),
            registration: Arc::new(Mutex::new(Registration::default())),
        })
    }

    /// Bind a route pattern or a logical page name (`home` resolves the manifest's
    /// `home.ir` alias). Names matching multiple routes are refused: bind the exact
    /// route in that case. Comparison and root-slot validation happen here, once.
    pub fn bind<P: PageProps>(&self, page: &str) -> Result<PageHandle<P>, Vec<PropsError>> {
        self.bind_with(page, Limits::default())
    }

    /// Bind this page with immutable defaults inherited by each request.
    pub fn bind_with<P: PageProps>(
        &self,
        page: &str,
        limits: Limits,
    ) -> Result<PageHandle<P>, Vec<PropsError>> {
        if self.is_finalized() {
            return Err(vec![error(
                "BIND-111",
                page,
                "",
                "page registry is already finalized",
            )]);
        }
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
        let mut registration = self.registration.lock().unwrap_or_else(|p| p.into_inner());
        if registration.finalized {
            return Err(vec![error(
                "BIND-111",
                &route,
                "",
                "page registry is already finalized",
            )]);
        }
        for warning in binding.props.warnings() {
            tracing::warn!(code = warning.code, route = %route, path = %warning.path, "{warning}");
        }
        registration.bound.insert(route.clone());
        Ok(PageHandle {
            inner: Arc::new(Handle {
                page: page.into(),
                limits,
                route,
                pages: self.clone(),
                binding: Mutex::new(Arc::new(binding)),
            }),
            marker: PhantomData,
        })
    }

    /// Complete startup after every SSR route has a verified handler. Call this
    /// before the application opens its listener. A refusal leaves registration
    /// open so missing handlers can be bound; success seals every clone together.
    /// Browser routes require no binding. Repeated successful calls are harmless.
    pub fn finalize(&self) -> Result<(), Vec<PropsError>> {
        let mut registration = self.registration.lock().unwrap_or_else(|p| p.into_inner());
        if registration.finalized {
            return Ok(());
        }
        let mut errors: Vec<_> = self.manifest.routes.iter()
            .filter(|(route, assets)| assets.mode == RouteMode::Ssr && !registration.bound.contains(*route))
            .map(|(route, assets)| error("BIND-110", route, "", format!("SSR module {} has no verified handler; bind it before opening the listener", assets.ir.as_deref().unwrap_or("<missing>"))))
            .collect();
        errors.sort_by(|a, b| a.route.cmp(&b.route));
        if !errors.is_empty() {
            return Err(errors);
        }
        (self.seal)().map_err(|message| vec![error("BIND-112", "<manifest>", "", message)])?;
        registration.finalized = true;
        Ok(())
    }

    fn is_finalized(&self) -> bool {
        self.registration
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .finalized
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
    limits: Limits,
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
    /// The page defaults selected at bind. A request override does not change them.
    pub fn limits(&self) -> Limits {
        self.inner.limits
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
        crate::render::guard(&self.inner.route, || self.render_inner(props, ctx))
    }

    /// Render the unreleased navigation representation from the same verified
    /// props and FMIR module. Requires `RenderCtx::with_navigation`.
    #[cfg(feature = "experimental-router")]
    pub fn render_navigation(
        &self,
        props: &P,
        ctx: &RenderCtx,
    ) -> Result<crate::NavigationResponse, RenderError> {
        crate::render::guard(&self.inner.route, || {
            self.with_render_input(props, ctx, |config, module, slots, limits| {
                crate::render::render_bound_navigation(config, ctx, module, slots, limits)
            })
        })
    }

    /// Render an opaque owner using this finalized typed binding. The compiler
    /// supplies its identity/outlet; the server hashes all checked declared props.
    /// `reuse_key` identifies a server-owned lifetime and is never an auth token.
    #[cfg(feature = "navigation")]
    pub fn render_owner(
        &self,
        props: &P,
        ctx: &RenderCtx,
        reuse_key: &str,
    ) -> Result<crate::NavigationOwner, RenderError> {
        crate::render::guard(&self.inner.route, || {
            self.with_render_values(props, ctx, |config, module, slots, limits, values| {
                crate::render::render_bound_owner(
                    config, ctx, module, slots, limits, values, reuse_key,
                )
            })
        })
    }

    /// Bind an enhanced action outcome to this finalized page's app/build and
    /// document policy. `endpoint` must be an exact canonical pathname chosen
    /// by the handler, not a URL copied from untrusted request input.
    #[cfg(feature = "navigation")]
    pub fn action_context(
        &self,
        ctx: &RenderCtx,
        endpoint: &str,
    ) -> Result<crate::ActionContext, RenderError> {
        crate::render::guard(&self.inner.route, || {
            self.with_bound_config(ctx, |config, _, _| {
                crate::ActionContext::from_bound(config, ctx, endpoint)
            })
        })
    }

    fn render_inner(&self, props: &P, ctx: &RenderCtx) -> Result<PageResponse, RenderError> {
        self.with_render_input(props, ctx, |config, module, slots, limits| {
            crate::render::render_bound(config, ctx, Some(module), Some(slots), limits)
        })
    }

    fn with_render_input<T>(
        &self,
        props: &P,
        ctx: &RenderCtx,
        finish: impl FnOnce(
            &PageConfig,
            &forma_ir::IrModule,
            &SlotData,
            Limits,
        ) -> Result<T, RenderError>,
    ) -> Result<T, RenderError> {
        self.with_render_values(props, ctx, |config, module, slots, limits, _| {
            finish(config, module, slots, limits)
        })
    }

    fn with_render_values<T>(
        &self,
        props: &P,
        ctx: &RenderCtx,
        finish: impl FnOnce(
            &PageConfig,
            &forma_ir::IrModule,
            &SlotData,
            Limits,
            &serde_json::Value,
        ) -> Result<T, RenderError>,
    ) -> Result<T, RenderError> {
        self.with_bound_config(ctx, |config, binding, limits| {
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
            finish(config, binding.props.module(), &slots, limits, &values)
        })
    }

    fn with_bound_config<T>(
        &self,
        ctx: &RenderCtx,
        finish: impl FnOnce(&PageConfig, &Binding<P>, Limits) -> Result<T, RenderError>,
    ) -> Result<T, RenderError> {
        if !self.inner.pages.is_finalized() {
            return Err(RenderError::Unfinalized {
                route: self.inner.route.clone(),
            });
        }
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
        #[allow(deprecated)]
        let config = PageConfig {
            title: ctx.title().unwrap_or(&self.inner.page),
            route_pattern: route,
            manifest: &manifest,
            config_json: ctx.config_json(),
            body_class: ctx.body_class(),
            personality_css: ctx.personality_css(),
            body_prefix: ctx.body_prefix(),
        };
        finish(&config, &binding, ctx.limits(self.inner.limits))
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
