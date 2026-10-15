#!/usr/bin/env bash
# The repository merge, FORMA-113: fresh clones of the four repositories, the
# three incoming ones rewritten into their subdirectories with git-filter-repo,
# merged into forma on the branch merge/forma-stack, then one commit that sets
# up the two workspaces. Deterministic: the same inputs give the same trees
# (and, with the same git identity, the same commits), because filter-repo is
# deterministic, every commit this script makes carries a fixed date, and the
# lockfiles come from the overlay (made once, at the rehearsal) rather than
# from a fresh resolve.
#
#   rewrite.sh <out-dir> [source]
#
#   out-dir   an empty directory; receives the clones, the rewritten
#             repositories, `forma` (the result, on merge/forma-stack), the
#             pristine bare clones (`pristine/`, for verify.sh), the commit maps
#             (`maps/`) and `record.txt`
#   source    a URL prefix (default https://github.com/getforma-dev) or a local
#             directory holding clones named forma, formajs, forma-tools and
#             create-forma-app (the rehearsal); each is cloned afresh either way
#
#   MERGE_DATE=YYYY-MM-DD   the date in the commits and the archive index
#                           (default 2026-10-15)
#   FILTER_REPO=<path>      git-filter-repo at v2.47.0 (default: tools/ here)
#
# Needs git, python3, node, curl, shasum or sha256sum; cargo only when
# overlay/Cargo.lock or overlay/e2e/Cargo.lock is missing.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${1:?usage: rewrite.sh <out-dir> [source]}
SOURCE=${2:-https://github.com/getforma-dev}
OVERLAY=$HERE/overlay
FILTER_REPO=${FILTER_REPO:-$HERE/tools/git-filter-repo/git-filter-repo}
FILTER_REPO_SHA256=67447413e273fc76809289111748870b6f6072f08b17efe94863a92d810b7d94 # v2.47.0, the release asset's
MERGE_DATE=${MERGE_DATE:-2026-10-15}
DERIVE_CRATE_URL=https://static.crates.io/crates/forma-ir-derive/forma-ir-derive-0.0.0.crate
DERIVE_SHA256=dbac23b36afd9e2aa413369d6e728552452fc8656f81758bfacc0d7c6b9ba892
TRAILER="Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
REPOS=(forma formajs forma-tools create-forma-app)

export GIT_AUTHOR_DATE="${MERGE_DATE}T06:00:00+00:00"
export GIT_COMMITTER_DATE="$GIT_AUTHOR_DATE"
export GIT_CONFIG_GLOBAL=${GIT_CONFIG_GLOBAL:-"$HOME/.gitconfig"}
# No registry token can be read: npm sees an empty user config (none should
# exist anyway).
EMPTY_NPMRC=$(mktemp)
export NPM_CONFIG_USERCONFIG=$EMPTY_NPMRC
trap 'rm -f "$EMPTY_NPMRC"' EXIT

say() { printf '\n== %s\n' "$*"; }
die() { echo "rewrite: $*" >&2; exit 1; }
sha256_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

[ -f "$FILTER_REPO" ] || die "git-filter-repo not found at $FILTER_REPO"
[ "$(sha256_of "$FILTER_REPO")" = "$FILTER_REPO_SHA256" ] || die "$FILTER_REPO is not git-filter-repo v2.47.0 (sha256 differs)"
for tool in git python3 node curl; do command -v "$tool" >/dev/null || die "$tool is required"; done
[ -d "$OUT" ] && [ -n "$(ls -A "$OUT")" ] && die "$OUT is not empty"
mkdir -p "$OUT/pristine" "$OUT/maps"
OUT=$(cd "$OUT" && pwd)
RECORD=$OUT/record.txt
: > "$RECORD"
note() { echo "$*" | tee -a "$RECORD"; }

note "rewrite.sh for FORMA-113; source $SOURCE; merge date $MERGE_DATE; $(git --version); filter-repo $(python3 -I "$FILTER_REPO" --version)"

say "1. Fresh clones"
for r in "${REPOS[@]}"; do
  git clone -q --no-local "$SOURCE/$r" "$OUT/$r"
  git clone -q --bare --no-local "$SOURCE/$r" "$OUT/pristine/$r.git"
  head=$(git -C "$OUT/$r" rev-parse HEAD)
  [ "$head" = "$(git -C "$OUT/pristine/$r.git" rev-parse HEAD)" ] || die "$r: the two clones differ"
  note "$r: head $head, $(git -C "$OUT/$r" rev-list --count HEAD) commits on main, $(git -C "$OUT/pristine/$r.git" rev-list --all --count) on every branch and tag, $(git -C "$OUT/$r" tag | wc -l | tr -d ' ') tags"
done
# The result pushes to GitHub whatever the clones came from.
git -C "$OUT/forma" remote set-url origin https://github.com/getforma-dev/forma.git

say "2. The forma-ir-derive 0.0.0 placeholder, as published"
curl -fsSL --retry 3 -o "$OUT/forma-ir-derive-0.0.0.crate" "$DERIVE_CRATE_URL"
[ "$(sha256_of "$OUT/forma-ir-derive-0.0.0.crate")" = "$DERIVE_SHA256" ] || die "the .crate's sha256 is not $DERIVE_SHA256"
mkdir -p "$OUT/derive-src"
tar -xzf "$OUT/forma-ir-derive-0.0.0.crate" -C "$OUT/derive-src"
note "forma-ir-derive-0.0.0.crate sha256 $DERIVE_SHA256 verified; files: $(cd "$OUT/derive-src/forma-ir-derive-0.0.0" && find . -type f | sort | tr '\n' ' ')"

say "3. Rewrite the three incoming repositories"
filter() { # <repo> <filter-repo args...>
  local r=$1; shift
  (cd "$OUT/$r" && python3 -I "$FILTER_REPO" --force --preserve-commit-hashes --replace-refs delete-no-add "$@")
  cp "$OUT/$r/.git/filter-repo/commit-map" "$OUT/maps/$r.commit-map"
  cp "$OUT/$r/.git/filter-repo/ref-map" "$OUT/maps/$r.ref-map"
  note "$r rewritten: $(git -C "$OUT/$r" rev-list --all --count) commits on every branch and tag, $(git -C "$OUT/$r" tag | wc -l | tr -d ' ') tags, head $(git -C "$OUT/$r" rev-parse HEAD)"
}
# --preserve-commit-hashes: commit messages stay byte-identical to the
# originals (an old hash a message cites still names the old repository's
# commit; maps/*.commit-map translate). --replace-refs delete-no-add: no
# refs/replace noise; the maps are the record.
filter formajs --to-subdirectory-filter packages/core --tag-rename :formajs/
filter create-forma-app --to-subdirectory-filter packages/create-app --tag-rename :create-forma-app/
# forma-tools is already a two-package monorepo in the target shape, so one
# filtered copy keeps both packages' history in place (`git log` works without
# --follow): packages/compiler and packages/build stay; its cross-package e2e
# lanes, Playwright config and npm workspace root become the repository's;
# docs/DIAGNOSTICS.md and the handoff note join docs/; its scripts go under
# the packages they test; everything else (README, CONTRIBUTING, LICENSE, the
# ignore files, .github, docs/README.md, docs/archive, test-results) lands in
# forma-tools/, which the setup commit dissolves.
FORMA_TOOLS_PATHS='
if filename.startswith(b"packages/compiler/") or filename.startswith(b"packages/build/"):
    return filename
if filename.startswith(b"e2e/") or filename in (b"playwright.config.ts", b"package.json", b"package-lock.json"):
    return filename
if filename in (b"docs/DIAGNOSTICS.md", b"docs/HANDOFF-imported-signal-defaults.md"):
    return filename
if filename == b"scripts/test-raw-lint-bin.mjs":
    return b"packages/build/scripts/test-raw-lint-bin.mjs"
if filename.startswith(b"scripts/"):
    return b"packages/compiler/" + filename
return b"forma-tools/" + filename
'
filter forma-tools --filename-callback "$FORMA_TOOLS_PATHS" --tag-rename :forma-tools/

say "4. Merge into forma on merge/forma-stack"
cd "$OUT/forma"
git switch -q -c merge/forma-stack main
for r in formajs forma-tools create-forma-app; do
  # Every branch of the incoming repository under <repo>/, its tags (already
  # prefixed) as they are. Nothing of forma's can be overwritten: the refspecs
  # name the prefixed namespaces only.
  git fetch -q "$OUT/$r" "+refs/heads/*:refs/heads/$r/*" "+refs/tags/$r/*:refs/tags/$r/*"
  case $r in
    formajs) where="packages/core" ;;
    forma-tools) where="packages/compiler and packages/build" ;;
    create-forma-app) where="packages/create-app" ;;
  esac
  git merge -q --allow-unrelated-histories --no-ff -m "Merge $r into $where (FORMA-113)

