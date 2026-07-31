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
#   3. Installs the current Node.js LTS + latest bun via mise. Both are
#      resolved at run time, so re-running moves them up to newer releases.
#   4. Fetches the CLI straight from the public GitHub repo
#      (github.com/moshcoder/moshcode) into $MOSHCODE_HOME/pkg. moshcode
#      is dependency-free pure ESM, so there is NO npm/registry step.
#   5. Drops a wrapper at $HOME/.local/bin/moshcode that runs the CLI
#      via node and handles update|upgrade|remove|uninstall.
#
# Override env vars:
#   MOSHCODE_HOME=/path     install dir     (default: $HOME/.moshcode)
#   MOSHCODE_BIN=/path/dir  wrapper bin dir (default: $HOME/.local/bin)
#   MOSHCODE_REF=ref        git ref         (default: latest release, else main)
#   MOSHCODE_USE_SYSTEM_NODE=1  keep an existing system Node 20+ instead of
#                               installing the current LTS through mise
#
# Re-running this script updates an existing install in place.

set -eu

GH_REPO="moshcoder/moshcode"
# Empty means "resolve at install time" — see resolve_ref. An explicit
# MOSHCODE_REF still pins whatever the caller asks for (tag OR branch).
MOSHCODE_REF="${MOSHCODE_REF:-}"
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

# PATH as inherited from the calling shell, captured before we mutate ours.
# `curl … | sh` runs in a subshell, so our own exports never reach the caller —
# this is the only honest way to tell whether THEIR shell will find the wrapper.
MC_ORIG_PATH="${PATH:-}"
SYSTEM_LINK_DIR=/usr/local/bin
LINKED_BIN=''

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
# mise (idempotent) — the toolchain manager we pin node/bun through.
# ---------------------------------------------------------------------------
ensure_mise() {
    if ! command -v mise >/dev/null 2>&1; then
        command -v curl >/dev/null 2>&1 || fail "curl is required"
        info "installing mise (https://mise.jdx.dev)"
        mkdir -p "$HOME/.local/bin"
        curl -fsSL https://mise.run | sh >/dev/null 2>&1 || true
        [ -x "$HOME/.local/bin/mise" ] || fail "mise install failed"
        PATH="$HOME/.local/bin:$PATH"; export PATH
    fi
    MISE_YES=1; export MISE_YES
    _mise_data="${MISE_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/mise}"
    MISE_SHIMS="$_mise_data/shims"
    PATH="$HOME/.local/bin:$MISE_SHIMS:$PATH"; export PATH
    _cfg="$HOME/.config/mise/config.toml"
    [ -f "$_cfg" ] && mise trust "$_cfg" >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
# node — always the CURRENT LTS, resolved by mise at run time. Deliberately
# not a pinned major: a hardcoded node@20 silently rots as new LTS lines ship.
# Re-running the installer (or `moshcode update`) re-resolves and moves up.
# Set MOSHCODE_USE_SYSTEM_NODE=1 to keep an existing system Node 20+ instead.
# ---------------------------------------------------------------------------
ensure_node() {
    if [ "${MOSHCODE_USE_SYSTEM_NODE:-0}" = "1" ] && command -v node >/dev/null 2>&1; then
        _major="$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
        if [ "${_major:-0}" -ge 20 ]; then ok "Node.js $(node -v) (system, pinned by request)"; return 0; fi
        warn "system Node $(node -v) is older than 20 — using mise LTS instead"
    fi
    ensure_mise
    info "installing/refreshing Node.js LTS via mise"
    mise use --global node@lts >/dev/null 2>&1 || warn "mise node@lts had warnings"
    command -v node >/dev/null 2>&1 || fail "node not on PATH after mise install"
    ok "Node.js $(node -v) LTS (via mise)"
}

# ---------------------------------------------------------------------------
# bun — always latest, resolved by mise at run time (same rationale as node).
# NB: `bun upgrade` self-updates the binary and would fight mise's copy, so we
# always go through mise. `bun update` is a project-dependency command and is
# not what keeps bun itself current.
# ---------------------------------------------------------------------------
ensure_bun() {
    ensure_mise
    info "installing/refreshing bun (latest) via mise"
    mise use --global bun@latest >/dev/null 2>&1 || warn "mise bun@latest had warnings"
    if command -v bun >/dev/null 2>&1; then
        ok "bun $(bun --version) (via mise)"
    else
        warn "bun not on PATH after mise install — continuing without it"
    fi
}

# Which ref to install. An explicit MOSHCODE_REF wins (pin a tag, or track a
# branch). Otherwise: the latest published release tag.
#
# This used to hardcode `main`, so every install and `update` shipped whatever
# happened to be sitting on the branch — unreviewed merges included — and a
# freshly cut release tag changed nothing about what users got. Releases are
# the thing we test and announce, so they're what installs should track.
#
# The API needs no auth for a public repo, but it can be rate-limited, blocked,
# or simply have no release yet — any of which falls back to main rather than
# failing the install. `|| true` keeps `set -e` from aborting on a failed curl
# or a grep that matches nothing.
resolve_ref() {
    if [ -n "${MOSHCODE_REF:-}" ]; then printf '%s' "$MOSHCODE_REF"; return 0; fi
    _tag="$(curl -fsSL "https://api.github.com/repos/$GH_REPO/releases/latest" 2>/dev/null \
        | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
        | head -1)" || _tag=''
    if [ -n "${_tag:-}" ]; then printf '%s' "$_tag"; else printf '%s' main; fi
    unset _tag
}

