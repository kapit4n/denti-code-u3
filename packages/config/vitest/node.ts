import { defineConfig } from 'vitest/config';

/** Vitest project for Node-runtime packages (domain, validation, api-client, api). */
export function nodeVitestConfig(name: string) {
  return defineConfig({
    test: {
      name,
      environment: 'node',
      include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    },
  });
}
