import { Outlet } from '@tanstack/react-router';
import { Sidebar } from './sidebar.js';
import { Header } from './header.js';

export function Shell() {
  return (
    <div className="flex h-full flex-1">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto bg-background p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
