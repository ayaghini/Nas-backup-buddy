import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';

const PAGE_TITLES: Record<string, string> = {
  '/':          'Dashboard',
  '/matches':   'Match Finder',
  '/health':    'Health Checks',
  '/restore':   'Restore Drills',
  '/incidents': 'Incidents',
  '/profile':   'My Profile',
  '/admin':     'Admin',
  '/help':      'Help & Docs',
};

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Resolve title — handles /matches/:id etc.
  const pathRoot = '/' + location.pathname.split('/')[1];
  const title = PAGE_TITLES[location.pathname] ?? PAGE_TITLES[pathRoot] ?? 'NAS Backup Buddy';

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900/50 backdrop-blur flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          <h1 className="text-sm font-semibold text-slate-200">{title}</h1>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:inline text-xs text-slate-500 font-mono">
              {new Date().toLocaleDateString('en-GB', {
                weekday: 'short',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </span>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs
              bg-amber-400/10 text-amber-400 border-amber-400/25">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              Alpha · Invite-only
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
