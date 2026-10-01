import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

export default defineConfig({
  plugins: [
    // The route tree is generated. Without the plugin here, `pnpm test` would
    // depend on a file that only exists after a web or desktop build.
    tanstackRouter({
      target: 'react',
      routesDirectory: fileURLToPath(new URL('./src/routes', import.meta.url)),
      generatedRouteTree: fileURLToPath(new URL('./src/routeTree.gen.ts', import.meta.url)),
    }),
    react(),
  ],
  test: {
    name: 'app',
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
