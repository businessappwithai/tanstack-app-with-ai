#!/usr/bin/env bash
# SessionStart hook for Claude Code cloud sessions.
#
# This project runs on exactly one Bun (see CLAUDE.md, "Bun 1.4.4, and only Bun 1.4.4")
# and the cloud image ships whichever Bun it was built with. A Bun older than 1.4.3
# has no type checker behind `bun check`, and a different Bun builds different bundle
# bytes, so a session on the wrong Bun can report a check that never ran.
# This installs the pinned version and installs dependencies from the lockfile.
#
# The pin lives in .bun-version; change it there, in the four repositories together.
set -euo pipefail

# Only cloud sessions: installing a toolchain is not something to do on a laptop.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

project_dir="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
want="$(tr -d '[:space:]' < "$project_dir/.bun-version")"
export PATH="$HOME/.bun/bin:$PATH"

have="$(bun --version 2>/dev/null || true)"
if [ "$have" != "$want" ]; then
  echo "session-start: Bun is '${have:-missing}', this project requires $want; installing" >&2
  workdir="$(mktemp -d)"
  trap 'rm -rf "$workdir"' EXIT
  if curl -fsSL https://bun.sh/install -o "$workdir/install.sh" 2>/dev/null; then
    bash "$workdir/install.sh" "bun-v$want" >&2 || true
  fi
  have="$(bun --version 2>/dev/null || true)"
  if [ "$have" != "$want" ]; then
    # bun.sh can be unreachable where github.com is not: take the release asset directly.
    case "$(uname -m)" in aarch64|arm64) arch=aarch64 ;; *) arch=x64 ;; esac
    if curl -fsSL -o "$workdir/bun.zip" \
      "https://github.com/oven-sh/bun/releases/download/bun-v$want/bun-linux-$arch.zip" \
      && unzip -oq "$workdir/bun.zip" -d "$workdir"; then
      mkdir -p "$HOME/.bun/bin"
      install -m 0755 "$workdir/bun-linux-$arch/bun" "$HOME/.bun/bin/bun"
      ln -sf bun "$HOME/.bun/bin/bunx"
    fi
    hash -r
    have="$(bun --version 2>/dev/null || true)"
  fi
fi

if [ "$have" != "$want" ]; then
  echo "session-start: FAILED to get Bun $want (have '${have:-none}'). Do not run bun check or tests." >&2
  exit 1
fi

# Persist for every later command in the session.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PATH="$HOME/.bun/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
fi
cd "$project_dir"
bun install --frozen-lockfile >&2
echo "session-start: Bun $have, dependencies installed" >&2