The history of getforma-dev/$r, rewritten with git-filter-repo v2.47.0 so
every commit's tree sits at its new path; its tags carry the prefix $r/.
Old commit ids map to new ones in the merge record (FORMA-113, maps/$r.commit-map).

$TRAILER" "$r/main"
  note "merged $r/main ($(git rev-parse "$r/main")) as $(git rev-parse HEAD)"
done

say "5. The setup commit: two workspaces, one CI"
# forma's own README and CONTRIBUTING describe the Rust half; they stay current
# there while the root files describe the whole stack.
git mv README.md crates/README.md
git mv CONTRIBUTING.md crates/CONTRIBUTING.md
cp "$OVERLAY/README.md" README.md
cp "$OVERLAY/CONTRIBUTING.md" CONTRIBUTING.md
{ cat "$OVERLAY/SECURITY-prefix.md"; tail -n +2 SECURITY.md; } > SECURITY.md.new && mv SECURITY.md.new SECURITY.md

# The Cargo workspace: three crates, the e2e lanes excluded (their own
# workspace), the lock committed.
mkdir -p crates/forma-ir-derive/src
cp "$OUT/derive-src/forma-ir-derive-0.0.0/Cargo.toml.orig" crates/forma-ir-derive/Cargo.toml
cp "$OUT/derive-src/forma-ir-derive-0.0.0/README.md" crates/forma-ir-derive/README.md
cp "$OUT/derive-src/forma-ir-derive-0.0.0/LICENSE" crates/forma-ir-derive/LICENSE
cp "$OUT/derive-src/forma-ir-derive-0.0.0/src/lib.rs" crates/forma-ir-derive/src/lib.rs
python3 - <<'PY'
import re, pathlib
p = pathlib.Path("Cargo.toml"); s = p.read_text()
old = 'members = ["crates/forma-ir", "crates/forma-server"]\n'
assert old in s, "root Cargo.toml: the members line is not the one expected"
new = ('members = ["crates/forma-ir", "crates/forma-ir-derive", "crates/forma-server"]\n'
       '# The e2e lanes (e2e/ssr/render, e2e/frame/server) are a workspace of their own\n'
       '# (e2e/Cargo.toml): the frame server embeds what e2e/frame/build.sh builds, which\n'
       '# does not exist on a clean clone, so `cargo test --workspace` here must not\n'
       '# compile it. They depend on these crates by path.\n'
       'exclude = ["e2e"]\n')
