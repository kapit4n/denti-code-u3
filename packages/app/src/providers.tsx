/**
 * App-wide React context.
 *
 * Kept deliberately small: providers arrive later (TanStack Router, TanStack
 * Query) when there is something to provide. This file exists so the shells
 * mount a stable, inspectable tree and so `AppRoot` stays testable.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { defaultWebCapabilities, type PlatformCapabilities } from './platform/index.js';

const PlatformContext = createContext<PlatformCapabilities>(defaultWebCapabilities);

export function PlatformProvider({
  capabilities,
  children,
}: {
  readonly capabilities?: PlatformCapabilities;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <PlatformContext.Provider value={capabilities ?? defaultWebCapabilities}>
      {children}
    </PlatformContext.Provider>
  );
}

/** The current platform capabilities. Always defined; never throws. */
export function usePlatform(): PlatformCapabilities {
  return useContext(PlatformContext);
}
