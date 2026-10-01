/**
 * App-wide React context.
 *
 * Platform capabilities are already resolved before they reach here: the root
 * route reads them from the router context, where `createAppRouter` has always
 * filled them in from the target. So this provider is required rather than
 * optional — a second "fall back to web" path would be exactly the ambiguity
 * that let the desktop shell render "Web" while running as desktop.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { defaultWebCapabilities, type PlatformCapabilities } from './platform/index.js';

const PlatformContext = createContext<PlatformCapabilities>(defaultWebCapabilities);

export function PlatformProvider({
  capabilities,
  children,
}: {
  readonly capabilities: PlatformCapabilities;
  readonly children: ReactNode;
}): ReactNode {
  return <PlatformContext.Provider value={capabilities}>{children}</PlatformContext.Provider>;
}

/** The current platform capabilities. Always defined; never throws. */
export function usePlatform(): PlatformCapabilities {
  return useContext(PlatformContext);
}
