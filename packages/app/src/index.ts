/**
 * The shared React application, consumed by both deployment shells.
 *
 * `apps/web` and `apps/desktop` import only from here (ADR-0008). They call
 * `mountApp`, optionally inject their own platform capabilities, and add nothing
 * else — no routes, no providers, no business logic live in a shell.
 */
export { mountApp, type MountAppOptions } from './mount.js';

export { AppRoot } from './app-root.js';
export type { AppRootProps } from './app-root.js';

export { createAppRouter, type AppRouter, type CreateAppRouterOptions } from './router.js';

export {
  PlatformUnsupportedError,
  defaultWebCapabilities,
  type PlatformCapabilities,
  type RuntimeTarget,
} from './platform/index.js';

export { PlatformProvider, usePlatform } from './providers.js';

export { ApiClientProvider, useApiClient } from './query/api-client-provider.js';
