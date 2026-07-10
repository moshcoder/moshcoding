#!/bin/sh
# moshcoding — one-line installer for the `moshcode` CLI.
#
# Usage:
#   curl -fsSL https://moshcoding.com/install.sh | sh
#
# Subcommands:
#   curl -fsSL https://moshcoding.com/install.sh | sh -s -- install     (default)
#   curl -fsSL https://moshcoding.com/install.sh | sh -s -- update
#   curl -fsSL https://moshcoding.com/install.sh | sh -s -- upgrade     (alias)
#   curl -fsSL https://moshcoding.com/install.sh | sh -s -- remove
#   curl -fsSL https://moshcoding.com/install.sh | sh -s -- uninstall   (alias)
#
# What it does:
#   1. Detects OS (Linux/macOS — Windows users: use WSL).
#   2. Installs mise (https://mise.jdx.dev) if missing, lives under $HOME.
#   3. Installs Node.js 20 via mise if no system Node 18+ is present.
#   4. Fetches the CLI straight from the public GitHub repo
#      (github.com/moshcoder/moshcode) into $MOSHCODE_HOME/pkg. moshcode
#      is dependency-free pure ESM, so there is NO npm/registry step.
#   5. Drops a wrapper at $HOME/.local/bin/moshcode that runs the CLI
#      via node and handles update|upgrade|remove|uninstall.
#
# Override env vars:
#   MOSHCODE_HOME=/path     install dir     (default: $HOME/.moshcode)
#   MOSHCODE_BIN=/path/dir  wrapper bin dir (default: $HOME/.local/bin)
#   MOSHCODE_REF=ref        git ref         (default: main)
#
# Re-running this script updates an existing install in place.

set -eu

GH_REPO="moshcoder/moshcode"
MOSHCODE_REF="${MOSHCODE_REF:-main}"
TARBALL_URL="https://codeload.github.com/$GH_REPO/tar.gz/$MOSHCODE_REF"
INSTALL_URL="https://moshcoding.com/install.sh"

# ---------------------------------------------------------------------------
# Operator identity — `curl | sh` can land with HOME/USER unset.
# ---------------------------------------------------------------------------
_mc_user() {
    if [ -n "${USER:-}" ]; then echo "$USER"; return 0; fi
    _u="$(whoami 2>/dev/null || id -un 2>/dev/null)"
    [ -n "$_u" ] && { echo "$_u"; return 0; }
    [ "$(id -u 2>/dev/null || echo 0)" = "0" ] && { echo "root"; return 0; }
    echo "user"
}
_mc_home() {
    if [ -n "${HOME:-}" ] && [ -d "$HOME" ]; then echo "$HOME"; return 0; fi
    _u="$(_mc_user)"
    _h="$(getent passwd "$_u" 2>/dev/null | awk -F: '{print $6}')"
    if [ -n "$_h" ] && [ -d "$_h" ]; then echo "$_h"; return 0; fi
    [ "$(id -u 2>/dev/null || echo 0)" = "0" ] && { echo "/root"; return 0; }
    _h="/tmp/$_u"; mkdir -p "$_h" 2>/dev/null || true; echo "$_h"
}
USER="$(_mc_user)"; HOME="$(_mc_home)"; export USER HOME

MOSHCODE_HOME="${MOSHCODE_HOME:-$HOME/.moshcode}"
MOSHCODE_BIN="${MOSHCODE_BIN:-$HOME/.local/bin}"
WRAPPER="$MOSHCODE_BIN/moshcode"
PKG_DIR="$MOSHCODE_HOME/pkg"
REAL_BIN="$PKG_DIR/bin/moshcode.mjs"

# ---------------------------------------------------------------------------
# pretty output
# ---------------------------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    GREEN=$(printf '\033[32m'); YELLOW=$(printf '\033[33m')
    BLUE=$(printf '\033[34m'); RED=$(printf '\033[31m'); RESET=$(printf '\033[0m')
else
    GREEN=''; YELLOW=''; BLUE=''; RED=''; RESET=''
