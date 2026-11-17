import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { readEnvTemplate, run, runtimeEnvironment } from './build-server-bundle.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resourceRoot = path.join(repoRoot, 'apps/desktop/src-tauri/resources');
const targetDir = path.join(resourceRoot, 'denti-code-server');
const tempRoot = path.join(repoRoot, 'apps/desktop/src-tauri/.desktop-server-build');
const version = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;

function resolvePassword() {
  const password =
    process.env.INITIAL_ADMIN_PASSWORD ?? crypto.randomBytes(18).toString('base64url');
  if (password.length < 12) throw new Error('The initial password must be at least 12 characters');
  return password;
}

function copyDereferencedTree(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (fs.statSync(from).isDirectory()) {
      copyDereferencedTree(from, to);
    } else {
      fs.copyFileSync(from, to);
      fs.chmodSync(to, fs.statSync(from).mode);
    }
  }
}

function copyPackage(source, destination) {
  if (fs.existsSync(destination)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  copyDereferencedTree(source, destination);
}

function hoistPnpmPackages(nodeModules) {
  const store = path.join(nodeModules, '.pnpm');
  if (!fs.existsSync(store)) return;
  for (const installed of fs.readdirSync(store, { withFileTypes: true })) {
    if (!installed.isDirectory() || installed.name.startsWith('.')) continue;
    const installedModules = path.join(store, installed.name, 'node_modules');
    if (!fs.existsSync(installedModules)) continue;
    for (const entry of fs.readdirSync(installedModules, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const source = path.join(installedModules, entry.name);
      if (entry.name.startsWith('@')) {
        if (!entry.isDirectory()) continue;
        for (const scoped of fs.readdirSync(source, { withFileTypes: true })) {
          copyPackage(
            path.join(source, scoped.name),
            path.join(nodeModules, entry.name, scoped.name),
          );
        }
      } else {
        copyPackage(source, path.join(nodeModules, entry.name));
      }
    }
  }
}

function findBundle(tempDir) {
  const matches = fs
    .readdirSync(tempDir, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith(`denti-code-u3-server-${version}-`),
    )
    .map((entry) => path.join(tempDir, entry.name));
  if (matches.length !== 1) {
    throw new Error(`Expected one server bundle in ${tempDir}, found ${matches.length}`);
  }
  return matches[0];
}

function main() {
  const password = resolvePassword();
  const env = runtimeEnvironment(readEnvTemplate());

  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempRoot, { recursive: true });

  run('pnpm', ['run', 'bundle:server', '--', '--out', tempRoot, '--password', password]);

  const source = findBundle(tempRoot);
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(resourceRoot, { recursive: true });
  copyDereferencedTree(source, targetDir);
  hoistPnpmPackages(path.join(targetDir, 'server/node_modules'));
  fs.writeFileSync(path.join(targetDir, '.gitkeep'), '');
  fs.writeFileSync(
    path.join(targetDir, 'desktop-server.json'),
    `${JSON.stringify({ password, env }, null, 2)}\n`,
  );
  fs.rmSync(tempRoot, { recursive: true, force: true });

  console.log(`Embedded server resources: ${targetDir}`);
}

main();
