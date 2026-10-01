import { defineConfig } from 'vitest/config';

export function reactVitestConfig(name: string) {
  return defineConfig({
    test: {
      name,
      environment: 'jsdom',
      globals: true,
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      setupFiles: ['./vitest.setup.ts'],
    },
  });
}
