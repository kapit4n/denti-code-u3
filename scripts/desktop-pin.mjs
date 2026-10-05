#!/usr/bin/env node
/**
 * Keep the last desktop build that works, and run it without the source tree.
 *
 * ## Why this exists
 *
 * Manual testing of a native app depends on it launching. That is a fragile thing
 * to depend on during development: a half-finished refactor, a broken type, a
 * migration mid-flight or a Rust compile error all stop the window from opening,
 * and at exactly the moment you wanted to check something, there is nothing to
 * check it in. The frontend has a browser and Playwright; the desktop app has
 * whatever the current working tree happens to compile to.
 *
 * So the answer is to keep a copy of a build that worked, outside the working
 * tree, and run that instead when the tree is not in a state worth launching.
 *
 * ## Why a release-shaped build and not `tauri dev`
 *
 * `tauri dev` is not a thing you can save. It points the webview at
 * `devUrl` — a Vite dev server on 5174 — and the shell, the route tree and the
 * tokens are all served from the source tree at that moment. A snapshot of that
 * is a snapshot of a moving target: it needs the tree, `node_modules` and a
 * server to be running, and it breaks the moment any of the three changes.
 *
 * `tauri build` embeds `frontendDist` into the binary at compile time. A binary
 * built that way needs nothing but itself and the system webview libraries, which
 * is the property that makes it worth keeping. So `pin` builds exactly that, and
 * `run` executes the file.
 *
 * The debug profile is used rather than release, for one reason: a release build
 * of Tauri from cold takes minutes and the point of this script is that pinning
 * is cheap enough to do often. The frontend inside it is still a production
 * build — Vite, the router and Tailwind all run in their normal mode — so what
 * you test is what a real desktop user would load, without waiting on an
 * optimised Rust link.
 *
 * ## The three commands
 *
 *   pnpm run desktop:pin     build the current tree and keep it as known good
 *   pnpm run desktop:run     run the newest kept build; never compiles
 *   pnpm run desktop:pins    what is kept, and what commit each one came from
 *   pnpm run desktop:forget  throw the kept builds away
 *
 * `pin` is deliberately manual rather than wired into `pnpm run build`. A build
 * that compiles is not a build that works: the point of the copy is a version you
 * have *used*, so choosing to keep one is a decision, and the command is the
 * decision.
 *
 * Nothing here is committed. `.desktop-known-good/` is gitignored, and it holds
 * megabytes of binary per entry. The manifest beside each build records the commit
 * and the API URL so `pins` can tell you what you are about to run, which is the
 * question worth answering before a test session rather than during one.
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const pinRoot = path.join(repoRoot, '.desktop-known-good');
const manifestName = 'pin.json';
const binaryName = 'denti-code-u3-desktop';
const builtBinary = path.join(repoRoot, 'apps/desktop/src-tauri/target/debug', binaryName);

/** How many pins to keep. Each is tens of megabytes; three is two spares plus one. */
const KEEP = 3;

