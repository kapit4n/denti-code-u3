#!/usr/bin/env node
/**
 * Architectural dependency guard for Denti-Code U3.
 *
 * The rules are stated in `AGENTS.md` §3 and ADR 0004. This script enforces the
 * ones a code reviewer would otherwise have to catch by eye:
 *
 *   1. `packages/domain` imports nothing framework- or infrastructure-related.
 *   2. Only `apps/api` and `database` import Drizzle or the PostgreSQL driver.
 *   3. No package outside the API imports a database driver.
 *   4. The deployment shells stay thin: no route files, no feature folders.
 *   5. The required workspace packages exist.
 *
 * It scans BOTH the real source import graph and the package manifests, because
 * a manifest alone cannot prove where an import happens, and the import graph
 * alone cannot prove a dependency was not merely installed by accident.
 *
 * Usage: `node scripts/check-boundaries.mjs` (wired into `pnpm run lint`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');

/** Workspace packages, with the directory they live in. */
const WORKSPACE_PACKAGES = [
  { name: '@denti-code-u3/tsconfig', dir: 'packages/tsconfig' },
  { name: '@denti-code-u3/config', dir: 'packages/config' },
  { name: '@denti-code-u3/types', dir: 'packages/types' },
  { name: '@denti-code-u3/validation', dir: 'packages/validation' },
  { name: '@denti-code-u3/domain', dir: 'packages/domain' },
  { name: '@denti-code-u3/api-client', dir: 'packages/api-client' },
  { name: '@denti-code-u3/ui', dir: 'packages/ui' },
  { name: '@denti-code-u3/app', dir: 'packages/app' },
  { name: '@denti-code-u3/api', dir: 'apps/api' },
  { name: '@denti-code-u3/web', dir: 'apps/web' },
  { name: '@denti-code-u3/desktop', dir: 'apps/desktop' },
  { name: '@denti-code-u3/database', dir: 'database' },
];

/**
 * Files in `packages/app` allowed to import FullCalendar (ADR 0011).
 *
 * Matched on a path suffix, because the rule is about *where* the import happens,
 * not about what the file is called.
 *
 * The component's own test is on the list deliberately. Asserting that the grid was
 * handed the clinic's timezone means naming `CalendarOptions`, and a wildcard for
 * `*.test.*` would let any future spec start building `EventInput`s — which is the
 * leak this rule exists to stop. Listing the one file keeps the exception visible:
 * adding another means editing this array and saying why.
 */
const CALENDAR_ADAPTER_ALLOWED = [
  'features/agenda/adapters/to-calendar-event.ts',
  'features/agenda/adapters/to-business-hours.ts',
  'features/agenda/components/agenda-calendar.tsx',
  'features/agenda/components/agenda-calendar.test.tsx',
];

/** Specifiers `packages/domain` may never import, at any depth. */
const DOMAIN_FORBIDDEN_SPECIFIERS = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'next',
  'vue',
  'svelte',
  'solid-js',
  '@tanstack/react-query',
  '@tanstack/react-router',
  '@tanstack/react-table',
  'zustand',
  'react-hook-form',
  'lucide-react',
  'drizzle-orm',
  'postgres',
  '@tauri-apps/api',
  '@tauri-apps/plugin-dialog',
  '@tauri-apps/plugin-fs',
  'fastify',
  'express',
];

/** Only these packages may import a database driver or ORM. */
const DATABASE_ALLOWED = ['@denti-code-u3/api', '@denti-code-u3/database'];
const DATABASE_SPECIFIERS = ['drizzle-orm', 'postgres', 'pg', 'node-postgres'];

/** Workspace packages the domain is allowed to import (types are pure data). */
const DOMAIN_ALLOWED_WORKSPACE = new Set(['@denti-code-u3/types']);

/**
 * Workspace packages allowed as `devDependencies` anywhere, because they are
 * build/editor tooling and never appear in shipped source. Checked against the
 * import graph above, so this is safe to widen.
 */
const TOOLING_WORKSPACE_PACKAGES = new Set(['@denti-code-u3/tsconfig', '@denti-code-u3/config']);

