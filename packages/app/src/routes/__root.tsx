/**
 * The router's document shell.
 *
 * `__root.tsx` is the outermost route: it wraps every page, so the app frame
 * lives here exactly once instead of being repeated in each route.
 *
 * Phase 1 note: the router is wired in the deployment shells' build (the
 * TanStack Router Vite plugin generates `routeTree.gen.ts` from this folder),
 * but `AppRoot` is not yet mounted behind it. Feature routes are deliberately
 * empty until their milestones.
 */
import type { ReactNode } from 'react';
import { AppRoot } from '../app-root.js';
import type { PlatformCapabilities } from '../platform/index.js';

export interface RouteShellProps {
  readonly children?: ReactNode;
  /** Forwarded by the shell so the root frame knows its runtime. */
  readonly capabilities?: PlatformCapabilities;
}

export function Root({ children, capabilities }: RouteShellProps): ReactNode {
  return <AppRoot capabilities={capabilities}>{children}</AppRoot>;
}