p.write_text(s.replace(old, new, 1))
PY
cp "$OVERLAY/.gitignore" .gitignore
{ echo; cat forma-tools/.gitattributes; } >> .gitattributes

# The npm workspace: forma-tools' root package.json and lock are the base; the
# other two trees join nested under their packages, unhoisted, so every
# package keeps the dependency versions its A2 release was built with.
node "$HERE/tools/merge-locks.mjs" "$OVERLAY/package.json" package-lock.json packages/core/package-lock.json packages/create-app/package-lock.json > package-lock.json.new
cp "$OVERLAY/package.json" package.json
mv package-lock.json.new package-lock.json
git rm -q packages/core/package-lock.json packages/create-app/package-lock.json
# npm recomputes the dev/peer flags of a lock it reads; writing the lock back
# once makes the committed file the one npm itself would write, so the next
# `npm install` leaves it alone. Versions are not resolved anew.
npm install --package-lock-only --ignore-scripts --no-audit --no-fund > /dev/null

# The e2e lanes: one Cargo workspace, path dependencies, no symlinks, one lock.
cp "$OVERLAY/e2e/Cargo.toml" e2e/Cargo.toml
cp "$OVERLAY/e2e/ssr/render/Cargo.toml" e2e/ssr/render/Cargo.toml
cp "$OVERLAY/e2e/frame/server/Cargo.toml" e2e/frame/server/Cargo.toml
cp "$OVERLAY/e2e/sync-fixtures.sh" e2e/sync-fixtures.sh
cp "$OVERLAY/e2e/ssr/build.sh" e2e/ssr/build.sh
cp "$OVERLAY/e2e/frame/build.sh" e2e/frame/build.sh
git rm -q e2e/ssr/render/Cargo.lock e2e/frame/server/Cargo.lock
perl -pi -e "s#join\(__dirname, 'server', 'target', 'debug',#join(__dirname, '..', 'target', 'debug',#" e2e/frame/frame.spec.ts
grep -q "join(__dirname, '..', 'target', 'debug'," e2e/frame/frame.spec.ts || die "frame.spec.ts: the server path was not where expected"

