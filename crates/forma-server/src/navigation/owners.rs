//! Opaque typed owner composition. There is deliberately no raw-fragment constructor.
use super::*;
use crate::{AssetManifest, PageResponse};
use serde_json::{json, Value};
use std::{collections::HashSet, ops::Range};

const MAX_BYTES: usize = 1_048_576;
const MAX_OWNERS: usize = 32;
const MAX_ISLANDS: usize = 200;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OwnerIdentity {
    id: String,
    parent: Option<String>,
    contract: String,
    reuse_key: String,
    props_digest: String,
    outlet: Option<String>,
}

/// Independently rendered, typed page owner. Every field is private: application
/// strings cannot forge HTML, island state, compiler identity or admission policy.
/// Construct through [`crate::PageHandle::render_owner`].
#[derive(Debug)]
pub struct NavigationOwner {
    identity: OwnerIdentity,
    body: String,
    state: Value,
    markup: Markup,
    admission: Value,
    title: String,
    route: String,
    manifest: AssetManifest,
    ctx: RenderCtx,
    nonce: crate::CspNonce,
    policy: crate::csp::PagePolicy,
    counts: RenderCounts,
    limit: usize,
}
impl NavigationOwner {
    pub(crate) fn from_render(
        config: &PageConfig,
        ctx: &RenderCtx,
        module: &forma_ir::IrModule,
        values: &Value,
        reuse_key: &str,
        content: crate::render::RenderedContent,
    ) -> Result<Self, RenderError> {
        validate_sealed(config, ctx)?;
        if reuse_key.is_empty()
            || reuse_key.len() > 128
            || !reuse_key
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':'))
        {
            return Err(refusal(
                config.route_pattern,
                "owner reuse key requires 1..128 ASCII identifier bytes",
            ));
        }
        let route = config
            .manifest
            .route(config.route_pattern)
            .ok_or_else(|| refusal(config.route_pattern, "missing declared route"))?;
        let declaration = route.navigation.as_ref().ok_or_else(|| {
            refusal(
                config.route_pattern,
                "owner requires compiler/build navigation metadata",
            )
        })?;
        let nav = ctx
            .navigation()
            .ok_or_else(|| refusal(config.route_pattern, "missing navigation context"))?;
        if declaration.group != nav.group {
            return Err(refusal(
                config.route_pattern,
                "request and compiler navigation groups differ",
            ));
        }
        let state: Value = serde_json::from_str(
            content
                .island_state
                .as_ref()
                .ok_or_else(|| {
                    refusal(
                        config.route_pattern,
                        "owner requires adoptable island state",
                    )
                })?
                .as_json(),
        )
        .map_err(|_| refusal(config.route_pattern, "invalid internal island state"))?;
        let occurrences = state
            .get("i")
            .and_then(Value::as_array)
            .ok_or_else(|| refusal(config.route_pattern, "invalid internal state occurrences"))?
            .len();
        if occurrences > MAX_ISLANDS {
            return Err(refusal(
                config.route_pattern,
                "native owner exceeds 200 island occurrences",
            ));
        }
        let body = content
            .ssr_body
            .ok_or_else(|| refusal(config.route_pattern, "missing owner body"))?;
        let markup = inspect(&body, declaration.outlet.as_deref(), occurrences)
            .map_err(|message| refusal(config.route_pattern, message))?;
        let contract = hash(&[b"forma-owner-contract-v1", module.raw_bytes()]);
        let props = bounded_json(values, MAX_BYTES)
            .map_err(|_| refusal(config.route_pattern, "declared owner props exceed 1 MiB"))?;
        let props_digest = hash(&[b"forma-owner-props-v1", &props]);
        let reuse_key = hash(&[
            b"forma-owner-reuse-v1",
            reuse_key.as_bytes(),
            nav.context.as_bytes(),
            contract.as_bytes(),
            props_digest.as_bytes(),
        ]);
        let mut admission = serde_json::to_value(metadata(config, ctx)?)
            .map_err(|_| refusal(config.route_pattern, "cannot encode owner admission"))?;
        admission
            .as_object_mut()
            .ok_or_else(|| refusal(config.route_pattern, "invalid internal metadata"))?
            .remove("route");
        admission["assets"] = serde_json::to_value(route_assets(config, ctx)?)
            .map_err(|_| refusal(config.route_pattern, "cannot encode owner assets"))?;
        admission["policyProfile"] = json!(POLICY_PROFILE);
        admission["actions"] = json!(
            nav.sealed
                .as_ref()
                .ok_or_else(|| refusal(config.route_pattern, "missing sealed profile"))?
                .actions
        );
        Ok(Self {
            identity: OwnerIdentity {
                id: declaration.owner.clone(),
                parent: None,
                contract,
                reuse_key,
                props_digest,
                outlet: declaration.outlet.clone(),
            },
            body,
            state,
            markup,
            admission,
            title: config.title.into(),
            route: config.route_pattern.into(),
            manifest: config.manifest.clone(),
            ctx: ctx.clone(),
            nonce: content.nonce,
            policy: content.policy,
            counts: content.counts,
            limit: content.output_limit.min(MAX_BYTES),
        })
    }
}

