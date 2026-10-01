/**
 * The shared React application, consumed by both deployment shells.
 *
 * `apps/web` and `apps/desktop` import only from here (ADR-0008). They mount
 * `AppRoot`, optionally inject their own platform capabilities, and add nothing
 * else — no routes, no providers, no business logic live in a shell.
 */
export { AppRoot } from './app-root.js';
export type { AppRootProps } from './app-root.js';

export {
  PlatformUnsupportedError,
  defaultWebCapabilities,
  type PlatformCapabilities,
  type RuntimeTarget,
} from './platform/index.js';

export { PlatformProvider, usePlatform } from './providers.js';
