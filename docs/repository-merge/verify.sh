#!/usr/bin/env bash
# The history acceptance of the repository merge (FORMA-113), over the output
# of rewrite.sh:
#   1. every old commit is reachable: for each incoming repository, the count
#      of commits on every branch and tag before equals the count after, each
#      old commit has a new one in the commit map, and every new one is in the
#      merged repository;
#   2. every old tag resolves under its prefix to a commit whose tree is the
#      original tag's tree moved to its new paths (checked file by file, mode
#      and blob, for every tag and for EVERY commit, not a sample);
#   3. the merged branch carries the three mains and the setup commit;
#   4. `git log --follow` works for a sampled file in each package.
#
#   verify.sh <out-dir>     (the directory rewrite.sh wrote)
set -euo pipefail
OUT=$(cd "${1:?usage: verify.sh <out-dir>}" && pwd)
MERGED=$OUT/forma
MERGE_DATE=${MERGE_DATE:-2026-10-15}
fail=0
ok() { echo "ok   $*"; }
bad() { echo "FAIL $*"; fail=$((fail + 1)); }

# The path mapping of each repository, as rewrite.sh defines it.
map_path() { # <repo> <old path>
  case $1 in
    formajs) echo "packages/core/$2" ;;
    create-forma-app) echo "packages/create-app/$2" ;;
    forma-tools)
      case $2 in
        packages/compiler/*|packages/build/*|e2e/*|playwright.config.ts|package.json|package-lock.json) echo "$2" ;;
        docs/DIAGNOSTICS.md|docs/HANDOFF-imported-signal-defaults.md) echo "$2" ;;
        scripts/test-raw-lint-bin.mjs) echo "packages/build/scripts/test-raw-lint-bin.mjs" ;;
        scripts/*) echo "packages/compiler/$2" ;;
        *) echo "forma-tools/$2" ;;
      esac ;;
  esac
}

echo "== 1. every old commit reachable"
for r in formajs forma-tools create-forma-app; do
  pristine=$OUT/pristine/$r.git
  before=$(git -C "$pristine" rev-list --all --count)
  mapped=$(($(wc -l < "$OUT/maps/$r.commit-map") - 1))
  missing=0
  while read -r old new; do
    [ "$old" = old ] && continue
    git -C "$MERGED" cat-file -e "$new^{commit}" 2>/dev/null || { missing=$((missing + 1)); echo "     $r: new commit $new (old $old) is not in the merged repository"; }
  done < "$OUT/maps/$r.commit-map"
  if [ "$before" = "$mapped" ] && [ "$missing" = 0 ]; then
    ok "$r: $before commits before, $mapped mapped, all present in the merged repository"
  else
    bad "$r: $before commits before, $mapped mapped, $missing missing"
  fi
  # Each old branch head maps to the new branch head.
  while read -r oldsha ref; do
    b=${ref#refs/heads/}
    newsha=$(awk -v o="$oldsha" '$1==o{print $2}' "$OUT/maps/$r.commit-map")
    have=$(git -C "$MERGED" rev-parse --verify -q "refs/heads/$r/$b" || echo none)
    [ "$newsha" = "$have" ] || bad "$r: branch $b maps to $newsha but the merged repository has $have"
  done < <(git -C "$pristine" for-each-ref --format='%(objectname) %(refname)' refs/heads/)
  ok "$r: every branch head is refs/heads/$r/<branch> at its mapped commit ($(git -C "$pristine" for-each-ref refs/heads/ | wc -l | tr -d ' ') branches)"
done
before=$(git -C "$OUT/pristine/forma.git" rev-list --all --count)
for sha in $(git -C "$OUT/pristine/forma.git" rev-list --all); do
  git -C "$MERGED" cat-file -e "$sha^{commit}" || bad "forma: $sha is gone"
done
ok "forma: its own $before commits are untouched (same ids)"

echo "== 2. every tag resolves under its prefix to the original tree, moved"
tree_listing() { # <repo-dir> <tree-ish> -> "mode blob path" lines, sorted
  git -C "$1" ls-tree -r --format='%(objectmode) %(objectname) %(path)' "$2" | LC_ALL=C sort -k3
}
compare_trees() { # <repo> <old commit> <new commit> <label>
  local r=$1 old=$2 new=$3 label=$4 tmp_old tmp_new
  tmp_old=$(mktemp); tmp_new=$(mktemp)
  while IFS=' ' read -r mode blob path; do
    printf '%s %s %s\n' "$mode" "$blob" "$(map_path "$r" "$path")"
  done < <(tree_listing "$OUT/pristine/$r.git" "$old") | LC_ALL=C sort -k3 > "$tmp_old"
  tree_listing "$MERGED" "$new" > "$tmp_new"
  if cmp -s "$tmp_old" "$tmp_new"; then
    rm -f "$tmp_old" "$tmp_new"; return 0
  fi
  echo "     $label: trees differ:"; diff "$tmp_old" "$tmp_new" | head -10
  rm -f "$tmp_old" "$tmp_new"; return 1
}
for r in formajs forma-tools create-forma-app; do
  pristine=$OUT/pristine/$r.git
  tags_before=$(git -C "$pristine" for-each-ref refs/tags/ | wc -l | tr -d ' ')
  tags_after=$(git -C "$MERGED" for-each-ref "refs/tags/$r/" | wc -l | tr -d ' ')
  [ "$tags_before" = "$tags_after" ] || bad "$r: $tags_before tags before, $tags_after under $r/"
  checked=0
  while read -r ref; do
    t=${ref#refs/tags/}
    new="refs/tags/$r/$t"
    git -C "$MERGED" rev-parse --verify -q "$new" >/dev/null || { bad "$r: tag $t has no $new"; continue; }
    oldtype=$(git -C "$pristine" cat-file -t "$ref"); newtype=$(git -C "$MERGED" cat-file -t "$new")
    [ "$oldtype" = "$newtype" ] || bad "$r: tag $t was a $oldtype, is a $newtype"
    if [ "$oldtype" = tag ]; then
      oldmsg=$(git -C "$pristine" cat-file tag "$ref" | sed '1,/^$/d'); newmsg=$(git -C "$MERGED" cat-file tag "$new" | sed '1,/^$/d')
      [ "$oldmsg" = "$newmsg" ] || bad "$r: tag $t's message changed"
    fi
    oldc=$(git -C "$pristine" rev-parse "$ref^{commit}"); newc=$(git -C "$MERGED" rev-parse "$new^{commit}")
    [ "$(awk -v o="$oldc" '$1==o{print $2}' "$OUT/maps/$r.commit-map")" = "$newc" ] || bad "$r: tag $t points at $newc, not its mapped commit"
    compare_trees "$r" "$oldc" "$newc" "$r tag $t" || bad "$r: tag $t's tree is not the original moved"
    checked=$((checked + 1))
  done < <(git -C "$pristine" for-each-ref --format='%(refname)' refs/tags/)
  ok "$r: $checked tags resolve under $r/ to their mapped commits with the original trees moved (type and message kept)"
  # Every commit, not only the tagged ones.
  n=0; badtrees=0
  while read -r old new; do
    [ "$old" = old ] && continue
    n=$((n + 1))
    compare_trees "$r" "$old" "$new" "$r commit $old" || badtrees=$((badtrees + 1))
  done < "$OUT/maps/$r.commit-map"
  if [ "$badtrees" = 0 ]; then ok "$r: all $n commits' trees are the originals moved"; else bad "$r: $badtrees of $n commits' trees differ"; fi
  # Commit messages, authors and dates are untouched.
  changed=0
  while read -r old new; do
    [ "$old" = old ] && continue
    a=$(git -C "$OUT/pristine/$r.git" log -1 --format='%an%n%ae%n%ad%n%cn%n%ce%n%cd%n%B' "$old")
    b=$(git -C "$MERGED" log -1 --format='%an%n%ae%n%ad%n%cn%n%ce%n%cd%n%B' "$new")
    [ "$a" = "$b" ] || changed=$((changed + 1))
  done < "$OUT/maps/$r.commit-map"
  if [ "$changed" = 0 ]; then ok "$r: every commit keeps its author, committer, dates and message"; else bad "$r: $changed commits changed metadata"; fi
done
forma_tags=$(git -C "$OUT/pristine/forma.git" for-each-ref --format='%(objectname) %(refname)' refs/tags/)
while read -r sha ref; do
  [ "$(git -C "$MERGED" rev-parse "$ref")" = "$sha" ] || bad "forma: $ref moved"
done <<< "$forma_tags"
ok "forma: its own $(echo "$forma_tags" | wc -l | tr -d ' ') tags are untouched"

echo "== 3. the branch"
tip=$(git -C "$MERGED" rev-parse merge/forma-stack)
for r in formajs forma-tools create-forma-app; do
  git -C "$MERGED" merge-base --is-ancestor "$r/main" "$tip" && ok "$r/main is an ancestor of merge/forma-stack" || bad "$r/main is not merged"
done
git -C "$MERGED" merge-base --is-ancestor "$(git -C "$OUT/pristine/forma.git" rev-parse HEAD)" "$tip" && ok "forma's main is an ancestor of merge/forma-stack" || bad "forma main not an ancestor"
expected=$(( $(git -C "$OUT/pristine/forma.git" rev-list --count HEAD) + $(git -C "$OUT/pristine/formajs.git" rev-list --count HEAD) + $(git -C "$OUT/pristine/forma-tools.git" rev-list --count HEAD) + $(git -C "$OUT/pristine/create-forma-app.git" rev-list --count HEAD) + 4 ))
got=$(git -C "$MERGED" rev-list --count "$tip")
[ "$expected" = "$got" ] && ok "merge/forma-stack reaches $got commits = the four mains + 3 merges + 1 setup" || bad "merge/forma-stack reaches $got commits, expected $expected"
all_expected=$(( $(git -C "$OUT/pristine/forma.git" rev-list --all --count) + $(git -C "$OUT/pristine/formajs.git" rev-list --all --count) + $(git -C "$OUT/pristine/forma-tools.git" rev-list --all --count) + $(git -C "$OUT/pristine/create-forma-app.git" rev-list --all --count) + 4 ))
all_got=$(git -C "$MERGED" rev-list --all --count)
[ "$all_expected" = "$all_got" ] && ok "every branch and tag of the four repositories: $all_got commits in all" || bad "all refs reach $all_got commits, expected $all_expected"
[ -z "$(git -C "$MERGED" status --porcelain)" ] && ok "the working tree is clean" || bad "the working tree is dirty"

echo "== 4. git log --follow"
follow() { # <repo> <old path> <new path> [setup edits]: old history plus intentional setup changes
  local n_old n_new first expected
  n_old=$(git -C "$OUT/pristine/$1.git" log --follow --format=%H -- "$2" | wc -l | tr -d ' ')
  n_new=$(git -C "$MERGED" log --follow --format=%H -- "$3" | wc -l | tr -d ' ')
  first=$(git -C "$MERGED" log --follow --format='%ad' --date=short -- "$3" | tail -1)
  expected=$((n_old + ${4:-0}))
  if [ "$expected" = "$n_new" ] && [ "$n_new" -gt 0 ]; then ok "$3: $n_new commits ($n_old original + ${4:-0} setup edits), back to $first"; else bad "$3: $n_new commits, expected $expected ($n_old original + ${4:-0} setup edits)"; fi
}
follow formajs src/index.ts packages/core/src/index.ts
follow formajs README.md packages/core/README.md
follow forma-tools packages/compiler/src/index.ts packages/compiler/src/index.ts
follow forma-tools packages/build/src/index.ts packages/build/src/index.ts
follow forma-tools scripts/test-raw-lint-bin.mjs packages/build/scripts/test-raw-lint-bin.mjs 1
follow forma-tools docs/DIAGNOSTICS.md docs/DIAGNOSTICS.md
follow forma-tools e2e/ssr/build.sh e2e/ssr/build.sh 1
follow create-forma-app src/index.ts packages/create-app/src/index.ts
follow forma crates/forma-ir/src/lib.rs crates/forma-ir/src/lib.rs
# Through the setup commit's move: forma-tools' README is in the archive.
n=$(git -C "$MERGED" log --follow --format=%H -- "docs/archive/$MERGE_DATE-forma-tools-README.md" | wc -l | tr -d ' ')
n_old=$(git -C "$OUT/pristine/forma-tools.git" log --follow --format=%H -- README.md | wc -l | tr -d ' ')
[ "$n" = "$((n_old + 1))" ] && ok "docs/archive/$MERGE_DATE-forma-tools-README.md: $n commits through the move (forma-tools' README had $n_old)" || bad "archived forma-tools README: $n commits, expected $((n_old + 1))"

echo
if [ "$fail" = 0 ]; then echo "verify: every check passed"; else echo "verify: $fail checks FAILED"; exit 1; fi
