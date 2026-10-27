# Private to one scripts/check.sh invocation. Do not export this function or
# state: a standalone fixture command must still perform its normal build.
# Bash 3.2-compatible; nothing on disk authorizes reuse of an earlier build.
_forma_check_built_packages=()
_forma_check_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

forma_check_build_package() {
  local package_dir previous required built=false
  package_dir="$(cd "$1" && pwd -P)" || return
  shift
  for previous in ${_forma_check_built_packages[@]+"${_forma_check_built_packages[@]}"}; do
    if [ "$previous" = "$package_dir" ]; then built=true; break; fi
  done
  if [ "$built" = false ]; then
    (cd "$package_dir" && npm run build) || return
  fi
  # A successful earlier build cannot excuse an output removed since then.
  for required in "$@"; do
    if [ ! -f "$package_dir/$required" ]; then
      echo "Error: current check build output missing: $package_dir/$required" >&2
      return 1
    fi
  done
  if [ "$built" = false ]; then
    _forma_check_built_packages+=("$package_dir")
  else
    echo "check: reusing this invocation's build of $package_dir"
  fi
}

# A child compile phase cannot export this shell's success array. Import only
# its fresh, consumed-once receipt after independent source/product/owner checks.
# The verifier emits no shell code or caller-selected package paths.
forma_check_import_compile() {
  local package_dir
  [ -z "${_forma_check_built_packages[*]-}" ] || return 1
  node "$_forma_check_root/scripts/check-compile-phase.mjs" --verify-import "$1" || return
  for package_dir in packages/compiler packages/build packages/core packages/router packages/create-app; do
    _forma_check_built_packages+=("$(cd "$_forma_check_root/$package_dir" && pwd -P)")
  done
}

# Shared core browser preparation, private to the same successful-build state.
# It neither exports an authorization flag nor reuses a previous invocation.
forma_check_prepare_core_browser() {
  local core_dir
  core_dir="$(cd "$_forma_check_root/packages/core" && pwd -P)" || return
  forma_check_build_package "$core_dir" dist/formajs-runtime.global.js || return
  (cd "$core_dir" && node -e "require('fs').copyFileSync('dist/formajs-runtime.global.js','e2e/fixtures/formajs-runtime.global.js')")
}