const commands = {
  async pin() {
    ensurePrerequisites();
    say('Building the desktop app with its frontend embedded. This takes a minute or two.');

    // `tauri build` rather than `cargo build`, because the difference is the whole
    // point: only the former runs tauri-build's codegen, which is what embeds the
    // assets. `--no-bundle` skips deb/msi/app/dmg, which are for handing to
    // someone and irrelevant to running the app here.
    const build = spawnSync('npx', ['--no-install', 'tauri', 'build', '--debug', '--no-bundle'], {
      cwd: path.join(repoRoot, 'apps/desktop'),
      stdio: 'inherit',
    });
    if (build.status !== 0) {
      fail('The build failed, so there is nothing to keep. The tree is not pinned.');
    }
    if (!existsSync(builtBinary)) {
      fail(`The build reported success but ${builtBinary} does not exist.`);
    }

    const commit = currentCommit();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const directory = path.join(pinRoot, stamp);
    mkdirSync(directory, { recursive: true });

    const target = path.join(directory, binaryName);
    spawnSync('cp', [builtBinary, target], { stdio: 'inherit' });
    if (statSync(target).size !== statSync(builtBinary).size) {
      rmSync(directory, { recursive: true, force: true });
      fail('The copy did not match the built binary, so nothing was kept.');
    }

    const apiUrl = apiUrlFromEnv();
    writeFileSync(
      path.join(directory, manifestName),
      `${JSON.stringify(
        {
          pinnedAt: new Date().toISOString(),
          commit,
          branch: currentBranch(),
          dirty: workingTreeIsDirty(),
          apiUrl,
          bytes: statSync(target).size,
          // The frontend is a production build; only the Rust profile is debug.
          // Recorded so nobody later wonders whether this is a dev window.
          profile: 'debug rust + production frontend',
        },
        null,
        2,
      )}\n`,
    );

    prune(commit);
    say('');
    say(
      `Pinned ${short(commit)} (${new Date().toISOString()}) → ${path.relative(repoRoot, target)}`,
    );
    if (apiUrl) {
      say(`It will call the API at ${apiUrl}.`);
    }
    say('Run it with: pnpm run desktop:run');
  },

  async run() {
    const all = readPins();
    if (all.length === 0) {
      fail(
        'There is no kept build yet.\n' +
          '  Make the tree build, click through the app until it works, then:\n' +
          '    pnpm run desktop:pin',
      );
    }

    // An optional position, because the second-most-recent pin is the answer when
    // the newest one misbehaves — which is a real situation, since a pin is taken
    // on the say-so of a manual pass and a pass can be wrong.
    const requested = process.argv[3];
    const index = requested === undefined ? 0 : Number(requested) - 1;
    const chosen = Number.isInteger(index) && index >= 0 ? all[index] : undefined;
    if (!chosen) {
      const count = all.length === 1 ? '1 kept build' : `${all.length} kept builds`;
      fail(
        requested === undefined
          ? `There is no kept build yet, or none of the ${count} could be read.`
          : `There ${all.length === 1 ? 'is' : 'are'} ${count}, so there is no number ${requested}.`,
      );
    }

    reportDrift(chosen);
    say(`Running the build from ${chosen.manifest.pinnedAt} (${short(chosen.manifest.commit)}).`);
    if (chosen !== all[0]) {
      say('That is not the newest pin; `pnpm run desktop:pins` lists the rest.');
    }
    say('This window is a copy; nothing it does touches the source tree.');
    say('');

    // Forward the exit status so a crash on launch is visible rather than being
    // swallowed by a wrapper that exits 0.
    const child = spawn(chosen.binary, [], { stdio: 'inherit', cwd: repoRoot });
    child.on('exit', (code, signal) => {
      process.exit(signal ? 1 : (code ?? 0));
    });
  },

  async pins() {
    const all = readPins();
    if (all.length === 0) {
      say('No kept builds. Pin one with: pnpm run desktop:pin');
      return;
    }
    const apiUrl = apiUrlFromEnv();
    for (const [index, pin] of all.entries()) {
      const flag = index === 0 ? '→ runs with `pnpm run desktop:run`' : '';
      say(
        `${short(pin.manifest.commit)}  ${pin.manifest.pinnedAt}  ${megabytes(pin.manifest.bytes)}  ${
          pin.manifest.branch ?? '?'
        }${pin.manifest.dirty ? ' (dirty)' : ''}  ${flag}`,
      );
      if (index === 0 && pin.manifest.apiUrl && apiUrl && pin.manifest.apiUrl !== apiUrl) {
        say(
          `   built against ${pin.manifest.apiUrl}, and .env now says ${apiUrl}. ` +
            'It will call the API the build was compiled with, not the one in .env.',
        );
      }
    }
    say('');
    say(`${all.length} kept (${KEEP} max). Newest first.`);
  },

  async forget() {
    if (!existsSync(pinRoot)) {
      say('Nothing to forget.');
      return;
    }
    rmSync(pinRoot, { recursive: true, force: true });
    say('Kept builds removed. `desktop:run` will ask you to pin a build again.');
  },
};

/**
 * Every kept pin, newest first.
 *
 * Newest is by directory name, and the names are ISO timestamps written by `pin`
 * itself — so the order is chronological without depending on mtimes, which a `cp`
 * can rewrite.
 */
function readPins() {
  if (!existsSync(pinRoot)) {
    return [];
  }
  return readdirSync(pinRoot)
    .filter((name) => existsSync(path.join(pinRoot, name, manifestName)))
    .sort()
    .reverse()
    .map((name) => {
      const directory = path.join(pinRoot, name);
      return {
        directory,
        binary: path.join(directory, binaryName),
        manifest: JSON.parse(readFileSync(path.join(directory, manifestName), 'utf8')),
      };
    })
    .filter((pin) => existsSync(pin.binary));
}

/**
 * Remove pins beyond the newest `KEEP`.
 *
 * The newest survives a failed prune: if anything goes wrong the extra builds are
 * left alone rather than a directory half-deleted, because a pin directory with
 * its binary missing is a trap for the next run.
 */
