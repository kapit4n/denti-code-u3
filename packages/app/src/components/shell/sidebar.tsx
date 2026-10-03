import { Link, useRouterState } from '@tanstack/react-router';
import { cn } from '@denti-code-u3/ui';
import {
  Calendar,
  Clock,
  FileText,
  Home,
  Pill,
  Receipt,
  Stethoscope,
  Users,
  Warehouse,
  BarChart3,
} from 'lucide-react';

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  badge?: string;
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
    icon: Clock,
  },
];

export function Sidebar() {
  const { location } = useRouterState();

  return (
    <div className="flex h-full w-64 flex-col border-r bg-sidebar-background text-sidebar-foreground">
      <div className="flex h-14 items-center border-b border-sidebar-border px-4">
        <div className="flex flex-col">
          <span className="text-lg font-semibold tracking-tight text-sidebar-foreground">
            Denti-Code U3
          </span>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-2 py-4">
        {navItems.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                'group flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                  : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              )}
            >
              <item.icon
                className={cn(
                  'mr-3 h-5 w-5 flex-shrink-0',
                  isActive
                    ? 'text-sidebar-primary-foreground'
                    : 'text-sidebar-muted group-hover:text-sidebar-accent-foreground',
                )}
              />
              {item.title}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-2">
        {bottomNavItems.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                'group flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                  : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              )}
            >
              <item.icon className="mr-3 h-5 w-5 flex-shrink-0" />
              {item.title}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
