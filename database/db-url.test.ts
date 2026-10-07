import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ensureSqliteDatabaseDirectory, sqliteDatabasePath } from './db-url.js';

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'denti-db-url-'));
  created.push(directory);
  return directory;
}

describe('sqliteDatabasePath', () => {
  it('keeps an absolute path as it is', () => {
    expect(sqliteDatabasePath(`sqlite:${path.join(os.tmpdir(), 'denti.db')}`)).toBe(
      path.join(os.tmpdir(), 'denti.db'),
    );
  });

  it('names :memory: in both of its URL forms', () => {
    expect(sqliteDatabasePath(':memory:')).toBe(':memory:');
    expect(sqliteDatabasePath('sqlite::memory:')).toBe(':memory:');
  });
});

describe('ensureSqliteDatabaseDirectory', () => {
  it('creates the directory a file URL names, so the file can be opened', () => {
    const root = tempRoot();
    const databasePath = path.join(root, 'data', 'denti.db');

    expect(fs.existsSync(path.dirname(databasePath))).toBe(false);

    ensureSqliteDatabaseDirectory(`sqlite:${databasePath}`);

    expect(fs.existsSync(path.dirname(databasePath))).toBe(true);
    // better-sqlite3 now accepts the path: the directory is what it refused.
    expect(fs.statSync(path.dirname(databasePath)).isDirectory()).toBe(true);
  });

  it('is a no-op when the directory already exists', () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, 'data'));

    ensureSqliteDatabaseDirectory(`sqlite:${path.join(root, 'data', 'denti.db')}`);
    ensureSqliteDatabaseDirectory(`sqlite:${path.join(root, 'data', 'denti.db')}`);

    expect(fs.readdirSync(path.join(root, 'data'))).toEqual([]);
  });

  it('creates a directory the caller asked for more than one level down', () => {
    const root = tempRoot();

    ensureSqliteDatabaseDirectory(`sqlite:${path.join(root, 'a', 'b', 'denti.db')}`);

    expect(fs.existsSync(path.join(root, 'a', 'b'))).toBe(true);
  });

  it('does nothing for the in-memory database, which has no directory', () => {
    expect(() => ensureSqliteDatabaseDirectory(':memory:')).not.toThrow();
    expect(() => ensureSqliteDatabaseDirectory('sqlite::memory:')).not.toThrow();
  });
});
