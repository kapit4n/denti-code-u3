/**
 * Platform abstraction.
 *
 * The application must never ask "am I running in Tauri?" and never import a
 * Tauri API directly (architecture rule 5). Instead it declares the capabilities
 * it needs, and the deployment shell provides an implementation.
 *
 * This is the *contract* only. The web implementation lives in
 * `apps/web/src/platform.ts` and the desktop implementation in
 * `apps/desktop/src/platform.ts`, so neither shell's API leaks inward.
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
 * Capabilities used when nothing has been injected.
 *
 * A safe default is deliberate: a forgotten `PlatformProvider` must degrade to
 * "web, no native shell", never to a crash in the middle of a clinical screen.
 */
export const defaultWebCapabilities: PlatformCapabilities = {
  target: 'web',
  hasNativeShell: false,
  locale: typeof navigator === 'undefined' ? 'es' : navigator.language,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  async openExternal(url) {
    if (typeof window === 'undefined') {
      throw new PlatformUnsupportedError('openExternal');
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  },
  async saveFile() {
    throw new PlatformUnsupportedError('saveFile');
  },
};
