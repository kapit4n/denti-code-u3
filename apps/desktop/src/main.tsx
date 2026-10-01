import { mountApp } from '@denti-code-u3/app';
import '@denti-code-u3/app/styles';

/**
 * The desktop shell's entire job: call the shared entry point.
 *
 * The API URL and the history type both come from the target rather than from
 * here, so this file stays identical to the web shell's apart from one string
 * (ADR-0008, ADR-0009).
 */
mountApp({ target: 'desktop' });
