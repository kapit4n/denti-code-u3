# ADR 0038 — The Windows installer is built from a version tag in GitHub Actions

- **Status:** Accepted
- **Date:** 2026-11-17
- **Decides:** how the first Windows MSI is built, versioned and published
- **Related:** [ADR 0002](./0002-tauri-2-for-desktop.md), [ADR 0019](./0019-keep-the-last-desktop-build.md), [ADR 0013](./0013-shells-declare-a-target-the-app-owns-the-rest.md)

## Context

`tauri.conf.json` has listed `msi` in `bundle.targets` since the desktop shell was
created, but no installer has ever been built. The only native build verified on
this machine is `tauri build --debug --no-bundle` (ADR 0019), which deliberately
skips bundling. The machine is Linux, and an MSI cannot be produced here: WiX v3,
which Tauri uses for `.msi`, only runs on Windows.

There was no CI at all — no `.github` directory — so nothing turned a commit into
an artifact another person could install. A first release pipeline needs one
trigger, one target and one result; a matrix of web, Linux, macOS and Windows
builds would be four problems before the first installer exists.

Two details in the current tree are load-bearing for a bundle and were not ready:
`bundle.icon` was an empty array, and the API URL is a Vite build-time constant
whose origin must also appear in the webview's CSP.

## Decision

1. **A tag push builds the installer.** `.github/workflows/release-windows.yml`
   runs on `push` to tags matching `v*`. There is no branch trigger and no manual
   dispatch: the tag is the act of deciding to release.
2. **The tag must name the version the source already declares.** A step fails
   unless `GITHUB_REF_NAME` equals `v` followed by `version` from
   `apps/desktop/src-tauri/tauri.conf.json`. The first tag is therefore `v0.1.0`.
   The version stays in source; CI never rewrites it.
3. **The runner is `windows-2022`, and the only bundle is the MSI.** That image
   ships WiX Toolset 3.14.1, which Tauri's MSI bundler needs, and is the image
   generation WiX v3 was built against. `windows-latest` moved to a newer server
   image in 2026 and reports of WiX v3 bundling failures on it are recent enough
   to avoid for a first release. `tauri-action` is passed `--bundles msi`.
4. **The release is a draft.** `tauri-apps/tauri-action@v1` creates the release for
   the pushed tag, uploads the `.msi` to it, and also submits the bundle as a
   workflow artifact. Publishing is a separate, human act.
5. **The toolchain is pinned where it matters.** pnpm 10.34.6 from `package.json`,
   Node 22, Rust stable with `x86_64-pc-windows-msvc`, `pnpm install
--frozen-lockfile`, and the repository's own `@tauri-apps/cli` through
   `tauriScript: pnpm --dir apps/desktop exec tauri` rather than a global CLI.
6. **The API URL is read from `.env.example` into `VITE_API_URL` before the
   build.** That is the same committed value the CSP test checks
   (`apps/desktop/test/tauri-config.test.ts`), so the compiled URL and the CSP
   cannot be selected independently by accident. There is no runtime override in
   this first release.
7. **`apps/desktop/src-tauri/icons/icon.ico` is generated from the existing
   `icon.png` and named in `bundle.icon`.** An MSI needs a Windows icon; an empty
   icon list was fine for `--no-bundle` and is not fine for a bundle.

## Rationale

A tag is better than a branch trigger here because a branch keeps moving: the
same workflow run would answer "what version is this?" differently on the next
commit. A tag is immutable in intent, and the equality check makes a mistyped tag
fail before a long Rust build rather than producing a mislabelled installer.

The draft release is the review gate. There is no code signing yet, no updater,
and no clinic-specific API URL, so an automatically published installer would
invite people to install something neither verified nor configured for them.

Keeping the version in `tauri.conf.json` rather than deriving it from the tag with
a script means the source tree always says what it builds, and the existing
`0.1.0` in three package manifests and `Cargo.toml` stays a single answer.

## Consequences

- Pushing `v0.1.0` is the first release attempt. Every later release needs a
  source version bump, a commit and a matching tag.
- The first MSI is **unsigned** and points at `http://localhost:3010/api/v1`, the
  committed default: it expects the API to be running on the same machine. That
  is a build-time constant, like the embedded assets. A clinic URL means changing
  `.env.example` and the CSP together and cutting a new tag; a broader CSP is not
  a substitute, because it would only hide a wrong URL.
- No Linux or macOS artifacts, no NSIS `setup.exe`, and no updater manifest are
  produced. Adding them is a separate decision.
- The first real verification is the first CI run. Local checks can prove the
  workflow parses, the tag rule is coherent and the config has an icon, but not
  that WiX and WebView2 cooperate on a GitHub runner. MSI bundling also requires
  the Windows VBSCRIPT optional feature, which is enabled by default on the
  runner image; a `failed to run light.exe` error would point there first.

## Alternatives rejected

- **`tauri-action`'s `app-v__VERSION__` tag creation from a `release` branch.**
  It makes the action choose the version and the tag; here the tag is the input,
  and a tag that disagrees with the source should fail loudly.
- **`windows-latest`.** Newer than `windows-2022`, but WiX v3 is frozen and the
  newer image has a short history of breaking it.
- **A generic `ci.yml` covering every platform.** It would build four installers
  nobody asked for before the first one had been opened.
- **Committing a plain `.ico` by hand or widening `bundle.icon` to a generated
  directory.** The icon comes from the product's existing PNG, and the bundle
  names exactly one file.
