# Router registry enrollment

This is preparation for the first coordinated 3.2 release. It does not claim that
`@getforma/router` exists on npm or that its publisher is enrolled. The read-only
registry query on 2026-10-26 returned E404. The source now configures the complete
target inventory before the D14/source freeze: five npm packages for the outside
observer and eight npm/crates identities for reconciliation. This is configured
coverage, not an observation of publication or publisher enrollment. A missing
registry package remains a hard failure with no baseline promotion. An existing
external four-package monitor may continue from its previously deployed version
until the audited successor is deployed after publication; its observations
remain explicitly four-package evidence.

npm [requires the package to exist before trusted-publisher enrollment](https://docs.npmjs.com/cli/v11/commands/npm-trust/).
The original V2 SR42 token exception covered only the first `forma-ir-derive`
publication. The founder explicitly authorized this additional, finite router
bootstrap on 2026-10-26; it is a new exception, not unchanged literal SR42
compliance or permission to publish other packages with a token.

For this first package, the guarded `release.yml` publish step may receive the
`npm-publish` environment secret `NPM_ROUTER_BOOTSTRAP_TOKEN` **only** for
`v3.2.0-rc.1`. It is optional and unset by default. No placeholder publication is
allowed. Obtain a short-lived granular token with permission to create the actual
package, bypass-2FA publishing enabled, and the narrowest selectable package/scope
permission; organization-management permission does not grant package publishing.
Use a one-day lifetime. Revoke it immediately after the
first verified publication instead of waiting for expiry. Keep its value out of
source, reports, chat, command arguments and logs. Token creation and trust
administration require the owner's interactive authentication.

For future provisioning, prepare that credential only when the candidate is
qualified and ready for the first tag run, so its one-day lifetime covers
publication. In the owner's local terminal, the verified npm CLI supports:

```sh
npm token create --name forma-router-first-publish \
  --token-description "One-time qualified 3.2.0-rc.1 router publication" \
  --scopes @getforma --packages-and-scopes-permission read-write \
  --orgs-permission no-access --expires 1 --bypass-2fa

gh secret set NPM_ROUTER_BOOTSTRAP_TOKEN --repo getforma-dev/forma --env npm-publish
```

Enter the password and OTP only at npm's interactive prompts; do not supply them
as flags. Paste the resulting token into the secret prompt, never into chat or a
tracked file. `--expires 1` is one day in this installed CLI. The scope grant is
needed because the router package does not exist yet; this is not an all-packages
or organization-administration grant. The helper still confines its actual use
to the one qualified router archive. Record only the token ID and expiry for
revocation, never the token value.

The actual 2026-10-26 readiness observation is a separate exception to those
preferred permissions: `forma-router-bootstrap` has package-write and
organization-write authority, bypasses 2FA and expires at
`2026-11-02T21:54:35.395Z` (seven days). The owner explicitly authorized using
this credential and revoking it after use. Its GitHub environment secret was
saved at `2026-10-26T22:00:48Z`. This is broader than the one-day, no-organization
grant above and must not be described as least privilege. The helper confines
its invocation; it cannot reduce the credential's registry authority. Retain
only non-secret metadata and the eventual removal/revocation receipts.

The helper still authenticates tag-push identity, exact DS11 bytes, the milestone
and all existing registry versions; the job still depends on CI, P17 and all
engines. A temporary token is usable only for `@getforma/router@3.2.0-rc.1` when
the entire package is absent (HTTP404). Other responses fail closed. An identical
already-published rc.1 takes the existing idempotent path without using a token.
A supplied token on any other release is rejected. The temporary child gets a
private `.npmrc` containing a literal environment reference and publishes the
actual DS11 tarball with `--ignore-scripts --provenance --access public --tag next`.
The file is removed even on failure. All other children strip both bootstrap and
`NODE_AUTH_TOKEN` variables; the original four packages retain their OIDC path.

This first-publish provenance path follows npm's
[GitHub Actions provenance procedure](https://docs.npmjs.com/generating-provenance-statements/)
and [granular token permissions](https://docs.npmjs.com/creating-and-viewing-access-tokens/).
The finite tests prove confinement and refusal logic, not real registry enrollment.

After the exact router archive is published and verified, immediately remove
`NPM_ROUTER_BOOTSTRAP_TOKEN` from the GitHub `npm-publish` environment and have
the owner revoke the temporary npm token. Verify both removals and retain their
non-secret receipts. The release owner must then
configure its trusted publisher for `getforma-dev/forma`, workflow `release.yml`,
environment `npm-publish`, with **Allow npm publish** enabled. Restore the existing
package policy of requiring two-factor authentication and disallowing tokens,
verify the actual trust entry and retain the observed non-secret results. Existing packages' policies
are unchanged. Follow npm's [trusted publishing procedure](https://docs.npmjs.com/trusted-publishers/).

A new trust entry must complete its first successful trusted publish within
[two days](https://docs.npmjs.com/trusted-publishers/#trusted-publisher-configuration-expiry).
Saving the configuration neither validates it nor proves publishing works.
Track its creation time and the first successful OIDC publication separately.
If the next qualified RC or stable release falls outside that window, delete
the expired entry and recreate it before that release. Do not publish an extra
unqualified version to validate enrollment. Token revocation does not wait for
that later OIDC publication.

The target inventory is already staged in the audited source:

- `scripts/registry-reconcile-policy.json` includes `@getforma/router`, restricted
  to records from `getforma-dev/forma`, with `baseline: []`. Router has no
  pre-record historical releases to exempt.
- `NPM_PACKAGES` in `scripts/release-plane-events.mjs` selects
  `ROUTER_NPM_PACKAGES`. The default collector requests all five npm packuments.
  `LEGACY_NPM_PACKAGES` and historical snapshot/record readers remain unchanged.

This preparation must precede D14 and the published-RC code freeze. There is no
post-publication source switch, activation variable or exception to that freeze.
The SR2/L-48 reconciler remains a complete, fail-closed check: a missing package,
record or mismatched archive is a failed result. SR26 observation remains
purely detective and does not grant or block release authority. Its CLI records
an incomplete observation and exits nonzero on missing input; that error never
promotes a candidate baseline or becomes a fabricated successful observation.
Existing release gates and the absence of external alert-delivery evidence are
unchanged.

After the first real RC publication has a valid DS12 record and its registry
bytes match all eight recorded archive identities:

1. Deploy/run the already-audited five-package observer and the normal eight-package
   reconciliation. No source edit is required. Do not run the new live inventory
   prematurely merely to manufacture readiness, and never suppress a 404.
2. Retain the actual complete receipts, errors and external delivery evidence.
   The first real four-to-five comparison emits an inventory-expansion event and
   a new-router event; later observations compare all five. Preserve the previous
   four-package baseline bytes. Only the existing external delivery owner's
   promotion procedure may establish the new baseline after successful delivery.
3. Complete the publisher/credential steps above and record what was actually
   observed. Configuring target coverage and passing fixture tests are not npm
   publication, trusted-publisher enrollment or external alert delivery.

Validators retain exact historical seven-package 3.0/3.1 release records, require
eight identities in 3.2 records, reject partial inventories and reject a five-to-four
monitor shrink. Tests exercise the actual default collector with a closed provider:
all five requests, missing-router 404/nonzero/incomplete result, unchanged supplied
historical baseline, and complete expansion. Reconciliation tests use the shipped
policy and actual fixture archive bytes for complete eight-package coverage and
missing-package/record/hash refusals. Only the real post-publication observations
complete operational enrollment.