/// An ordered root-to-leaf branch made only from currently bound typed owners.
/// The parent relation is assigned here; callers cannot invent an owner fragment.
/// Authentication failures (401/403) must leave this protocol and invalidate
/// private client owners before a full document authentication transition.
#[derive(Debug)]
pub struct NavigationBranch {
    route: String,
    owners: Vec<NavigationOwner>,
    status: StatusCode,
    counts: RenderCounts,
    limit: usize,
}
impl NavigationBranch {
    /// Validate a complete ordered branch for the actual request pathname.
    /// All owners must share app/build, compiled assets, sealed policy, action
    /// allowlist, layout generation and security context. The leaf has no outlet.
    pub fn new(pathname: &str, mut owners: Vec<NavigationOwner>) -> Result<Self, RenderError> {
        if !pathname_valid(pathname) {
            return Err(refusal(pathname, "branch requires a root-relative pathname without query, fragment, controls or dot segments"));
        }
        if owners.is_empty() || owners.len() > MAX_OWNERS {
            return Err(refusal(pathname, "native branch requires 1..32 owners"));
        }
        let mut ids = HashSet::new();
        let mut counts = RenderCounts::default();
        let mut limit = MAX_BYTES;
        let mut occurrences = 0usize;
        let mut total_body = 0usize;
        let mut total_state = 0usize;
        let mut nodes = 0usize;
        let mut parent_depth = 0usize;
        for (index, owner) in owners.iter().enumerate() {
            if !ids.insert(&owner.identity.id)
                || owner.admission != owners[0].admission
                || owner.identity.outlet.is_some() != (index + 1 < owners.len())
            {
                return Err(refusal(pathname, "native branch has duplicate owners, incompatible admission/assets, or an incomplete outlet chain"));
            }
            nodes = nodes.saturating_add(owner.markup.nodes + 2);
            if nodes > 10_000 || parent_depth + owner.markup.depth + 1 > 64 {
                return Err(refusal(
                    pathname,
                    "native branch exceeds 10000 markup tokens or 64 levels",
                ));
            }
            parent_depth += owner.markup.outlet_depth + 1;
            occurrences += owner.state["i"]
                .as_array()
                .ok_or_else(|| refusal(pathname, "invalid internal occurrences"))?
                .len();
            total_body = total_body.saturating_add(owner.body.len());
            total_state = total_state.saturating_add(
                bounded_json(&owner.state, MAX_BYTES)
                    .map_err(|_| refusal(pathname, "owner state exceeds budget"))?
                    .len(),
            );
            limit = limit.min(owner.limit);
            counts.nodes = counts.nodes.saturating_add(owner.counts.nodes);
            counts.bytes = counts.bytes.saturating_add(owner.counts.bytes);
            counts.list_iterations = counts
                .list_iterations
                .saturating_add(owner.counts.list_iterations);
            counts.walk_time = counts.walk_time.saturating_add(owner.counts.walk_time);
        }
        if occurrences > MAX_ISLANDS || total_body.saturating_add(total_state) > limit {
            return Err(refusal(
                pathname,
                "native branch exceeds its combined body or 200-island budget",
            ));
        }
        for index in 1..owners.len() {
            owners[index].identity.parent = Some(owners[index - 1].identity.id.clone());
        }
        Ok(Self {
            route: pathname.into(),
            owners,
            status: StatusCode::OK,
            counts,
            limit,
        })
    }