# Two tests of the build package assume no @getforma/core is installed above
# the package, which the workspace root now does; they run their build from
# the fixture's directory instead (the pattern build.test.ts already uses).
git apply "$OVERLAY/patches/preview-frame-test-cwd.patch"

# Scripts that read repository-level files from their new places.
perl -pi -e "s#^const repo = resolve\(dirname\(fileURLToPath\(import.meta.url\)\), '..'\);#const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');#; s#^// Usage: node scripts/test-raw-lint-bin.mjs#// Usage: node packages/build/scripts/test-raw-lint-bin.mjs#" packages/build/scripts/test-raw-lint-bin.mjs
grep -q "'..', '..', '..'" packages/build/scripts/test-raw-lint-bin.mjs || die "test-raw-lint-bin.mjs: the repo line was not where expected"
perl -pi -e "s#resolve\(ROOT, '\.github/workflows/ci\.yml'\)#resolve(ROOT, '../../.github/workflows/ci.yml')#" packages/core/src/__tests__/package-exports.test.ts
grep -q "'../../.github/workflows/ci.yml'" packages/core/src/__tests__/package-exports.test.ts || die "package-exports.test.ts: the ci.yml path was not where expected"
perl -pi -e "s#walk\(resolve\(ROOT, '\.github/workflows'\), /#walk(resolve(ROOT, '../../.github/workflows'), /#" packages/core/src/__tests__/docs-truth.test.ts
grep -q "'../../.github/workflows'" packages/core/src/__tests__/docs-truth.test.ts || die "docs-truth.test.ts: the workflows path was not where expected"

# One CI. The incoming repositories' .github trees sit where GitHub ignores
# them; they go. forma's release.yml (the crates) stays as it is; the npm
# packages' release workflow is FORMA-115a. formajs's engine and nightly-probe
# gates and forma-tools' weekly compatibility check come along with their
# paths moved; formajs's docs.yml (its Pages site) and create-forma-app's
# update-core-dep.yml (the core-release dispatch, retired by the merge) do not.
git rm -rq packages/core/.github packages/create-app/.github forma-tools/.github
cp "$OVERLAY/.github/workflows/ci.yml" .github/workflows/ci.yml
cp "$OVERLAY/.github/workflows/e2e-engines.yml" .github/workflows/e2e-engines.yml
cp "$OVERLAY/.github/workflows/nightly-probes.yml" .github/workflows/nightly-probes.yml
cp "$OVERLAY/.github/workflows/compat.yml" .github/workflows/compat.yml
mkdir -p scripts
cp "$OVERLAY/scripts/check.sh" scripts/check.sh
chmod +x scripts/check.sh e2e/sync-fixtures.sh e2e/ssr/build.sh e2e/frame/build.sh

# forma-tools' repository-level files: archived, folded or dropped.
git mv forma-tools/README.md "docs/archive/$MERGE_DATE-forma-tools-README.md"
git mv forma-tools/CONTRIBUTING.md "docs/archive/$MERGE_DATE-forma-tools-CONTRIBUTING.md"
git mv forma-tools/docs/README.md "docs/archive/$MERGE_DATE-forma-tools-docs-README.md"
{ sed "s/@MERGE_DATE@/$MERGE_DATE/g" "$OVERLAY/archive-index-addition.md"; tail -n +2 forma-tools/docs/archive/README.md; } >> docs/archive/README.md
git rm -q forma-tools/docs/archive/README.md forma-tools/LICENSE forma-tools/.gitignore forma-tools/.gitattributes
git rm -rq forma-tools/test-results
[ -e forma-tools ] && die "forma-tools/ still holds: $(find forma-tools -type f)"
cat >> docs/README.md <<EOF

