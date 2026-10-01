/**
 * Platform abstraction.
 *
 * The application must never ask "am I running in Tauri?" and never import a
 * Tauri API directly (architecture rule 5). Instead it declares the capabilities
 * it needs, and the deployment shell provides an implementation.
 *
 * This module holds the contract and the browser-only defaults. It is NOT the
 * implementation split: no per-shell `platform.ts` file exists yet, because the only
 * capability that genuinely needs a per-shell implementation — a native save
 * dialog — has no consumer until a feature needs to export a file.
 *
 * Until then `capabilitiesForTarget` answers for both targets, and the desktop
 * shell's native operations reject with `UNSUPPORTED` rather than pretending to
 * work. That keeps architecture rule 5 satisfied (no Tauri import in the app,
 * no `window` assumption in a native window) without inventing an abstraction
 * nothing calls yet. When a feature does need a native dialog, this is the file
 * that changes: add a desktop `platform.ts` implementation, and have the desktop shell
 * pass its capabilities through `mountApp({ capabilities })`.
 */

/** How the app is being presented. Useful for layout decisions, not branching logic. */
export type RuntimeTarget = 'web' | 'desktop';

export interface PlatformCapabilities {
  readonly target: RuntimeTarget;
  /** True when the app runs inside the Tauri shell and can reach the OS. */
  readonly hasNativeShell: boolean;
  /**
   * Open an external URL in the user's browser (or the OS default handler).
   * Web: `window.open`. Desktop: the OS browser.
   */
  openExternal(url: string): Promise<void>;
  /** Show a native "save as" dialog. Rejects with `UNSUPPORTED` on web. */
  saveFile(suggestedName: string, contents: string): Promise<string>;
  /** Read the operator's locale, e.g. `es-PE`. */
  readonly locale: string;
  /** Read the operator's time zone, e.g. `America/Lima`. */
  readonly timeZone: string;
}

export class PlatformUnsupportedError extends Error {
  readonly capability: string;

  constructor(capability: string) {
    super(`This capability is not available on the current platform: ${capability}`);
    this.name = 'PlatformUnsupportedError';
    this.capability = capability;
  }
}

/**
 * Capabilities for a target, used when the shell injects none.
 *
 * `target` is reported honestly from the argument rather than hardcoded to
 * `web`, so a desktop build renders "Desktop" in the runtime badge instead of
 * lying about where it is running. Everything that needs the OS still rejects:
 * a missing native call must be visible in development, not discovered when a
 * clinician exports a report.
 */
export function capabilitiesForTarget(target: RuntimeTarget): PlatformCapabilities {
  const locale = typeof navigator === 'undefined' ? 'es' : navigator.language;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return {
    target,
    // Reported from the target rather than from a Tauri probe: the app may not
    // import Tauri APIs (rule 5), and the shell is what knows it is native.
    hasNativeShell: target === 'desktop',
    locale,
    timeZone,
    async openExternal(url) {
      // Both targets use the browser for now. The desktop shell will replace
      // this through mountApp({ capabilities }) when a real OS handler exists.
      if (typeof window === 'undefined') {
        throw new PlatformUnsupportedError('openExternal');
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    async saveFile() {
      throw new PlatformUnsupportedError('saveFile');
    },
  };
}

/**
 * Capabilities used when nothing has been injected and no target was declared.
 *
 * A safe default is deliberate: a forgotten `PlatformProvider` must degrade to
 * "web, no native shell", never to a crash in the middle of a clinical screen.
 */
export const defaultWebCapabilities: PlatformCapabilities = capabilitiesForTarget('web');
