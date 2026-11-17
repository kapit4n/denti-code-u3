import { capabilitiesForTarget, mountApp, type PlatformCapabilities } from '@denti-code-u3/app';
import '@denti-code-u3/app/styles';

/**
 * The desktop shell supplies the shared app with one extra capability: the
 * first-run credentials injected by the embedded local server (ADR 0041).
 * The API URL and the history type still come from the target, so the shell owns
 * no routes, providers or business logic (ADR-0008, ADR-0009).
 */
const capabilities: PlatformCapabilities = {
  ...capabilitiesForTarget('desktop'),
  async getLocalClinicCredentials() {
    const credentials = window.__DENTI_CODE_LOCAL_CREDENTIALS__;
    return credentials ? { email: credentials.email, password: credentials.password } : undefined;
  },
};

mountApp({ target: 'desktop', capabilities });