## Since the repository merge ($MERGE_DATE, FORMA-113)

The four repositories above are one: \`packages/core\` (formajs),
\`packages/compiler\` and \`packages/build\` (forma-tools), \`packages/create-app\`
(create-forma-app) and \`crates/\`. Each package's own \`docs/\` came with it.
From forma-tools' documents, [DIAGNOSTICS.md](DIAGNOSTICS.md) (every build
diagnostic code, what it means for the page and its fix) and
[HANDOFF-imported-signal-defaults.md](HANDOFF-imported-signal-defaults.md) live
here; its repository-level documents are in [archive/](archive/). The table of
repositories above is history until the docs sweep that follows the merge.
EOF
python3 - "$OVERLAY/CHANGELOG-unreleased.md" <<'PY'
import sys, pathlib
p = pathlib.Path("CHANGELOG.md"); s = p.read_text()
add = pathlib.Path(sys.argv[1]).read_text()
head = "## [Unreleased]\n"
if head in s:
    body = add.split(head, 1)[1]
    s = s.replace(head, head + body, 1)
else:
    first_nl = s.index("\n") + 1
    s = s[:first_nl] + "\n" + add + s[first_nl:]
p.write_text(s)
PY

# The locks. The overlay's were made at the rehearsal: the root one with
# Cargo's MSRV-aware resolver, so each crate builds its declared Rust with
# --locked; the e2e lanes' with a plain resolve. Without them, resolve now.
if [ -f "$OVERLAY/Cargo.lock" ]; then
  cp "$OVERLAY/Cargo.lock" Cargo.lock
else
  command -v cargo >/dev/null || die "cargo is required to make Cargo.lock (or put one in overlay/)"
  CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback cargo generate-lockfile
fi
if [ -f "$OVERLAY/e2e/Cargo.lock" ]; then
  cp "$OVERLAY/e2e/Cargo.lock" e2e/Cargo.lock
else
  command -v cargo >/dev/null || die "cargo is required to make e2e/Cargo.lock (or put one in overlay/e2e/)"
  cargo generate-lockfile --manifest-path e2e/Cargo.toml
fi

git add -A
git commit -q -m "Set up the two workspaces and one CI (FORMA-113)

One repository for the stack. crates/: forma-ir, forma-ir-derive (its source
the published 0.0.0 placeholder, crate sha256 ${DERIVE_SHA256:0:8}...${DERIVE_SHA256: -4}) and
forma-server in the root Cargo workspace, Cargo.lock committed and made with
the MSRV-aware resolver; e2e/: the SSR and preview-frame lanes as one Cargo
workspace with one lock, depending on the crates by path instead of a symlink
to a forma checkout. packages/: core, compiler, build and create-app in a root
npm workspace (forma-tools' root package.json and lock as the base; core's and
create-app's trees nested under their packages, unhoisted, so each keeps the
versions its A2 release was built with); the per-package lockfiles go.

.github/workflows/ci.yml runs scripts/check.sh, the one command that builds
every package in both languages and runs every test from a clean clone, with
the toolchain, target, Windows, release-lint and scaffold jobs beside it; the
FMIR contract and the e2e lanes build from the workspace, so no workflow
checks out another repository. forma's release.yml stays as it is (the npm
release workflow is FORMA-115a). The incoming repositories' .github trees,
which GitHub ignored at their new paths, are deleted (formajs: ci, docs,
e2e-engines, nightly-probes, release; forma-tools: ci, compat, release;
create-forma-app: ci, release, update-core-dep); e2e-engines, nightly-probes
and compat come back at the root with their paths moved.

Root README, CONTRIBUTING and SECURITY describe the whole stack; forma's own
moved to crates/; forma-tools' repository-level documents are archived with an
index entry; every package keeps its own docs untouched. forma-tools'
test-results/.last-run.json, a Playwright artefact committed by mistake, goes.

$TRAILER"

note "setup commit $(git rev-parse HEAD); tree $(git rev-parse 'HEAD^{tree}')"
note "merge/forma-stack: $(git rev-list --count HEAD) commits reachable; $(git tag | wc -l | tr -d ' ') tags; branches: $(git branch --format='%(refname:short)' | wc -l | tr -d ' ')"
say "done: $OUT/forma on merge/forma-stack; the record is $RECORD"
