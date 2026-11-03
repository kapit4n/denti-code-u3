import { useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { Button, cn } from '@denti-code-u3/ui';
import { useTranslation, type TranslationKey } from '../../i18n/index.js';
import {
  BarChart3,
  Calendar,
  FileText,
  Home,
  PanelLeftClose,
  PanelLeftOpen,
  Pill,
  Receipt,
  Settings,
  Stethoscope,
  Users,
  Warehouse,
} from 'lucide-react';
import { readSidebarCollapsed, rememberSidebarCollapsed, sidebarStorage } from './sidebar-state.js';

interface NavItem {
  titleKey: TranslationKey;
  href: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}

const navItems: NavItem[] = [
  {
    titleKey: 'common.nav.dashboard',
    // The dashboard lives at its own route; `/` stays the foundation-status page.
    href: '/dashboard',
    icon: Home,
  },
  {
    titleKey: 'common.nav.patients',
    href: '/patients',
    icon: Users,
  },
  {
    titleKey: 'common.nav.agenda',
    href: '/agenda',
    icon: Calendar,
  },
  {
    titleKey: 'common.nav.visits',
    href: '/visits',
    icon: Stethoscope,
  },
  {
    titleKey: 'common.nav.odontogram',
    href: '/odontogram',
    icon: FileText,
  },
  {
    titleKey: 'common.nav.treatments',
    href: '/treatments',
    icon: Pill,
  },
  {
    titleKey: 'common.nav.payments',
    href: '/payments',
    icon: Receipt,
  },
  {
    titleKey: 'common.nav.inventory',
    href: '/inventory',
    icon: Warehouse,
  },
  {
    titleKey: 'common.nav.reports',
    href: '/reports',
    icon: BarChart3,
  },
];

const bottomNavItems: NavItem[] = [
  {
    titleKey: 'common.nav.settings',
    href: '/settings',
    icon: Settings,
  },
];

export function Sidebar() {
  const { location } = useRouterState();
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => readSidebarCollapsed(sidebarStorage()));

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    rememberSidebarCollapsed(sidebarStorage(), next);
  }

  const toggleLabel = collapsed
    ? t('common.shell.expandSidebar')
    : t('common.shell.collapseSidebar');

  return (
    <div
      id="app-sidebar"
      data-testid="sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'flex h-full flex-col border-r border-sidebar-border bg-sidebar-background text-sidebar-foreground transition-[width] duration-200 motion-reduce:transition-none',
        collapsed ? 'w-20' : 'w-64',
      )}
    >
      <div
        className={cn(
          'flex h-16 items-center border-b border-sidebar-border bg-sidebar-secondary',
          collapsed ? 'justify-center px-2' : 'gap-3 px-4',
        )}
      >
        <span
          title={collapsed ? 'Denti-Code U3' : undefined}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
        >
          <Stethoscope aria-hidden className="h-5 w-5" />
        </span>
        {collapsed ? null : (
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold tracking-tight">Denti-Code U3</span>
            <span className="truncate text-xs text-sidebar-muted">
              {t('common.shell.clinicManagement')}
            </span>
          </div>
        )}
      </div>

      <nav
        aria-label={t('common.nav.primary')}
        className={cn('flex-1 space-y-1 overflow-y-auto py-4', collapsed ? 'px-2' : 'px-3')}
      >
        <Button
          type="button"
          variant="ghost"
          data-testid="sidebar-toggle"
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={toggleCollapsed}
          className={cn(
            'mb-3 h-10 w-full text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            collapsed ? 'justify-center px-0' : 'justify-start px-3',
          )}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden className="h-5 w-5" />
          ) : (
            <PanelLeftClose aria-hidden className="h-5 w-5" />
          )}
          {collapsed ? null : <span className="truncate">{toggleLabel}</span>}
        </Button>

        {navItems.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            isActive={location.pathname === item.href}
            collapsed={collapsed}
          />
        ))}
      </nav>

      <div className={cn('border-t border-sidebar-border', collapsed ? 'p-2' : 'p-3')}>
        {bottomNavItems.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            isActive={location.pathname === item.href}
            collapsed={collapsed}
          />
        ))}
      </div>
    </div>
  );
}

function NavLink({
  item,
  isActive,
  collapsed,
}: {
  readonly item: NavItem;
  readonly isActive: boolean;
  readonly collapsed: boolean;
}) {
  const { t } = useTranslation();
  const label = t(item.titleKey);

  return (
    <Link
      to={item.href}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'group flex items-center rounded-lg py-2.5 text-sm font-medium transition-colors',
        collapsed ? 'justify-center px-2' : 'gap-3 px-3',
        isActive
          ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
      )}
    >
      <item.icon
        aria-hidden
        className={cn(
          'h-5 w-5 shrink-0',
          isActive
            ? 'text-sidebar-primary-foreground'
            : 'text-sidebar-muted group-hover:text-sidebar-accent-foreground',
        )}
      />
      {collapsed ? null : <span className="truncate">{label}</span>}
    </Link>
  );
}
