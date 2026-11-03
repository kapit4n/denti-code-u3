export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'denti-code-sidebar-collapsed';

type SidebarStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function sidebarStorage(): SidebarStorage | undefined {
  if (typeof window === 'undefined') return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readSidebarCollapsed(storage: SidebarStorage | undefined): boolean {
  if (!storage) return false;

  try {
    return storage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function rememberSidebarCollapsed(
  storage: SidebarStorage | undefined,
  collapsed: boolean,
): void {
  if (!storage) return;

  try {
    storage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    // A webview that refuses storage still keeps this session's collapsed state.
  }
}
