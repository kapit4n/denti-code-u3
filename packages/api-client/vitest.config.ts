import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api-client',
    // The client targets browser and Node runtimes, so its tests use neither
    // jsdom nor a DOM-specific setup.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