    /// Preserve the same typed error status in both full documents and JSON.
    /// Supported renderable statuses: 200, 404, 410, 500 and 503. Other failures
    /// need their ordinary document/authentication boundary.
    pub fn with_status(mut self, status: StatusCode) -> Result<Self, NavigationInputError> {
        if !matches!(status.as_u16(), 200 | 404 | 410 | 500 | 503) {
            return Err(NavigationInputError(
                "native branch status must be 200, 404, 410, 500 or 503",
            ));
        }
        self.status = status;
        Ok(self)
    }

    fn envelope(&self, include_content: bool) -> Result<Value, RenderError> {
        let mut value = self.owners[0].admission.clone();
        value["route"] = json!(self.route);
        value["status"] = json!(self.status.as_u16());
        value["kind"] = json!(if self.status == StatusCode::OK {
            "page"
        } else {
            "error"
        });
        value["title"] = json!(
            self.owners
                .last()
                .ok_or_else(|| refusal(&self.route, "missing branch leaf"))?
                .title
        );
        value["owners"] = Value::Array(
            self.owners
                .iter()
                .map(|owner| {
                    let mut entry = serde_json::to_value(&owner.identity)
                        .map_err(|_| refusal(&self.route, "invalid owner identity"))?;
                    if include_content {
                        entry["html"] = json!(wrapper(owner, &owner.body));
                        entry["state"] = owner.state.clone();
                    }
                    Ok(entry)
                })
                .collect::<Result<Vec<_>, RenderError>>()?,
        );
        Ok(value)
    }

    /// Emit bounded native JSON with local per-owner occurrence indices.
    pub fn into_navigation_response(self) -> Result<NavigationResponse, RenderError> {
        let bytes = bounded_json(&self.envelope(true)?, self.limit).map_err(|_| self.budget())?;
        Ok(NavigationResponse {
            bytes,
            counts: self.counts,
            status: self.status,
        })
    }

    /// Emit a complete document under the same policy. Initial state is one
    /// immutable head authority; island occurrence indices are reindexed across
    /// all owners before initial adoption. The outer router container survives
    /// subsequent branch replacements.
    pub fn into_document_response(mut self) -> Result<PageResponse, RenderError> {
        let metadata =
            bounded_json(&self.envelope(false)?, self.limit).map_err(|_| self.budget())?;
        let metadata = String::from_utf8(metadata)
            .map_err(|_| refusal(&self.route, "invalid internal JSON encoding"))?
            .replace('<', "\\u003c");
        let metadata = format!(
            "<script type=\"application/json\" data-forma-navigation>{metadata}</script>\n"
        );
        let mut instances = Vec::new();
        let mut bodies = Vec::new();
        for owner in &self.owners {
            bodies.push(reindex(&owner.body, &owner.markup.states, instances.len()));
            instances.extend(
                owner.state["i"]
                    .as_array()
                    .ok_or_else(|| refusal(&self.route, "invalid internal occurrences"))?
                    .iter()
                    .cloned(),
            );
        }
        let state = bounded_json(&json!({"v":1,"s":[],"i":instances}), self.limit)
            .map_err(|_| self.budget())?;
        let state = String::from_utf8(state)
            .map_err(|_| refusal(&self.route, "invalid internal JSON encoding"))?
            .replace('<', "\\u003c");
        let mut body = String::new();
        for (owner, mut own_body) in self.owners.iter().zip(bodies).rev() {
            if let Some(outlet) = owner.identity.outlet.as_deref() {
                // Reindexing changes positions, so locate the checked empty tag
                // again in generated markup, rather than retaining stale offsets.
                let marker = format!("<div data-forma-outlet=\"{outlet}\"></div>");
                let at = own_body
                    .find(&marker)
                    .ok_or_else(|| refusal(&self.route, "checked outlet disappeared"))?
                    + marker.len()
                    - 6;
                if own_body.len().saturating_add(body.len()) > self.limit {
                    return Err(self.budget());
                }
                own_body.insert_str(at, &body);
            }
            body = wrapper(owner, &own_body);
            if body.len() > self.limit {
                return Err(self.budget());
            }
        }
        let title = self
            .owners
            .last()
            .ok_or_else(|| refusal(&self.route, "missing branch leaf"))?
            .title
            .clone();
        let root = self.owners.remove(0);
        let config = PageConfig {
            title: &title,
            route_pattern: &root.route,
            manifest: &root.manifest,
            config_json: None,
            body_class: None,
            personality_css: None,
            body_prefix: None,
        };
        let html = crate::template::write_document_parts(
            &config,
            &root.nonce,
            Some(&body),
            Some(&state),
            &root.ctx,
            self.limit,
            self.counts,
            &metadata,
            true,
        )?;
        Ok(
            PageResponse::with_policy(html, root.nonce, root.policy, self.counts)
                .with_navigation()
                .with_status(self.status),
        )
    }

