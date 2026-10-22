# FORMA-116: retained source controls and deferred live rollout

This proposal applies only to `getforma-dev/forma`. It does not modify an
application repository or reinstate the declined M1 environment approval.
Source tests and a local outbox are not evidence of enabled GitHub protections
or delivered messages. L-60 (approved 2026-10-16) defers the live identity,
new protection enforcement and external alert rollout beyond 3.0. The reviewed
source and actual SR14 mutation probes were accepted in the 3.0 release chain;
see the [final as-built summary](../release/V3-AS-BUILT.md). The deferred
criteria are not passed. All publishing remains the existing tokenless
trusted-publishing workflow.

The founder accepted that agents continue using the founder GitHub identity,
without GitHub-enforced separation of their administrator/release authority,
and that external alert delivery remains unavailable. Existing tag rules,
independent agent review, every applicable CI job, merge commits only, no
retagging, D14, all product/performance gates and the real RC soak remain required.
See [the release disposition](../release/3.0-GATE-DISPOSITIONS.md#live-governance-rollout-l-60-2026-10-16)
and [the evidence addendum](../evidence/forma-116-live-deferral/README.md).

## Recorded observation (2026-10-16)

Read-only checks on 2026-10-16 found `Victor-Villacis` is the sole organization
owner and repository administrator. The active `gh` identity is also
`Victor-Villacis`: the agent/founder split is **not established**. Main has no
branch protection. Ruleset 25048046 protects `v*`, `ir-v*` and `server-v*` tag
creation/update/deletion, with an administrator-role bypass. Both registry
publishing environments exist. Their lack of human reviewers is the previously
accepted D3 decision, not an additional blocker.

## Future identity and branch protection rollout

When the founder resumes the deferred rollout, create the distinct agent
identity, grant only the repository write access it needs, and configure its
fine-grained credential with **no
Workflows or Administration permission**, expiry at most 30 days and rotation
on suspected exposure. Do not post the credential in a ticket, terminal log or
chat. Move agent sessions to that identity using the credential manager. These
are GitHub development credentials; they must never be used to publish packages.

The reviewed JSON in `main-protection.proposed.json` is the exact proposed
branch-protection body. It permits merge commits, requires current CI and a
separate approval, enforces founder code ownership, and limits protected-branch
writes to the founder. No review bypass or force push is configured. Apply the
same body to `main` and the active integration branch once the founder accepts
the transition. The conditional mutation workflow must pass on applicable
changes; it is not a globally required context because GitHub leaves a
path-filtered workflow pending on unrelated changes. The release lead still
requires **every applicable CI job** to be green, beyond the two server-enforced
baseline contexts in this proposal.

L-60 supersedes PLAN P3/D4's rollout timing for 3.0. The CODEOWNERS mapping may
land with the reviewed source; it does not itself enable required code-owner
review or establish a separate agent identity, though GitHub may request reviews
from the listed owner. Do not apply the proposed protection as part of this
source change. At the later coordinated rollout, enable protection after the
identity transition and then use the founder's daily review batch for owned
paths. An agent under the distinct identity cannot approve as the founder.
Existing PRs authored under the founder identity cannot be self-approved by that
same identity; resolve their rollout order before
enabling the rules. Do not fake a tag-denial test while authenticated as the
administrator who is allowed to bypass the tag rules.

Before declaring SR25/SR40 complete, retain actual denied responses from the
separate agent identity for a disposable release-pattern tag and a protected
code-owned merge; include a copied release workflow. Confirm the existing tag
rules still allow only the founder's admin role, and re-read organization and
repository administrators. Never move an existing tag for a control.

## Retained detectors and future external alert delivery

The implementation names each source and writes JSON with `delivered:false`.
It never sends a notification or changes settings itself. The internal Actions
collector can run on its declared create/push triggers and six-hour schedule
when effective; this is read-only collection, not the deferred external npm
scheduler or alert delivery. At the future rollout, configure the external
delivery adapter and founder destination before claiming SR26:

| Change | Source | Implemented detector |
| --- | --- | --- |
| Tag creation | GitHub `create` | One `tag-created` outbox entry |
| Workflow change | Main `push`, complete `git diff` | One `workflow-changed` entry |
| Code-owned change | Main `push`, complete `git diff` | One `code-owned-push` entry |
| Ruleset change | Signed `repository_ruleset` webhook | `signedWebhook`, raw-body HMAC-SHA256 verification |
| Environment change | Scheduled REST read every six hours | All pages/details/branch policies compared with last successful artifact |
| npm publication/change | Registry read outside GitHub | Four complete packuments, version/integrity/deprecation comparison |
| crates.io publication | crates.io publish email | Founder configures an address outside GitHub; live receipt pending |

GitHub documents `repository_ruleset` as a webhook, not an Actions trigger. Do
not add a fictitious `on: repository_ruleset` workflow. Configure a repository
or organization webhook at an externally operated receiver with a strong secret;
pass its untouched raw body and signature to `signedWebhook`. The receiver must
deduplicate the delivery ID, durably queue each returned entry, deliver to the
founder and record the delivery receipt. Keep the receiver and its delivery
credentials outside this repository's Actions trust boundary. A workflow edit
can disable an in-repository detector, so this system is expressly detective
and fail open with respect to publishing.

The Actions collector uploads event/environment outboxes. Its first observation
is explicitly a baseline, never an unchanged or passed notification. Missing,
expired, malformed or inaccessible previous artifacts and API failures make the
detector fail; they never reset the baseline silently. The external adapter must
also alert on a failed detector and a missing scheduled heartbeat. Retention is
30 days; archive accepted observations externally for longer outages. Delivery
is not yet configured or tested, so no alert acceptance is claimed.

Run `node scripts/release-plane-observe.mjs npm --out NEW_FILE` on the external
host, with no npm credential. Promote its `snapshot` as the next baseline only
after the outbox is durably accepted, then supply it with `--baseline FILE` on
the next read. An HTTP error fails the read and preserves the old baseline.
The npm collector refuses to run inside GitHub Actions. Do not simulate a real
publication just to create the outside signal: retain the next authorized
trusted-publication receipt and its actual external alert/email.

Seeded local tests exercise all five GitHub change kinds, signature tampering,
incomplete inputs and npm integrity changes. **Actual one-per-kind delivery,
the founder destination, webhook hosting/secret, external npm scheduler and
crates.io email receipt remain deferred future acceptance, not 3.0 release gates.**

## Mutation qualification

`security-mutation-probes.py` archives the exact committed repository to a new
scratch directory and compiles six real production weakenings: fast/bounded
text and attribute escaping, tag-name validation and the script policy. It runs
each named test before, after the weakening and after restoration. Only that
test's executed assertion failure counts as a killed mutant. Compiler failures,
timeouts, missing tests and unrelated failures do not. Logs, exact source and
mutant hashes, exit codes, and the original scratch tree survive failure; the
working checkout is never edited. Cargo jobs are capped at three.

The PR workflow triggers on either native crate, lock/manifest and probe changes.
It has read-only permissions and no secrets. Local source controls are separate
from the actual compilation evidence; run the latter on the frozen commit before
closing SR14.

## Primary references

- [GitHub code owners and required reviews](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
- [GitHub protected branch REST fields](https://docs.github.com/en/rest/branches/branch-protection)
- [GitHub webhook events and signature headers](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
- [Supported Actions trigger events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)

These are rollout instructions, not a record of settings applied or messages sent.
