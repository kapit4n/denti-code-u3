# ADR 0019 — Keep the last desktop build that worked, and run that

- Status: Accepted
- Date: 2026-10-05
- Decides: how the desktop app is built for manual testing, and what is kept when a build works
- Related: ADR 0002 (Tauri 2 for desktop), ADR 0008 (one React app, thin shells), ADR 0013 (shells declare a target)

## Context

The web app can always be tested. A browser is already there, and Playwright can
build and serve whatever the tree currently contains — when the tree is broken,
the failure is the test failing, which is the honest outcome.

The desktop app has no such safety net. It is a native process, so testing it
means a compile and a launch, and a launch is the first thing a half-finished
change takes away. A refactor mid-flight, a Rust compile error, a type error, a
migration applied halfway: at the moment you wanted to click through the next
screen, there was nothing to click through. The frontend had a browser and a test
suite; the desktop app had whatever the working tree happened to compile to that
morning.

That is a workflow problem rather than a product problem, but it is not solved by
being careful. It is solved by keeping a copy.

The obvious copy is wrong, though. `tauri dev` is not a thing you can save:
`devUrl` points the webview at a Vite dev server on 5174, and the shell, the route
tree and the tokens are all served from the source tree at that moment. A snapshot
of that needs the tree, `node_modules` and a running server, and stops working the
moment any of the three changes — which is precisely the moment it is needed.

`tauri build` does not have that problem. It embeds `frontendDist` into the binary
at compile time, so the resulting file needs nothing but itself and the system
webview libraries.

## Decision

**Four commands, one script (`scripts/desktop-pin.mjs`):**

| Command                    | What it does                                                |
| -------------------------- | ----------------------------------------------------------- |
| `pnpm run desktop:pin`     | builds the tree and keeps the binary as the last known good |
| `pnpm run desktop:run [n]` | runs a kept binary; newest by default, never compiles       |
| `pnpm run desktop:pins`    | lists what is kept, with the commit, time and size of each  |
| `pnpm run desktop:forget`  | deletes them                                                |

**A kept build is produced by `tauri build --debug --no-bundle`, not by
`tauri dev` and not by `cargo build`.** All three differences are load-bearing:

- `tauri build` rather than `cargo build`, because only the former runs
  `tauri-build`'s codegen, which is what embeds the assets. A `cargo build`
  binary starts and shows an empty window.
- `--no-bundle`, because `deb`/`msi`/`app`/`dmg` are for handing to someone and
  cost time that buys nothing when the goal is to run the app here.
- The **debug profile with a production frontend.** Vite, the router and Tailwind
  all run in their normal mode, so what is tested is what a real user would load;
  only the Rust link is unoptimised. A cold release build of Tauri takes minutes,
  and a command that takes minutes is a command nobody runs often enough to keep
  a fallback current.

**`pin` is a manual command, not a hook on `pnpm run build`.** A build that
compiles is not a build that works, and the copy is only useful if it came from a
build that was _used_. Keeping one is a decision, so the command is the decision.

**Kept builds live in `.desktop-known-good/`, gitignored, newest three retained.**
Outside version control because each is ~200 MB of binary that means nothing to
another machine, and a commit is not where a local fallback belongs. Newest three
because the second-most-recent pin is the answer when the newest one misbehaves,
which happens: a pin is taken on the say-so of a manual pass, and a pass can be
wrong.

**Each kept build carries a `pin.json` recording the commit, the branch, whether
the tree was dirty, the API URL it was compiled against, and its size.** The API
URL is in there because it is a build-time constant, like the assets: if `.env`
later points somewhere else, a pinned window keeps calling the API it was built
against, and that is exactly the sort of thing that otherwise looks like a bug.
`run` prints the difference rather than resolving it, and never refuses to start
because of it — the whole purpose of the command is to work when the tree does not
compile.

## Rationale

The alternative — "just be careful" — is what produced the problem. The second,
running the pinned build through `cargo run`, would defeat it: that recompiles
from the current source, so the fallback would be the thing it exists to avoid.

Keeping _source_ rather than binaries (`git stash`, a worktree, a second clone) was
the other option, and it was rejected for a specific reason: it preserves a tree
that may not have compiled at the moment it was taken, and it needs a toolchain
install to launch. The failure this exists to prevent is a build that does not
compile, so a mechanism that requires a working build to restore is not a
mechanism.

Restoring the Playwright browsers is the same problem from the other side, and it
has a note here for a reason: they are 1.3 GB of cache, they were removed to free
disk for a native build that could not otherwise link, and
`pnpm exec playwright install chromium` brings them back. A working fallback is
worth more than a warm cache.

## Consequences

- The desktop app gains a way to be tested that does not depend on the working
  tree. That is the entire point, and it is what makes a mid-refactor pause
  affordable rather than a reason to stop.
- `pnpm run build` still builds the _shell's_ bundle (`vite build`) and not a
  native binary, and `docs/desktop.md` §6 used to claim otherwise. Corrected
  there: a native build is `desktop:pin`, and the only two ways to get one are
  that command and `tauri build` itself.
- Two hundred megabytes per pin, three pins, on the same disk that a Rust build
  needs. The pins are the first thing to delete when the disk fills, and
  `desktop:forget` is the command for it.
- The CSP in `tauri.conf.json` became load-bearing and was wrong. `API_PORT` moved
  from 3000 to 3010 in an earlier session and the CSP was not moved with it, so
  the webview blocked every API call the desktop app made: a shell that rendered
  and an agenda that stayed empty, with nothing in any log. A build that cannot
  reach its own API is not a build worth keeping, which is the sharpest argument
  for a check that runs before a pin is trusted.
  `apps/desktop/test/tauri-config.test.ts` now asserts the CSP allows the origin
  `.env.example` names, and the assertion was verified by putting the old port
  back and watching it fail.
- Nothing about this changes what ships. A pinned build is a local artifact, not a
  release: bundling, code signing and the `bundle.targets` list in
  `tauri.conf.json` remain the release path, and this decision does not touch them.

## Verification

- `desktop:pin` twice: two kept builds listed newest first, each 200 MB, both
  naming the commit they came from.
- `desktop:run` on a kept binary with the tree untouched: a window named
  "Denti-Code U3" appears at 1394×834 on the X display, with `WebKitWebProcess`
  and `WebKitNetworkProcess` running. The captured window is a rendered
  application rather than a blank one: 1 649 distinct colours, the design system's
  background token over 55% of the pixels, the dark sidebar over 10%, and 16%
  dark pixels consistent with text and icons. A blank webview is one flat colour.
- `desktop:run 2` selects the older pin and says that it is not the newest.
- `desktop:run 9` and `desktop:run abc` refuse with a count of what is kept.
- `desktop:run` with nothing kept refuses with the command to fix it, rather than
  building something and pretending that is the same thing.
- The CSP test fails when the CSP is reverted to port 3000 and passes when it is
  restored.