    /// A same-origin GET redirect as data. HTTP remains 200 so Fetch cannot
    /// silently follow a document redirect. The client checks admission before
    /// following with its bounded single-history-entry navigation transaction.
    pub fn into_redirect(self, location: &str) -> Result<NavigationResponse, RenderError> {
        if !redirect_valid(location) {
            return Err(refusal(
                &self.route,
                "native redirect requires a root-relative same-origin URL",
            ));
        }
        let mut value = self.owners[0].admission.clone();
        value["route"] = json!(self.route);
        value["kind"] = json!("redirect");
        value["status"] = json!(200);
        value["location"] = json!(location);
        let bytes = bounded_json(&value, self.limit).map_err(|_| self.budget())?;
        Ok(NavigationResponse {
            bytes,
            counts: self.counts,
            status: StatusCode::OK,
        })
    }

    fn budget(&self) -> RenderError {
        RenderError::Budget {
            route: self.route.clone(),
            component_path: vec![],
            counts: self.counts,
            cause: forma_ir::IrError::OutputLimitExceeded { limit: self.limit },
        }
    }
}
fn hash(parts: &[&[u8]]) -> String {
    let mut digest = ring::digest::Context::new(&ring::digest::SHA256);
    for part in parts {
        digest.update(&(part.len() as u64).to_le_bytes());
        digest.update(part);
    }
    digest
        .finish()
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
fn wrapper(owner: &NavigationOwner, body: &str) -> String {
    format!(
        "<div data-forma-owner=\"{}\" data-forma-ssr data-forma-build=\"{}\">{body}</div>",
        owner.identity.id,
        crate::template::escape_html(&owner.manifest.build)
    )
}
fn redirect_valid(location: &str) -> bool {
    location.starts_with('/')
        && !location.starts_with("//")
        && location.len() <= 2048
        && !location
            .bytes()
            .any(|byte| byte == b'\\' || byte <= 0x20 || byte == 0x7f)
}
fn pathname_valid(pathname: &str) -> bool {
    redirect_valid(pathname)
        && !pathname.contains(['?', '#'])
        && !pathname.split('/').any(|part| matches!(part, "." | ".."))
}

#[derive(Debug)]
struct Markup {
    states: Vec<(Range<usize>, usize)>,
    nodes: usize,
    depth: usize,
    outlet_depth: usize,
}
/// Inspect actual start tags only. Literal text and quoted attribute contents
/// cannot impersonate state markers or outlets. This parser is intentionally
/// limited to markup emitted by Forma's checked renderer; it is not an HTML API.
fn inspect(body: &str, outlet: Option<&str>, occurrences: usize) -> Result<Markup, &'static str> {
    let mut position = 0usize;
    let mut states = Vec::new();
    let mut seen = HashSet::new();
    let mut stack: Vec<(String, bool)> = Vec::new();
    let mut outlets = 0;
    let mut nodes = 0usize;
    let mut depth = 0usize;
    let mut outlet_depth = 0usize;
    while let Some(relative) = body[position..].find('<') {
        nodes += 1 + usize::from(relative > 0);
        if nodes > 9_998 {
            return Err("native owner exceeds 10000 markup tokens");
        }
        let start = position + relative;
        if body[start..].starts_with("<!--") {
            position = start
                + body[start..]
                    .find("-->")
                    .ok_or("unterminated renderer comment")?
                + 3;
            continue;
        }
        let mut cursor = start + 1;
        let closing = body.as_bytes().get(cursor) == Some(&b'/');
        if closing {
            cursor += 1;
        }
        let name_start = cursor;
        while body
            .as_bytes()
            .get(cursor)
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b':'))
        {
            cursor += 1;
        }
        if cursor == name_start {
            return Err("invalid renderer tag");
        }
        let name = &body[name_start..cursor];
        if name != name.to_ascii_lowercase()
            || name.contains(['-', ':'])
            || matches!(
                name,
                "script"
                    | "iframe"
                    | "object"
                    | "embed"
                    | "base"
                    | "meta"
                    | "link"
                    | "style"
                    | "template"
                    | "img"
                    | "audio"
                    | "video"
                    | "source"
                    | "track"
                    | "svg"
                    | "math"
                    | "head"
                    | "html"
                    | "body"
            )
        {
            return Err(
                "native owner contains a forbidden resource, policy, custom or namespace element",
            );
        }
        let mut attributes = Vec::new();
        let mut self_close = false;
        loop {
            while body
                .as_bytes()
                .get(cursor)
                .is_some_and(u8::is_ascii_whitespace)
            {
                cursor += 1;
            }
            match body.as_bytes().get(cursor) {
                Some(b'>') => {
                    cursor += 1;
                    break;
                }
                Some(b'/') if body.as_bytes().get(cursor + 1) == Some(&b'>') => {
                    cursor += 2;
                    self_close = true;
                    break;
                }
                None => return Err("unterminated renderer tag"),
                _ => {}
            }
            let begin = cursor;
            while body.as_bytes().get(cursor).is_some_and(|byte| {
                !byte.is_ascii_whitespace() && !matches!(byte, b'=' | b'>' | b'/')
            }) {
                cursor += 1;
            }
            if begin == cursor || closing {
                return Err("invalid renderer attribute");
            }
            let attribute = &body[begin..cursor];
            while body
                .as_bytes()
                .get(cursor)
                .is_some_and(u8::is_ascii_whitespace)
            {
                cursor += 1;
            }
            let value = if body.as_bytes().get(cursor) == Some(&b'=') {
                cursor += 1;
                if body.as_bytes().get(cursor) != Some(&b'"') {
                    return Err("renderer attribute must be quoted");
                }
                cursor += 1;
                let begin = cursor;
                cursor += body[cursor..]
                    .find('"')
                    .ok_or("unterminated renderer attribute")?;
                let range = begin..cursor;
                cursor += 1;
                range
            } else {
                cursor..cursor
            };
            if attributes.iter().any(|(prior, _)| *prior == attribute) {
                return Err("duplicate renderer attribute");
            }
            attributes.push((attribute, value));
        }
        position = cursor;
        if closing {
            if stack.pop().as_ref().is_none_or(|(open, _)| open != name) {
                return Err("unbalanced renderer owner tags");
            }
            continue;
        }
        let island = attributes
            .iter()
            .any(|(attribute, _)| *attribute == "data-forma-island");
        for (attribute, range) in &attributes {
            let lower = attribute.to_ascii_lowercase();
            if lower.starts_with("on")
                || matches!(
                    lower.as_str(),
                    "is" | "shadowrootmode" | "srcdoc" | "style" | "background"
                )
            {
                return Err("native owner contains a forbidden executable or styling attribute");
            }
            if name == "input"
                && lower == "type"
                && body[range.clone()].eq_ignore_ascii_case("image")
            {
                return Err("native owner cannot contain image input resources");
            }
            if matches!(
                lower.as_str(),
                "href" | "src" | "action" | "formaction" | "background" | "poster"
            ) && !relative_url(&body[range.clone()])
            {
                return Err("native owner URLs must be relative and same-origin");
            }
            if lower.starts_with("data-forma-") && lower != *attribute {
                return Err("native owner marker attributes must use their canonical spelling");
            }
            match *attribute {
                "data-forma-owner" | "data-forma-router-root" => {
                    return Err("owner markup cannot declare reserved owner wrappers")
                }
                "data-forma-state" => {
                    let index = body[range.clone()]
                        .parse::<usize>()
                        .map_err(|_| "invalid occurrence index")?;
                    if !island || index >= occurrences || !seen.insert(index) {
                        return Err(
                            "owner occurrence index is missing, duplicated or out of range",
                        );
                    }
                    states.push((range.clone(), index));
                }
                "data-forma-outlet" => {
                    outlets += 1;
                    outlet_depth = stack.len() + 1;
                    if outlet != Some(&body[range.clone()])
                        || name != "div"
                        || attributes.len() != 1
                        || stack.iter().any(|(_, island)| *island)
                        || island
                        || self_close
                        || !body[cursor..].starts_with("</div>")
                    {
                        return Err("owner outlet must be one declared empty div outside every island subtree");
                    }
                }
                _ => {}
            }
        }
        if !self_close
            && !matches!(
                name,
                "area"
                    | "base"
                    | "br"
                    | "col"
                    | "embed"
                    | "hr"
                    | "img"
                    | "input"
                    | "link"
                    | "meta"
                    | "param"
                    | "source"
                    | "track"
                    | "wbr"
            )
        {
            stack.push((name.into(), island));
            depth = depth.max(stack.len());
            if depth >= 64 {
                return Err("native owner exceeds 64 levels including its wrapper");
            }
        }
    }
    if !stack.is_empty() || outlets != usize::from(outlet.is_some()) || states.len() != occurrences
    {
        return Err("owner markup is incomplete or disagrees with its island/outlet declaration");
    }
    nodes += usize::from(position < body.len());
    Ok(Markup {
        states,
        nodes,
        depth,
        outlet_depth,
    })
}
// Values have been escaped once by the renderer. Decode that layer once only;
// cascading replacements would mistakenly decode application text twice.
fn relative_url(value: &str) -> bool {
    let mut decoded = String::new();
    let mut rest = value;
    while let Some(at) = rest.find('&') {
        decoded.push_str(&rest[..at]);
        rest = &rest[at..];
        let replacement = [
            ("&amp;", '&'),
            ("&quot;", '"'),
            ("&lt;", '<'),
            ("&gt;", '>'),
            ("&#39;", '\''),
            ("&#x27;", '\''),
        ]
        .into_iter()
        .find(|(entity, _)| rest.starts_with(entity));
        if let Some((entity, character)) = replacement {
            decoded.push(character);
            rest = &rest[entity.len()..];
        } else {
            return false;
        }
    }
    decoded.push_str(rest);
    !decoded.starts_with("//")
        && !decoded
            .bytes()
            .any(|byte| byte == b'\\' || byte <= 0x20 || byte == 0x7f)
        && !decoded
            .split(['/', '?', '#'])
            .next()
            .unwrap_or("")
            .contains(':')
}

