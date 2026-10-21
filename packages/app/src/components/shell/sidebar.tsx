import { Link, useRouterState } from '@tanstack/react-router';
import { cn } from '@denti-code-u3/ui';
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
  title: string;
  href: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}

const navItems: NavItem[] = [
  {
    title: 'Dashboard',
    // The dashboard lives at its own route; `/` stays the foundation-status page.
    href: '/dashboard',
    icon: Home,
  },
  {
    title: 'Patients',
    href: '/patients',
    icon: Users,
  },
  {
    title: 'Agenda',
    href: '/agenda',
    icon: Calendar,
  },
  {
    title: 'Visits',
    href: '/visits',
    icon: Stethoscope,
  },
  {
    title: 'Odontogram',
    href: '/odontogram',
    icon: FileText,
  },
  {
    title: 'Treatments',
    href: '/treatments',
    icon: Pill,
  },
  {
    title: 'Payments',
    href: '/payments',
    icon: Receipt,
  },
  {
    title: 'Inventory',
    href: '/inventory',
    icon: Warehouse,
  },
  {
    title: 'Reports',
    href: '/reports',
    icon: BarChart3,
  },
];

const bottomNavItems: NavItem[] = [
  {
    title: 'Settings',
    href: '/settings',
    icon: Settings,
  },
];

export function Sidebar() {
  const { location } = useRouterState();

  return (
    <div className="flex h-full w-64 flex-col border-r border-sidebar-border bg-sidebar-background text-sidebar-foreground">
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border bg-sidebar-secondary px-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <Stethoscope aria-hidden className="h-5 w-5" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold tracking-tight">Denti-Code U3</span>
          <span className="truncate text-xs text-sidebar-muted">Clinic management</span>
        </div>
      </div>

      <nav aria-label="Primary" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
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
      <span className="truncate">{item.title}</span>
    </Link>
  );
}
