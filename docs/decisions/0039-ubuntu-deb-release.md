# ADR 0039 — The Ubuntu installer is a `.deb` built by a second release job

- **Status:** Accepted
- **Date:** 2026-11-17
- **Decides:** how Ubuntu/Debian installers join the tag-driven desktop release
- **Related:** [ADR 0038](./0038-tag-driven-windows-msi-release.md), [ADR 0002](./0002-tauri-2-for-desktop.md), [ADR 0025](./0025-two-engines-one-set-of-ports.md)

## Context

ADR 0038 delivered the Windows MSI. Tag `v0.1.0` produced a successful GitHub
Actions run and a `windows-x64-msi` artifact, but the same release had no Linux
installer even though `deb` has been in `bundle.targets` from the start. The
desktop app targets both web and desktop, and Ubuntu is the machine's native
platform, so the missing `.deb` is the next release gap.

A Debian package cannot be built on the Windows runner: Tauri's Linux bundler
needs WebKitGTK 4.1, GTK 3 and the Debian packaging tools. It also cannot be
built safely on just any Linux runner. Tauri recommends Ubuntu 22.04 or Debian 12
as the oldest baseline that provides WebKitGTK 4.1 from the standard repositories;
building on a newer image raises the glibc floor of the package.

Two more details had to be settled before adding the job. First, `tauri-action`
creates the draft release when given `tagName`; two independent jobs doing that
for one tag would race and could leave two drafts. Second, `bundle.icon` named
only `icon.ico`, which is enough for WiX but not for the Linux PNG icons the
Debian bundler expects.

## Decision

1. **The same tag builds both installers.** `.github/workflows/release-desktop.yml`
   (renamed from `release-windows.yml`) keeps the `v*` push trigger and the
   equality check against `tauri.conf.json`. The source version is bumped to
   `0.1.1` in every package manifest, `Cargo.toml`, `Cargo.lock` and
   `tauri.conf.json`; the first tag for both installers is `v0.1.1`.
2. **The Windows job remains the release owner.** It creates the draft release,
   uploads the MSI, and exposes the resulting `releaseId` as a job output.
3. **The Ubuntu job waits for that release id.** `deb` declares `needs: msi` and
   passes `releaseId` to `tauri-action` instead of `tagName`, so it uploads the
   `.deb` into the same draft without trying to create one. It also keeps the
   bundle as a workflow artifact.
4. **The runner is `ubuntu-22.04`, with system dependencies installed in the
   job.** The step installs `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`,
   `wget`, `file`, `libxdo-dev`, `libssl-dev`, `libayatana-appindicator3-dev` and
   `librsvg2-dev` before `tauri build --bundles deb`.
5. **Linux icons are source files, not CI output.** `32x32.png`, `128x128.png`,
   `128x128@2x.png` and the existing `icon.png` are generated from the product
   PNG and named in `bundle.icon` beside `icon.ico`. The ICO layer list now
   includes the 24px and 256px entries Tauri documents.
6. **Only `.deb` is added.** No AppImage, macOS bundle, NSIS installer, updater
   manifest or signing is part of this decision. The draft gate and the localhost
   API URL from ADR 0038 are unchanged.

## Rationale

A second job on the existing tag is simpler than a second release pipeline: one
act still means one version, and a person reviews one draft containing both
installers. Passing `releaseId` is smaller and less fragile than letting two jobs
discover or create the release at the same time.

A serial `needs: msi` edge is deliberate even though the jobs could build in
parallel. The Linux build takes minutes either way, and correctness beats saving
those minutes: the release must exist before the second job uploads to it, and a
failed Windows build should stop the Linux upload rather than leave a half draft.

Pinning Ubuntu 22.04 keeps the package usable on the oldest supported glibc in
the Tauri guidance. `ubuntu-latest` would be newer and would silently raise the
minimum system requirement.

Generating PNG icons in the repository keeps the bundle reproducible from a
checkout. A CI step that derives them would add an image tool to the critical
path for no benefit, and the icons are product assets, not build intermediates.

## Consequences

- Every release tag now builds both MSI and DEB. A tag that disagrees with
  `tauri.conf.json` still fails before either Rust build.
- The `.deb` is unsigned and points at `http://localhost:3010/api/v1`, exactly
  like the MSI. Installing it expects a clinic API on the same machine.
- The two jobs are serial. A Windows runner failure blocks the Ubuntu artifact;
  rerunning the workflow after the Windows problem is fixed completes the pair.
- The release draft contains one MSI and one DEB. Publishing remains a separate
  human act.
- Linux runtime dependencies are declared by the generated Debian package; the
  runner's apt install step exists only to build it.

## Alternatives rejected

- **A matrix job where every OS creates the release.** It needs a lock or retry
  around release creation and can still produce duplicate drafts.
- **Reusing or force-moving `v0.1.0`.** A pushed tag is the release identity;
  rewriting it would make the existing draft describe a different commit.
- **`ubuntu-latest`.** Newer glibc would raise the minimum OS version of the
  `.deb` without any product reason.
- **AppImage in the same slice.** The user asked for an Ubuntu installer and
  `.deb` is already declared in `bundle.targets`; a second packaging format is a
  separate decision.
- **Generating icons inside the workflow.** Product images belong in the tree,
  where the local config test and every bundle step see the same bytes.
