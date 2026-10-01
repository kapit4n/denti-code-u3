import { mountApp } from '@denti-code-u3/app';
import '@denti-code-u3/app/styles';

/**
 * The web shell's entire job: call the shared entry point.
 *
 * It declares no routes, providers or layout. If it ever grows any of those,
 * that logic belongs in `packages/app` instead — otherwise the desktop shell
 * would not get it (ADR-0008).
 */
mountApp({ target: 'web' });