fi
info() { printf '%s==>%s %s\n' "$BLUE" "$RESET" "$*"; }
ok()   { printf '%s ✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s !%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
fail() { printf '%s ✗%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

detect_os() {
    case "$(uname -s)" in
        Linux)  OS=linux ;;
        Darwin) OS=macos ;;
        *) fail "unsupported OS: $(uname -s) (Linux and macOS only — Windows: use WSL)" ;;
    esac
}

# ---------------------------------------------------------------------------
# mise + node (idempotent) — only if no system Node 18+.
# ---------------------------------------------------------------------------
ensure_node() {
    if command -v node >/dev/null 2>&1; then
        _major="$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
        if [ "${_major:-0}" -ge 18 ]; then ok "Node.js $(node -v) (system)"; return 0; fi
    fi
    if ! command -v mise >/dev/null 2>&1; then
        command -v curl >/dev/null 2>&1 || fail "curl is required"
        info "installing mise (https://mise.jdx.dev)"
        mkdir -p "$HOME/.local/bin"
        curl -fsSL https://mise.run | sh >/dev/null 2>&1 || true
        [ -x "$HOME/.local/bin/mise" ] || fail "mise install failed"
        PATH="$HOME/.local/bin:$PATH"; export PATH
    fi
    info "installing Node.js 20 via mise"
    MISE_YES=1; export MISE_YES
    mise use --global node@20 >/dev/null 2>&1 || warn "mise node@20 had warnings"
    _cfg="$HOME/.config/mise/config.toml"
    [ -f "$_cfg" ] && mise trust "$_cfg" >/dev/null 2>&1 || true
    _mise_data="${MISE_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/mise}"
    PATH="$HOME/.local/bin:$_mise_data/shims:$PATH"; export PATH
    command -v node >/dev/null 2>&1 || fail "node not on PATH after mise install"
    ok "Node.js $(node -v) (via mise)"
}

# ---------------------------------------------------------------------------
# install the CLI from GitHub (no npm — moshcode is dependency-free ESM)
# ---------------------------------------------------------------------------
install_cli() {
    for _t in curl tar node; do
        command -v "$_t" >/dev/null 2>&1 || fail "$_t is required but not found"
    done
    _tmp="$(mktemp -d 2>/dev/null || printf '%s' "$MOSHCODE_HOME/.tmp.$$")"
    mkdir -p "$_tmp"
    info "fetching moshcode ($GH_REPO@$MOSHCODE_REF) from GitHub"
    if ! curl -fsSL "$TARBALL_URL" | tar -xz -C "$_tmp" 2>/dev/null; then
        rm -rf "$_tmp"; fail "download/extract failed — $TARBALL_URL (check MOSHCODE_REF=$MOSHCODE_REF)"
    fi
    # Tarball top dir is moshcode-<ref>/ — locate the one holding bin/moshcode.mjs.
    _src="$(find "$_tmp" -type f -path "*/bin/moshcode.mjs" 2>/dev/null | head -1)"
    _src="${_src%/bin/moshcode.mjs}"
    if [ -z "$_src" ] || [ ! -f "$_src/bin/moshcode.mjs" ]; then
        rm -rf "$_tmp"; fail "bin/moshcode.mjs not found in tarball"
    fi
    rm -rf "$PKG_DIR.new"; mkdir -p "$PKG_DIR.new"
    ( cd "$_src" && tar -cf - . ) | ( cd "$PKG_DIR.new" && tar -xf - )
    rm -rf "$_tmp"
    chmod +x "$PKG_DIR.new/bin/moshcode.mjs" 2>/dev/null || true
    rm -rf "$PKG_DIR.old"
    [ -d "$PKG_DIR" ] && mv "$PKG_DIR" "$PKG_DIR.old"
    mv "$PKG_DIR.new" "$PKG_DIR"
    rm -rf "$PKG_DIR.old"
    _ver="$(node -p "require('$PKG_DIR/package.json').version" 2>/dev/null || echo '?')"
    ok "moshcode@$_ver installed to $PKG_DIR"
}

