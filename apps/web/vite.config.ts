import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

export default defineConfig({
  // Vite resolves `.env` against its own root, which is this shell. The
  // documented `.env` lives at the monorepo root and is shared by both shells,
  // so envDir has to point there or VITE_API_URL silently resolves to undefined.
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      // Routes live in the SHARED app package, never in a shell. Pointing the
      // generator here is what keeps apps/web and apps/desktop free of route
      // files (ADR-0008).
      routesDirectory: fileURLToPath(new URL('../../packages/app/src/routes', import.meta.url)),
      generatedRouteTree: fileURLToPath(
        new URL('../../packages/app/src/routeTree.gen.ts', import.meta.url),
      ),
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
  build: {
    sourcemap: true,
  },
});
