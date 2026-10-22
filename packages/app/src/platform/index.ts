/**
 * Platform abstraction.
 *
 * The application must never ask "am I running in Tauri?" and never import a
 * Tauri API directly (architecture rule 5). Instead it declares the capabilities
 * it needs, and the deployment shell provides an implementation.
 *
 * This module holds the contract and the browser defaults. `saveFile` is a download
 * in both targets: a webview is a browser, and a CSV export that lands in the
 * download folder works without a new Tauri capability or a native dialog. If the
 * desktop shell later wants a real "save as" dialog, it provides its own
 * capabilities through `mountApp({ capabilities })`; the app does not need to know.
 *
 * The web implementation creates an object URL and clicks a temporary anchor, then
 * revokes the URL. It never imports Tauri, so architecture rule 5 stays satisfied.
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
  /**
   * Save a text file under `suggestedName`, resolving with the name used.
   *
   * The web build downloads it. A native shell may later show a "save as" dialog,
   * but the caller only needs to know the export left the page.
   */
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
 * lying about where it is running. `openExternal` still uses the browser for both
 * targets, and a missing DOM makes the operations reject rather than pretend.
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
    async saveFile(suggestedName, contents) {
      // A native window with no DOM (or a test environment without it) cannot
      // download. Say so, rather than silently returning a name for a file that was
      // never written.
      if (
        typeof document === 'undefined' ||
        typeof URL === 'undefined' ||
        typeof URL.createObjectURL !== 'function'
      ) {
        throw new PlatformUnsupportedError('saveFile');
      }

      const blob = new Blob([contents], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = suggestedName;
      anchor.rel = 'noopener';
      anchor.style.display = 'none';

      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Revoking immediately can race the download in some browsers; one turn of
      // the event loop is enough for the browser to take the blob.
      setTimeout(() => URL.revokeObjectURL(url), 0);

      return suggestedName;
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