# ---------------------------------------------------------------------------
# wrapper at $MOSHCODE_BIN/moshcode
# ---------------------------------------------------------------------------
write_wrapper() {
    mkdir -p "$MOSHCODE_BIN"
    cat > "$WRAPPER" <<WRAPPER_EOF
#!/bin/sh
# moshcode wrapper — installed by https://moshcoding.com/install.sh
set -eu
INSTALL_URL="$INSTALL_URL"
REAL_BIN="$REAL_BIN"

_mise_data="\${MISE_DATA_DIR:-\${XDG_DATA_HOME:-\$HOME/.local/share}/mise}"
case ":\$PATH:" in *":\$HOME/.local/bin:"*) ;; *) PATH="\$HOME/.local/bin:\$PATH" ;; esac
case ":\$PATH:" in *":\$_mise_data/shims:"*) ;; *) PATH="\$_mise_data/shims:\$PATH" ;; esac
export PATH; unset _mise_data

case "\${1:-}" in
    update|upgrade|self-update)
        shift || true
        exec sh -c "curl -fsSL '\$INSTALL_URL' | sh -s -- update \$@" ;;
    remove|uninstall)
        shift || true
        exec sh -c "curl -fsSL '\$INSTALL_URL' | sh -s -- remove \$@" ;;
esac

if [ ! -f "\$REAL_BIN" ]; then
    printf 'moshcode: CLI not found at %s — re-run installer:\n  curl -fsSL %s | sh\n' "\$REAL_BIN" "\$INSTALL_URL" >&2
    exit 127
fi
command -v node >/dev/null 2>&1 || {
    printf 'moshcode: node not on PATH — re-run installer:\n  curl -fsSL %s | sh\n' "\$INSTALL_URL" >&2
    exit 127
}
exec node "\$REAL_BIN" "\$@"
WRAPPER_EOF
    chmod +x "$WRAPPER"
    ok "wrapper installed at $WRAPPER"
}

ensure_path() {
    case ":$PATH:" in *":$MOSHCODE_BIN:"*) ;; *) PATH="$MOSHCODE_BIN:$PATH"; export PATH ;; esac
    for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
        [ -f "$rc" ] || continue
        grep -q '/.local/bin' "$rc" 2>/dev/null || \
            printf '\n# Added by moshcode installer\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$rc"
    done
}

run_remove() {
    info "removing moshcode CLI"
    rm -f "$WRAPPER" 2>/dev/null || true
    rm -rf "$MOSHCODE_HOME" 2>/dev/null || true
    ok "removed $WRAPPER"
    ok "removed $MOSHCODE_HOME"
    printf '\nmoshcode has been uninstalled.\n\n'
}

run_install() {
    printf '\n%smoshcoding — moshcode installer%s\n' "$GREEN" "$RESET"
    printf '  home: %s\n  bin:  %s\n\n' "$MOSHCODE_HOME" "$MOSHCODE_BIN"
    detect_os; ok "OS: $OS"
    mkdir -p "$MOSHCODE_HOME" "$MOSHCODE_BIN"
    ensure_node
    install_cli
    write_wrapper
    ensure_path
    printf '\n%sInstall complete.%s\n\n' "$GREEN" "$RESET"
    printf 'Use:\n'
    printf '  moshcode --help              # command list\n'
    printf '  moshcode engines             # list installable engines\n'
    printf '  moshcode install opencode    # install & drive an agent\n'
    printf '  moshcode update              # upgrade   moshcode remove   # uninstall\n\n'
    if ! command -v moshcode >/dev/null 2>&1 || [ "$(command -v moshcode)" != "$WRAPPER" ]; then
        printf '%sIf this shell isn'"'"'t picking up moshcode, run:%s\n  export PATH="%s:$PATH"\n\n' "$YELLOW" "$RESET" "$MOSHCODE_BIN"
    fi
}

run_update() {
    detect_os
    info "checking for updates"
    ensure_node
    install_cli
    write_wrapper
    ensure_path
    printf '\n%sUpdate complete.%s\n\n' "$GREEN" "$RESET"
}

CMD="${1:-install}"
if [ $# -gt 0 ]; then shift; fi
case "$CMD" in
    install)          run_install ;;
    update|upgrade)   run_update ;;
    remove|uninstall) run_remove ;;
    -h|--help|help)
        sed -n '2,30p' "$0" 2>/dev/null || printf 'moshcode installer — curl -fsSL %s | sh\n' "$INSTALL_URL" ;;
    *) fail "unknown command: $CMD (try: install | update | remove | help)" ;;
esac
