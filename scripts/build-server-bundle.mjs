/**
 * Builds a self-contained clinic server bundle with an initial SQLite database.
 *
 * The desktop installer is only a webview (ADR 0038/0039): it expects an API on
 * localhost:3010. This script packages that API, its runtime dependencies, a Node
 * runtime and a migrated + seeded database, so an installed app has data on first
 * launch. Workspace packages ship as TypeScript source, which Node refuses to
 * strip under node_modules, so they are transpiled to JavaScript inside the
 * bundle and their export maps are repointed at the emitted files.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const version = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;

function parseArgs(argv) {
  const args = { out: path.join(repoRoot, '.artifacts'), password: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--') continue;
    if (flag === '--out' || flag === '--password') {
      const value = argv[++index];
      if (!value) throw new Error(`${flag} needs a value`);
      args[flag.slice(2)] = value;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  args.password ??= process.env.INITIAL_ADMIN_PASSWORD;
  args.password ??= crypto.randomBytes(18).toString('base64url');
  if (args.password.length < 12)
    throw new Error('The initial password must be at least 12 characters');
  return args;
}

function run(command, args, options = {}) {
  const shell = options.shell ?? isWindows;
  const commandArgs = shell ? args.map((value) => (/\s/.test(value) ? `"${value}"` : value)) : args;
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: 'inherit',
    shell,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

function readEnvTemplate() {
  const values = {};
  const text = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

function runtimeEnvironment(template) {
  return {
    NODE_ENV: 'production',
    API_HOST: template.API_HOST ?? '0.0.0.0',
    API_PORT: template.API_PORT ?? '3010',
    LOG_LEVEL: 'info',
    CORS_ORIGINS: [
      'tauri://localhost',
      'http://tauri.localhost',
      ...(template.CORS_ORIGINS ?? '').split(',').filter(Boolean),
    ].join(','),
    CLINIC_TIMEZONE: template.CLINIC_TIMEZONE ?? 'UTC',
    CLINIC_ID: template.CLINIC_ID,
    SESSION_TTL_HOURS: template.SESSION_TTL_HOURS ?? '12',
    AUTH_LOGIN_MAX_ATTEMPTS: template.AUTH_LOGIN_MAX_ATTEMPTS ?? '5',
    AUTH_LOGIN_WINDOW_MINUTES: template.AUTH_LOGIN_WINDOW_MINUTES ?? '15',
  };
}

function transpileWorkspacePackages(serverDir) {
  const scopeDir = path.join(serverDir, 'node_modules', '@denti-code-u3');
  const compilerOptions = {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    verbatimModuleSyntax: true,
    isolatedModules: true,
  };

  const collect = (directory) => {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) files.push(...collect(full));
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) files.push(full);
    }
    return files;
  };

  for (const name of fs.readdirSync(scopeDir)) {
    const packageDir = fs.realpathSync(path.join(scopeDir, name));
    for (const file of collect(packageDir)) {
      if (/\.(test|config)\.ts$/.test(file)) continue;
      const source = fs.readFileSync(file, 'utf8');
      const output = ts.transpileModule(source, { fileName: file, compilerOptions }).outputText;
      fs.writeFileSync(file.replace(/\.ts$/, '.js'), output);
      fs.rmSync(file);
    }

    const manifestPath = path.join(packageDir, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const toJavaScript = (value) =>
      typeof value === 'string' ? value.replace(/\.ts\b/g, '.js') : value;
    if (manifest.main) manifest.main = toJavaScript(manifest.main);
    for (const [key, value] of Object.entries(manifest.exports ?? {})) {
      manifest.exports[key] = toJavaScript(value);
    }
    writeFileReplace(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

/**
 * pnpm hard-links copied package files from its store. Writing in place would
 * also rewrite the workspace source, so replace the directory entry instead.
 */
