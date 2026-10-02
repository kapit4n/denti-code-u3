import { useState } from 'react';
import { Button, Input } from '@denti-code-u3/ui';
import { Bell, Search, User } from 'lucide-react';
import { ThemeToggle } from '../../features/theme/theme-toggle.js';

export function Header() {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="flex h-14 items-center justify-between border-b bg-background px-4">
      <div className="flex flex-1 items-center space-x-4">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search patients..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      <div className="flex items-center space-x-2">
        <ThemeToggle />
        <Button variant="ghost" size="icon">
          <Bell className="h-5 w-5" />
          <span className="sr-only">Notifications</span>
        </Button>
        <Button variant="ghost" size="icon">
          <User className="h-5 w-5" />
          <span className="sr-only">User menu</span>
        </Button>
      </div>
    </div>
  );
}
