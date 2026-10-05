#!/bin/bash
set -e

# Run the last desktop build that worked.
#
# The counterpart to dev-desktop.sh: that one starts a dev window from the
# working tree, which is what you want while writing and useless the moment the
# tree does not compile. This one opens a window from a build that was already
# pinned, so a half-finished refactor or a Rust compile error cannot stop a test
# session.
#
#   ./scripts/run-desktop.sh          the newest kept build
#   ./scripts/run-desktop.sh 2        the one before it
#   ./scripts/run-desktop.sh pins     what is kept, and what each came from
#
# To keep a build, use `pnpm run desktop:pin` after clicking through one that
# works — a build that compiles is not a build that works, so that call is a
# decision rather than a step in the build. See ADR 0019.

# pnpm is installed under ~/.local and is not on the default PATH (AGENTS.md §8),
# so add it even though this script calls node directly: the commands it points
# at are pnpm's, and a user who follows the hint should not hit `command not
# found`.
export PATH="$HOME/.local/bin:$PATH"

# Resolve the repository from this script's own location, so it works from any
# directory and through an absolute path or a symlink on the desktop.
cd "$(dirname "$0")/.."

# Node rather than `pnpm run desktop:run`, so launching a fallback never depends
# on the package manager that built the tree. The logic lives in one place either
# way: this is the same script that command runs, so the two cannot drift, and
# `pin`/`pins`/`forget` are handled by it rather than duplicated here.
if [ "$#" -eq 0 ]; then
  set -- run
fi
exec node scripts/desktop-pin.mjs "$@"
