import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Activity,
  RotateCcw,
  AlertTriangle,
  User,
  Shield,
  HelpCircle,
  Database,
  X,
} from 'lucide-react';
import { CURRENT_USER } from '../data/mockData';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/',          label: 'Dashboard',      icon: <LayoutDashboard size={16} /> },
  { to: '/matches',   label: 'Matches',         icon: <Users size={16} /> },
  { to: '/health',    label: 'Health Checks',   icon: <Activity size={16} /> },
  { to: '/restore',   label: 'Restore Drills',  icon: <RotateCcw size={16} /> },
  { to: '/incidents', label: 'Incidents',       icon: <AlertTriangle size={16} />, badge: 2 },
];

const BOTTOM_ITEMS: NavItem[] = [
  { to: '/profile',   label: 'Profile',         icon: <User size={16} /> },
  { to: '/admin',     label: 'Admin',            icon: <Shield size={16} /> },
  { to: '/help',      label: 'Help & Docs',      icon: <HelpCircle size={16} /> },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
      isActive
        ? 'bg-sky-500/15 text-sky-400 border border-sky-500/20'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
    }`;

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-20 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={`
          fixed top-0 left-0 h-full w-60 bg-slate-900 border-r border-slate-800
          flex flex-col z-30 transition-transform duration-200
          ${open ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 lg:static lg:z-auto
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-sky-500/20 border border-sky-500/30 flex items-center justify-center">
              <Database size={14} className="text-sky-400" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-100">NAS Backup Buddy</div>
              <div className="text-xs text-slate-500">Alpha · Barter</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden text-slate-500 hover:text-slate-300 p-1"
            aria-label="Close menu"
          >
            <X size={16} />
          </button>
        </div>

        {/* Main nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={linkClass}
              onClick={onClose}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 text-xs flex items-center justify-center border border-amber-500/30">
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}

          <div className="my-3 border-t border-slate-800" />

          {BOTTOM_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={linkClass}
              onClick={onClose}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* User footer */}
        <div className="px-3 py-3 border-t border-slate-800">
          <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-md bg-slate-800/40">
            <div className="w-7 h-7 rounded-full bg-sky-500/20 border border-sky-500/30 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-semibold text-sky-400">
                {CURRENT_USER.name.split(' ').map((n) => n[0]).join('')}
              </span>
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-200 truncate">{CURRENT_USER.name}</div>
              <div className="text-xs text-slate-500 truncate">@{CURRENT_USER.handle}</div>
            </div>
            <div className="flex-shrink-0 w-2 h-2 rounded-full bg-emerald-400" title="Active" />
          </div>
          {/* Privacy notice */}
          <p className="text-xs text-slate-600 mt-2 px-1 leading-snug">
            Passwords &amp; keys are never collected.
          </p>
        </div>
      </aside>
    </>
  );
}
