import { describe, expect, it, vi } from 'vitest';

import {
  readSidebarCollapsed,
  rememberSidebarCollapsed,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
} from './sidebar-state.js';

function storageWith(value: string | null) {
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn(),
  };
}

describe('sidebar collapse preference', () => {
  it('starts expanded when there is no storage', () => {
    expect(readSidebarCollapsed(undefined)).toBe(false);
  });

  it('reads only the stored true value as collapsed', () => {
    expect(readSidebarCollapsed(storageWith('true'))).toBe(true);
    expect(readSidebarCollapsed(storageWith('false'))).toBe(false);
    expect(readSidebarCollapsed(storageWith('1'))).toBe(false);
  });

  it('falls back to expanded when storage refuses to be read', () => {
    const storage = storageWith(null);
    storage.getItem.mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(readSidebarCollapsed(storage)).toBe(false);
  });

  it('remembers both states under the sidebar key', () => {
    const storage = storageWith(null);

    rememberSidebarCollapsed(storage, true);
    rememberSidebarCollapsed(storage, false);

    expect(storage.setItem).toHaveBeenNthCalledWith(1, SIDEBAR_COLLAPSED_STORAGE_KEY, 'true');
    expect(storage.setItem).toHaveBeenNthCalledWith(2, SIDEBAR_COLLAPSED_STORAGE_KEY, 'false');
  });

  it('does not crash when storage refuses to be written', () => {
    const storage = storageWith(null);
    storage.setItem.mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(() => rememberSidebarCollapsed(storage, true)).not.toThrow();
  });
});