function prune(keepCommit) {
  const all = readPins();
  for (const pin of all.slice(KEEP)) {
    if (pin.manifest.commit === keepCommit) {
      continue;
    }
    try {
      rmSync(pin.directory, { recursive: true, force: true });
      say(`Pruned ${path.basename(pin.directory)} (${short(pin.manifest.commit)}).`);
    } catch (error) {
      say(`Left ${path.basename(pin.directory)} in place: ${error.message}`);
    }
  }
}

/**
 * Say what is about to differ between the kept build and the tree it was kept
 * from, so a surprising result has an obvious explanation.
 *
 * This is a report, not a check. The whole purpose of `run` is to work when the
 * tree does not compile, so nothing here can be allowed to stop it.
 */
function reportDrift(pin) {
  const commit = currentCommit();
  if (commit && commit !== pin.manifest.commit) {
    say(
      `Note: this build is from ${short(pin.manifest.commit)}; the tree is now at ${short(commit)}. ` +
        'That is the point of it.',
    );
  }
  const apiUrl = apiUrlFromEnv();
  if (apiUrl && pin.manifest.apiUrl && apiUrl !== pin.manifest.apiUrl) {
    say(
      `Note: built against ${pin.manifest.apiUrl}; .env now says ${apiUrl}. ` +
        'The API URL is compiled in, so this window will use the first one.',
    );
  }
  if (!apiIsReachable(pin.manifest.apiUrl)) {
    say('');
    say('The API does not answer right now, so the window will load and then fail every call.');
    say('  pnpm run dev:api      (and pnpm run db:up if the database is not running)');
  }
}

function ensurePrerequisites() {
  const cargoBin = path.join(process.env.HOME ?? '', '.cargo', 'bin');
  if (!existsSync(cargoBin)) {
    fail(`No Rust toolchain at ${cargoBin}. Tauri cannot be built without cargo.`);
  }
  if (!(process.env.PATH ?? '').split(':').includes(cargoBin)) {
    // Not fatal: cargo may be on the PATH through another install. Warned rather
    // than failed, because refusing to run would be worse than a confusing error
    // from cargo itself.
    say(`Note: ${cargoBin} is not on your PATH; cargo must be findable for this to work.`);
  }
}

/** The API URL a build would compile against, or `undefined` when unset. */
function apiUrlFromEnv() {
  const envPath = path.join(repoRoot, '.env');
  if (!existsSync(envPath)) {
    return undefined;
  }
  const line = readFileSync(envPath, 'utf8')
    .split('\n')
    .find((candidate) => candidate.startsWith('VITE_API_URL='));
  return line?.slice('VITE_API_URL='.length).trim();
}

/**
 * Is the API answering? Best effort, on a short timeout.
 *
 * A desktop app cannot work without it, so warning before the window opens saves
 * the diagnosis of an empty grid afterwards. A failure here is never fatal.
 */
function apiIsReachable(apiUrl) {
  if (!apiUrl) {
    return false;
  }
  let origin;
  try {
    origin = new URL(apiUrl).origin;
  } catch {
    return false;
  }
  // `/health` rather than the versioned prefix: it is the liveness probe, it does
  // not touch the database, and asking it answers "is the process up" without
  // needing a clinic in the database to be configured.
  const probe = spawnSync('curl', ['-fsS', '-m', '2', `${origin}/health`], { stdio: 'ignore' });
  return probe.status === 0;
}

function currentCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function currentBranch() {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

/** Whether the tree has uncommitted changes — recorded, never enforced. */
function workingTreeIsDirty() {
  const result = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function short(commit) {
  return commit ? commit.slice(0, 7) : 'unknown';
}

function megabytes(bytes) {
  return `${Math.round(bytes / 1_048_576)} MB`;
}

function say(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const name = process.argv[2];
const command = name ? commands[name] : undefined;
if (!command || name === '--help' || name === '-h') {
  say(
    [
      'Keep the last desktop build that worked, and run it without the source tree.',
      '',
      '  pnpm run desktop:pin     build the current tree and keep it as known good',
      '  pnpm run desktop:run [n] run a kept build, newest by default (never compiles)',
      '  pnpm run desktop:pins    what is kept, and what each one was built from',
      '  pnpm run desktop:forget  throw the kept builds away',
      '',
      'Pin after clicking through a build that works; run when the tree will not launch.',
    ].join('\n'),
  );
  process.exit(command ? 0 : 1);
}

await command();