fn reindex(body: &str, states: &[(Range<usize>, usize)], offset: usize) -> String {
    let mut output = String::with_capacity(body.len());
    let mut last = 0;
    for (range, index) in states {
        output.push_str(&body[last..range.start]);
        output.push_str(&(index + offset).to_string());
        last = range.end;
    }
    output.push_str(&body[last..]);
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sealed_fragment_profile_rejects_policy_resources_upgrades_and_unsafe_urls() {
        for body in [
            "<script></script>",
            "<SCRIPT></SCRIPT>",
            "<meta>",
            "<img>",
            "<svg></svg>",
            "<custom-element></custom-element>",
            "<div is=\"custom\"></div>",
            "<div OnClick=\"run()\"></div>",
            "<div style=\"display:none\"></div>",
            "<a href=\"https://elsewhere.example\"></a>",
            "<a href=\"javascript:run()\"></a>",
            "<a href=\"//elsewhere.example\"></a>",
            "<div DATA-FORMA-OWNER=\"fake\"></div>",
            "<input type=\"image\">",
            "<div background=\"/resource\"></div>",
        ] {
            assert!(inspect(body, None, 0).is_err(), "accepted {body}");
        }
        for body in [
            "<a href=\"/safe?q=1&amp;q=2\"></a>",
            "<a href=\"../safe#part\"></a>",
            "<form action=\"/save\"></form>",
        ] {
            assert!(inspect(body, None, 0).is_ok(), "refused {body}");
        }
    }
    #[test]
    fn marker_inspection_and_reindex_ignore_quoted_values_text_and_comments() {
        let body = "<!--data-forma-state=\"9\"--><div title=\"data-forma-state=&quot;9&quot;\" data-forma-island=\"0\" data-forma-state=\"0\">data-forma-state=\"9\"</div>";
        let markup = inspect(body, None, 1).unwrap();
        let shifted = reindex(body, &markup.states, 7);
        assert!(shifted.contains("data-forma-state=\"7\">data-forma-state=\"9\""));
        assert!(shifted.contains("<!--data-forma-state=\"9\"-->"));
        assert!(inspect(
            "<div data-forma-island=\"0\" data-forma-state=\"1\"></div>",
            None,
            1
        )
        .is_err());
    }
}
