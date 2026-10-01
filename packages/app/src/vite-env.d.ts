/// <reference types="vite/client" />

/**
 * Build-time configuration read by `packages/app`.
 *
 * `import.meta.env` is inlined by Vite when the shell is built, so these are
 * compile-time constants rather than a runtime lookup that could fail later.
 * They are declared here, in the package that reads them, so `pnpm typecheck`
 * catches a typo instead of the value silently resolving to `undefined`.
 */
interface ImportMetaEnv {
  /**
   * REST API origin for the web target, e.g. `http://localhost:3010`. Paths are
   * appended by the API client. There is no version prefix until the API adds one.
   */
  readonly VITE_API_URL?: string;
  /**
   * REST API base URL for the desktop target. A desktop install usually reaches a
   * server on the same machine, so it may differ from the web value.
   */
  readonly VITE_API_URL_DESKTOP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
