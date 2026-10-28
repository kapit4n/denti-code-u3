import { Link, useRouterState } from '@tanstack/react-router';
import { cn } from '@denti-code-u3/ui';
import { useTranslation, type TranslationKey } from '../../i18n/index.js';
import {
  BarChart3,
  Calendar,
  FileText,
  Home,
  Pill,
  Receipt,
  Settings,
  Stethoscope,
  Users,
  Warehouse,
} from 'lucide-react';

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

  return (
    <div className="flex h-full w-64 flex-col border-r border-sidebar-border bg-sidebar-background text-sidebar-foreground">
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border bg-sidebar-secondary px-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <Stethoscope aria-hidden className="h-5 w-5" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold tracking-tight">Denti-Code U3</span>
          <span className="truncate text-xs text-sidebar-muted">
            {t('common.shell.clinicManagement')}
          </span>
        </div>
      </div>

      <nav
        aria-label={t('common.nav.primary')}
        className="flex-1 space-y-1 overflow-y-auto px-3 py-4"
      >
        {navItems.map((item) => (
          <NavLink key={item.href} item={item} isActive={location.pathname === item.href} />
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        {bottomNavItems.map((item) => (
          <NavLink key={item.href} item={item} isActive={location.pathname === item.href} />
        ))}
      </div>
    </div>
  );
}

function NavLink({ item, isActive }: { readonly item: NavItem; readonly isActive: boolean }) {
  const { t } = useTranslation();

  return (
    <Link
      to={item.href}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
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
      <span className="truncate">{t(item.titleKey)}</span>
    </Link>
  );
}