/** Shells that must stay a mount point and nothing more (ADR 0008). */
const THIN_SHELLS = [
  { name: '@denti-code-u3/web', dir: 'apps/web' },
  { name: '@denti-code-u3/desktop', dir: 'apps/desktop' },
];
const FORBIDDEN_SHELL_PATHS = ['src/routes', 'src/features', 'src/domain', 'src/hooks'];

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function listSourceFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      ['node_modules', 'dist', 'build', '.turbo', 'coverage', 'target', 'gen'].includes(entry.name)
    ) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listSourceFiles(full, out);
    } else if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Collect static import specifiers from a source file.
 *
 * Handles `import ... from 'x'`, `import 'x'` and `export ... from 'x'`. Dynamic
 * `import()` is intentionally included: a lazy import is still an import, and
 * allowing one would be a trivial way to smuggle a forbidden dependency past
 * this guard.
 */
function collectImportSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\bimport\s+[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s+[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

function isWorkspaceSpecifier(specifier) {
  return WORKSPACE_PACKAGES.some(
    (pkg) => specifier === pkg.name || specifier.startsWith(`${pkg.name}/`),
  );
}

function workspaceNameOf(specifier) {
  return WORKSPACE_PACKAGES.find(
    (pkg) => specifier === pkg.name || specifier.startsWith(`${pkg.name}/`),
  )?.name;
}

function relative(from, to) {
  return path.relative(root, to);
}

function main() {
  const errors = [];
  const warnings = [];

  // ---- manifests must exist -------------------------------------------
  for (const pkg of WORKSPACE_PACKAGES) {
    const manifest = readJsonIfExists(path.join(root, pkg.dir, 'package.json'));
    if (!manifest) {
      errors.push(`Missing package.json for ${pkg.name} (expected ${pkg.dir}/package.json).`);
      continue;
    }
    if (manifest.name !== pkg.name) {
      errors.push(
        `${pkg.dir}/package.json declares name "${manifest.name}", expected "${pkg.name}".`,
      );
    }
  }

  if (errors.length > 0) {
    report(errors, warnings);
    return;
  }

  // ---- rule 1: domain purity (import graph + manifest) ------------------
  const domainPkg = WORKSPACE_PACKAGES.find((p) => p.name === '@denti-code-u3/domain');
  const domainManifest = readJsonIfExists(path.join(root, domainPkg.dir, 'package.json'));
  const domainRuntimeDeps = Object.keys(domainManifest.dependencies ?? {});

  for (const dep of domainRuntimeDeps) {
    if (isWorkspaceSpecifier(dep) && !DOMAIN_ALLOWED_WORKSPACE.has(workspaceNameOf(dep))) {
      errors.push(
        `DOMAIN: packages/domain must not depend on workspace package ${dep} in dependencies.`,
      );
    }
  }

  const domainSources = listSourceFiles(path.join(root, domainPkg.dir, 'src'));
  for (const file of domainSources) {
    // Test files are allowed to import a test runner; shipped source is not.
    const isTestFile = /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);

    for (const specifier of collectImportSpecifiers(fs.readFileSync(file, 'utf8'))) {
      const label = relative(root, file);

      if (
        DOMAIN_FORBIDDEN_SPECIFIERS.includes(specifier) ||
        DOMAIN_FORBIDDEN_SPECIFIERS.some((forbidden) => specifier.startsWith(`${forbidden}/`))
      ) {
        errors.push(`DOMAIN: ${label} imports forbidden specifier "${specifier}".`);
        continue;
      }

      if (isWorkspaceSpecifier(specifier)) {
        const name = workspaceNameOf(specifier);
        if (!DOMAIN_ALLOWED_WORKSPACE.has(name)) {
          errors.push(`DOMAIN: ${label} imports workspace package "${specifier}".`);
        }
      }

      // Anything else outside the domain is a smell worth a human look.
      if (
        !isTestFile &&
        !specifier.startsWith('.') &&
        !specifier.startsWith('node:') &&
        !isWorkspaceSpecifier(specifier) &&
        specifier !== '@denti-code-u3/types'
      ) {
        warnings.push(`DOMAIN: ${label} imports third-party package "${specifier}".`);
      }
    }
  }

  // ---- rule 2: database access only in the API and database tooling ----
  for (const pkg of WORKSPACE_PACKAGES) {
    const dir = path.join(root, pkg.dir);
    const sources = listSourceFiles(path.join(dir, 'src'));
    for (const file of sources) {
      for (const specifier of collectImportSpecifiers(fs.readFileSync(file, 'utf8'))) {
        const isDatabaseSpecifier = DATABASE_SPECIFIERS.some(
          (candidate) => specifier === candidate || specifier.startsWith(`${candidate}/`),
        );
        if (isDatabaseSpecifier && !DATABASE_ALLOWED.includes(pkg.name)) {
          errors.push(
            `${pkg.name}: ${relative(root, file)} imports "${specifier}" (only apps/api and database may touch the database).`,
          );
        }
      }
    }
  }

  // ---- rule 3: no database driver as a dependency outside the API -------
  for (const pkg of WORKSPACE_PACKAGES) {
    if (DATABASE_ALLOWED.includes(pkg.name)) continue;
    const manifest = readJsonIfExists(path.join(root, pkg.dir, 'package.json'));
    const allDeps = Object.keys({
      ...(manifest.dependencies ?? {}),
      ...(manifest.devDependencies ?? {}),
    });
    for (const dep of allDeps) {
      if (DATABASE_SPECIFIERS.includes(dep)) {
        errors.push(
          `${pkg.name} must not depend on ${dep} (only apps/api and database may touch the database).`,
        );
      }
    }
  }

  // ---- rule 4: tooling devDependencies are allowed, runtime ones are not -
  for (const pkg of WORKSPACE_PACKAGES) {
    const manifest = readJsonIfExists(path.join(root, pkg.dir, 'package.json'));
    const runtimeDeps = Object.keys(manifest.dependencies ?? {});
    for (const dep of runtimeDeps) {
      const name = workspaceNameOf(dep);
      if (name && TOOLING_WORKSPACE_PACKAGES.has(name)) {
        errors.push(
          `${pkg.name}: ${dep} is build tooling and must be a devDependency, not a runtime dependency.`,
        );
      }
    }
    // A devDependency on tooling is fine; flag anything else so the list of
    // exceptions stays deliberate rather than accidental.
    for (const dep of Object.keys(manifest.devDependencies ?? {})) {
      const name = workspaceNameOf(dep);
      if (name && !TOOLING_WORKSPACE_PACKAGES.has(name)) {
        warnings.push(
          `${pkg.name}: ${dep} is a devDependency; verify the import graph does not rely on it at runtime.`,
        );
      }
    }
  }

  // ---- rule 5: FullCalendar stays behind its adapters (ADR 0011) ------
  //
  // ADR 0011 says the calendar library is replaceable, and that is only true if
  // nothing outside two adapter files and one component can name its types. The
  // failure is gradual rather than sudden: a query starts returning `EventInput`,
  // a helper imports `EventApi` to read a field, and the agenda's data shape leaks
  // into a second feature. By then "only the adapters import FullCalendar" is no
  // longer a change anyone makes.
  for (const file of listSourceFiles(path.join(root, 'packages/app/src'))) {
    for (const specifier of collectImportSpecifiers(fs.readFileSync(file, 'utf8'))) {
      if (!specifier.startsWith('@fullcalendar/')) continue;
      if (!CALENDAR_ADAPTER_ALLOWED.some((allowed) => file.endsWith(allowed))) {
        errors.push(
          `packages/app: ${relative(root, file)} imports "${specifier}" (FullCalendar may only be used in features/agenda/adapters/* and features/agenda/components/agenda-calendar.tsx — ADR 0011).`,
        );
      }
    }
  }

  // ---- rule 6: the deployment shells stay thin (ADR 0008) --------------
  for (const shell of THIN_SHELLS) {
    for (const forbidden of FORBIDDEN_SHELL_PATHS) {
      const target = path.join(root, shell.dir, forbidden);
      if (fs.existsSync(target)) {
        errors.push(
          `SHELL: ${shell.dir}/${forbidden} exists; routes and features belong in packages/app (ADR 0008).`,
        );
      }
    }

    const shellManifest = readJsonIfExists(path.join(root, shell.dir, 'package.json'));
    const shellDeps = Object.keys(shellManifest.dependencies ?? {});
    for (const dep of shellDeps) {
      if (dep === '@denti-code-u3/api-client' || dep === '@denti-code-u3/domain') {
        warnings.push(
          `SHELL: ${shell.dir} depends on ${dep}; prefer going through packages/app so the shell stays thin.`,
        );
      }
    }
  }

  report(errors, warnings);
}

function report(errors, warnings) {
  if (warnings.length > 0) {
    console.log('BOUNDARY GUARD WARNINGS');
    for (const warning of warnings) console.log('  -', warning);
    console.log('');
  }

  if (errors.length > 0) {
    console.error('BOUNDARY GUARD FAILURES');
    for (const error of errors) console.error('  -', error);
    process.exit(1);
  }

  console.log('BOUNDARY GUARD OK');
}

main();
