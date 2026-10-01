import { cn } from '@denti-code-u3/ui';
import type { PlatformCapabilities } from './platform/index.js';
import { PlatformProvider, usePlatform } from './providers.js';

export interface AppRootProps {
  /**
   * Resolved platform capabilities. Required: the root route gets them from the
   * router context, and `createAppRouter` has already supplied the target's
   * defaults, so there is no correct case for omitting them.
   */
  readonly capabilities: PlatformCapabilities;
  /** Mount point for routes. Supplied by the root route's `<Outlet />`. */
  readonly children?: React.ReactNode;
}

function RuntimeBadge(): React.ReactNode {
  const platform = usePlatform();
  return (
    <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
      {platform.hasNativeShell ? 'Desktop' : 'Web'} · {platform.timeZone}
    </span>
  );
}

/**
 * The single React application rendered by both the web and desktop shells.
 *
 * This component is shell-agnostic by construction (ADR-0008): it receives
 * capabilities as a prop rather than importing Tauri, so the same tree compiles
 * for both targets and neither shell leaks inward.
 */
export function AppRoot({ capabilities, children }: AppRootProps): React.ReactNode {
  return (
    <PlatformProvider capabilities={capabilities}>
      <div className="flex min-h-screen flex-col bg-background text-foreground antialiased">
        <header className="border-b bg-card">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex flex-col">
              <span className="text-lg font-semibold tracking-tight">Denti-Code U3</span>
              <span className={cn('text-xs', 'text-muted-foreground')}>
                Dental clinic management
              </span>
            </div>
            <RuntimeBadge />
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
          {children ?? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <h1 className="text-2xl font-semibold tracking-tight">Denti-Code U3</h1>
              <p className="max-w-prose text-sm text-muted-foreground">
                The application foundation is in place. Clinical features arrive in later
                milestones; no business logic runs in this shell.
              </p>
            </div>
          )}
        </div>

        <footer className="border-t bg-card">
          <div className="mx-auto w-full max-w-7xl px-4 py-2 text-xs text-muted-foreground sm:px-6 lg:px-8">
            Denti-Code U3 · Milestone 2 · application shell
          </div>
        </footer>
      </div>
    </PlatformProvider>
  );
}
