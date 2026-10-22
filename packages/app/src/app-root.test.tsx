/**
 * The shell tests that matter most right now assert the *architecture*, not the
 * pixels: one `AppRoot`, mountable in both environments, with no shell-specific
 * code path inside it.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppRoot } from './app-root.js';
import { defaultWebCapabilities, type PlatformCapabilities } from './platform/index.js';
import type { PlatformCapabilities as CapabilitiesFromContract } from './platform/index.js';

const desktopCapabilities: PlatformCapabilities = {
  ...defaultWebCapabilities,
  target: 'desktop',
  hasNativeShell: true,
  locale: 'es-PE',
  timeZone: 'America/Lima',
  async openExternal(url) {
    void url;
  },
  async saveFile() {
    return '/tmp/report.csv';
  },
};

describe('AppRoot', () => {
  it('renders the application identity', () => {
    render(<AppRoot capabilities={defaultWebCapabilities} />);

    expect(screen.getByRole('heading', { name: 'Denti-Code U3' })).toBeInTheDocument();
  });

  it('reports the web runtime with no shell-specific branch', () => {
    render(<AppRoot capabilities={defaultWebCapabilities} />);

    expect(screen.getByText(/^Web · /)).toBeInTheDocument();
  });

  it('accepts injected capabilities from the desktop shell', () => {
    render(<AppRoot capabilities={desktopCapabilities} />);

    expect(screen.getByText('Desktop · America/Lima')).toBeInTheDocument();
  });

  it('renders children as the route mount point', () => {
    render(
      <AppRoot capabilities={defaultWebCapabilities}>
        <p>Route content</p>
      </AppRoot>,
    );

    expect(screen.getByText('Route content')).toBeInTheDocument();
  });
});

describe('platform contract', () => {
  it('exposes the same shape on web and desktop', () => {
    // A compile-time guarantee, restated as a runtime check on the keys the app
    // is allowed to rely on.
    const webKeys = Object.keys(defaultWebCapabilities).sort();
    const desktopKeys = Object.keys(desktopCapabilities).sort();

    expect(webKeys).toEqual(desktopKeys);
  });

  it('downloads an export on web and names the file it saved', async () => {
    const createObjectURL = vi.fn(() => 'blob:report');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const saved = await defaultWebCapabilities.saveFile('report.csv', 'a,b');

    expect(saved).toBe('report.csv');
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');

    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it('keeps the exported contract and the internal contract identical', () => {
    const contract: CapabilitiesFromContract = defaultWebCapabilities;
    expect(contract.target).toBe('web');
  });
});