# ---------------------------------------------------------------------------
# install the CLI from GitHub (no npm — moshcode is dependency-free ESM)
# ---------------------------------------------------------------------------
install_cli() {
    for _t in curl tar node; do
        command -v "$_t" >/dev/null 2>&1 || fail "$_t is required but not found"
    done
    MOSHCODE_REF="$(resolve_ref)"
    TARBALL_URL="https://codeload.github.com/$GH_REPO/tar.gz/$MOSHCODE_REF"
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

# Append one `export PATH="<dir>:$PATH"` line to an rc file, unless that dir is
# already wired there (by us, the distro skel, mise, …). Checked per-line rather
# than per-block so existing installs pick up newly-added dirs on re-run.
_rc_add_path() {
    if grep -qF "export PATH=\"$2:\$PATH\"" "$1" 2>/dev/null; then return 0; fi
    if grep -v '^[[:space:]]*#' "$1" 2>/dev/null | grep -qF -- "$2"; then return 0; fi
    printf '\n# Added by moshcode installer\nexport PATH="%s:$PATH"\n' "$2" >> "$1" \
        2>/dev/null || warn "could not write $1"
}

# Wire $MOSHCODE_BIN into future shells. rc files are CREATED when missing —
# a fresh VPS root account routinely has no ~/.zshrc, and the old
# "skip if absent" behaviour silently wired up nothing at all.
ensure_path() {
    case ":$PATH:" in *":$MOSHCODE_BIN:"*) ;; *) PATH="$MOSHCODE_BIN:$PATH"; export PATH ;; esac

    _rcs="$HOME/.profile"
    if [ -f "$HOME/.bash_profile" ]; then _rcs="$_rcs $HOME/.bash_profile"; fi
    if command -v bash >/dev/null 2>&1; then _rcs="$_rcs $HOME/.bashrc"; fi
    if command -v zsh  >/dev/null 2>&1; then _rcs="$_rcs $HOME/.zshrc"; fi

    for rc in $_rcs; do
        if [ ! -f "$rc" ] && ! : > "$rc" 2>/dev/null; then
            warn "could not create $rc"
            continue
        fi
        _rc_add_path "$rc" "$MOSHCODE_BIN"
        # mise's shims, so the node/bun we just installed — and anything
        # `moshcode install` puts under them — are usable in a plain shell.
        if [ -n "${MISE_SHIMS:-}" ]; then _rc_add_path "$rc" "$MISE_SHIMS"; fi
    done
}

# $MOSHCODE_BIN is only on the caller's PATH in a NEW shell. When it isn't on
# the inherited one, also symlink into a system bin dir that is, so `moshcode`
# works in the shell they just ran the installer from.
link_system_bin() {
    case ":$MC_ORIG_PATH:" in *":$MOSHCODE_BIN:"*) return 0 ;; esac
    case ":$MC_ORIG_PATH:" in *":$SYSTEM_LINK_DIR:"*) ;; *) return 0 ;; esac
    [ -d "$SYSTEM_LINK_DIR" ] && [ -w "$SYSTEM_LINK_DIR" ] || return 0
    ln -sf "$WRAPPER" "$SYSTEM_LINK_DIR/moshcode" 2>/dev/null || return 0
    LINKED_BIN="$SYSTEM_LINK_DIR/moshcode"
    ok "linked $LINKED_BIN -> $WRAPPER"
}

run_remove() {
    info "removing moshcode CLI"
    if [ -L "$SYSTEM_LINK_DIR/moshcode" ] && \
       [ "$(readlink "$SYSTEM_LINK_DIR/moshcode" 2>/dev/null)" = "$WRAPPER" ]; then
        rm -f "$SYSTEM_LINK_DIR/moshcode" 2>/dev/null && ok "removed $SYSTEM_LINK_DIR/moshcode"
    fi
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
    ensure_bun
    install_cli
    write_wrapper
    ensure_path
    link_system_bin
    printf '\n%sInstall complete.%s\n\n' "$GREEN" "$RESET"
    # Test the CALLER's PATH, not ours — we already prepended $MOSHCODE_BIN to
    # our own, so checking `command -v moshcode` here would always pass and the
    # user would be told nothing while `moshcode` stayed "command not found".
    case ":$MC_ORIG_PATH:" in
        *":$MOSHCODE_BIN:"*) _ready=1 ;;
        *) [ -n "$LINKED_BIN" ] && _ready=1 || _ready=0 ;;
    esac
    if [ "$_ready" = 0 ]; then
        printf '%sOne more step — this shell does not have %s on its PATH yet.%s\n' "$YELLOW" "$MOSHCODE_BIN" "$RESET"
        printf 'Run this now (added to your shell rc files for future shells):\n\n'
        printf '  export PATH="%s:$PATH"\n\n' "$MOSHCODE_BIN"
        printf 'Or start a fresh login shell:  exec "$SHELL" -l\n\n'
    fi
    printf 'Use:\n'
    printf '  moshcode --help              # command list\n'
    printf '  moshcode engines             # list installable engines\n'
    printf '  moshcode install opencode    # install & drive an agent\n'
    printf '  moshcode update              # upgrade   moshcode remove   # uninstall\n\n'
}

run_update() {
    detect_os
    info "checking for updates"
    ensure_node
    ensure_bun
    install_cli
    write_wrapper
    ensure_path
    link_system_bin
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
