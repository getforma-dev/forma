# Private to one scripts/check.sh invocation. Do not export this function or
# state: a standalone fixture command must still perform its normal build.
# Bash 3.2-compatible; nothing on disk authorizes reuse of an earlier build.
_forma_check_built_packages=()

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