function writeFileReplace(file, contents) {
  const temporary = `${file}.bundle-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(temporary, contents);
  fs.renameSync(temporary, file);
}

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

function writeStartScript(bundleDir, env) {
  const lines = [
    '#!/bin/sh',
    'set -eu',
    'BUNDLE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'export DATABASE_URL="sqlite:${BUNDLE_DIR}/data/denti-code-u3.db"',
    ...Object.entries(env).flatMap(([key, value]) =>
      key === 'NODE_ENV'
        ? ['export NODE_ENV=production']
        : [`if [ -z "\${${key}+x}" ]; then ${key}=${shellQuote(value)}; fi`, `export ${key}`],
    ),
    'cd "$BUNDLE_DIR/server"',
    'exec "$BUNDLE_DIR/runtime/node" dist/main.js',
    '',
  ];
  const file = path.join(bundleDir, 'start.sh');
  fs.writeFileSync(file, lines.join('\n'));
  fs.chmodSync(file, 0o755);
}

function writeStartCommand(bundleDir, env) {
  const lines = [
    '@echo off',
    'setlocal',
    'set "BUNDLE_DIR=%~dp0"',
    'set "DB_PATH=%BUNDLE_DIR%data\\denti-code-u3.db"',
    'set "DB_PATH=%DB_PATH:\\=/%"',
    'set "DATABASE_URL=sqlite:%DB_PATH%"',
    'set "NODE_ENV=production"',
    ...Object.entries(env)
      .filter(([key]) => key !== 'NODE_ENV')
      .map(([key, value]) => `if not defined ${key} set "${key}=${value}"`),
    'cd /d "%BUNDLE_DIR%server"',
    '"%BUNDLE_DIR%runtime\\node.exe" dist\\main.js',
    'endlocal',
    '',
  ];
  fs.writeFileSync(path.join(bundleDir, 'start.cmd'), lines.join('\r\n'));
}

function writeReadme(bundleDir, env, password) {
  const contents = [
    '# Denti-Code U3 — clinic server bundle',
    '',
    `Version ${version}. This bundle serves the API the desktop app expects on localhost:3010, with an initial SQLite database already migrated and seeded.`,
    '',
    '## Start',
    '',
    isWindows ? '- Double-click `start.cmd`, or run it from a terminal.' : '- Run `./start.sh`.',
    '- Leave the window open. Stop the server with Ctrl+C.',
    `- The database is \`data/denti-code-u3.db\`; the API listens on ${env.API_HOST}:${env.API_PORT}.`,
    '- Install the matching desktop MSI/DEB and sign in; it already points at this API.',
    '- `API_PORT` and the other settings except `NODE_ENV` can be overridden in the environment before launch.',
    '',
    '## First sign-in',
    '',
    '| Role | Email | Password |',
    '| --- | --- | --- |',
    `| Administrator | admin@denti-code.test | \`${password}\` |`,
    `| Receptionist | recepcion@denti-code.test | \`${password}\` |`,
    `| Dentist | elena.vargas@denti-code.test | \`${password}\` |`,
    `| Dentist | marco.salas@denti-code.test | \`${password}\` |`,
    '',
    'The password was generated for this bundle and is written here so the person who installs it can sign in. Keep this file private.',
    '',
    '## Scope and limits',
    '',
    '- `NODE_ENV=production`, so the password-free development sign-in endpoints are not registered.',
    '- There is no password-change screen yet (OPEN QUESTION). Rotate this credential before real patient data is stored.',
    '- The seed fixes appointment dates relative to the build date. A bundle kept for months will show an old calendar.',
    '- The Node runtime and npm dependencies are included; no separate Node installation is needed.',
    '- The API owns the database. Do not open it from the desktop app or edit it while the server runs.',
    '',
  ];
  fs.writeFileSync(path.join(bundleDir, 'README.md'), contents.join('\n'));
}

function createArchive(outDir, bundleDir) {
  const name = path.basename(bundleDir);
  const archive = path.join(outDir, `${name}.${isWindows ? 'zip' : 'tar.gz'}`);
  fs.rmSync(archive, { force: true });
  if (isWindows) {
    run('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${bundleDir}' -DestinationPath '${archive}' -Force`,
    ]);
  } else {
    run('tar', ['-czf', archive, '-C', outDir, name], { shell: false });
  }
  return archive;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const template = readEnvTemplate();
  const env = runtimeEnvironment(template);
  if (!env.CLINIC_ID) throw new Error('.env.example has no CLINIC_ID');

  const name = `denti-code-u3-server-${version}-${process.platform}-${process.arch}`;
  const outDir = path.resolve(repoRoot, args.out);
  const bundleDir = path.join(outDir, name);
  const serverDir = path.join(bundleDir, 'server');
  const dataDir = path.join(bundleDir, 'data');
  const databaseUrl = `sqlite:${path.join(dataDir, 'denti-code-u3.db').replace(/\\/g, '/')}`;

  fs.rmSync(bundleDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  run('pnpm', ['--filter', '@denti-code-u3/api', 'build']);
  run('pnpm', ['--filter', '@denti-code-u3/api', 'deploy', serverDir, '--prod', '--legacy']);

  for (const leftover of [
    'src',
    'test',
    '.turbo',
    'tsconfig.json',
    'tsconfig.build.json',
    'vitest.config.ts',
    'vitest.integration.config.ts',
  ]) {
    fs.rmSync(path.join(serverDir, leftover), { recursive: true, force: true });
  }

  transpileWorkspacePackages(serverDir);

  const seedEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DENTI_CODE_SEED_PASSWORD: args.password,
  };
  run('pnpm', ['--filter', '@denti-code-u3/database', 'run', 'db:migrate'], { env: seedEnv });
  run('pnpm', ['--filter', '@denti-code-u3/database', 'run', 'db:seed'], { env: seedEnv });

  const runtimeDir = path.join(bundleDir, 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  const nodeBinary = path.join(runtimeDir, isWindows ? 'node.exe' : 'node');
  fs.copyFileSync(process.execPath, nodeBinary);
  if (!isWindows) fs.chmodSync(nodeBinary, 0o755);

  writeStartScript(bundleDir, env);
  writeStartCommand(bundleDir, env);
  writeReadme(bundleDir, env, args.password);

  const archive = createArchive(outDir, bundleDir);
  console.log(`Server bundle: ${bundleDir}`);
  console.log(`Archive: ${archive}`);
  console.log(`Initial admin password: ${args.password}`);
}

main();
