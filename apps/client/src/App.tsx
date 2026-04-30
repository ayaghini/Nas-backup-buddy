import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { AppContextProvider } from './context/AppContext';
import {
  Activity,
  Archive,
  BookOpen,
  FlaskConical,
  HardDrive,
  KeyRound,
  Network,
  RotateCcw,
  Server,
  Settings,
  Shield,
  Sliders,
  Terminal,
  Wand2,
} from 'lucide-react';
import { Dashboard }           from './views/Dashboard';
import { SetupWizard }         from './views/SetupWizard';
import { BackupPlan }          from './views/BackupPlan';
import { Peer }               from './views/Peer';
import { RestoreDrill }        from './views/RestoreDrill';
import { HealthChecks }        from './views/HealthChecks';
import { Logs }                from './views/Logs';
import { SettingsView }        from './views/Settings';
import { About }               from './views/About';
import { TestLab }             from './views/TestLab';
import { RecoveryKey }         from './views/RecoveryKey';
import { Host }                from './views/Host';

const NAV = [
  { to: '/',             icon: <Activity size={16} />,     label: 'Dashboard'          },
  { to: '/setup',        icon: <Wand2 size={16} />,        label: 'Setup Wizard'       },
  { to: '/backup',       icon: <HardDrive size={16} />,    label: 'Backup Plan'        },
  { to: '/host',         icon: <Server size={16} />,       label: 'Host'               },
  { to: '/peer',         icon: <Network size={16} />,       label: 'Peer'               },
  { to: '/drills',       icon: <RotateCcw size={16} />,    label: 'Restore Drill'      },
  { to: '/health',       icon: <Shield size={16} />,       label: 'Health Checks'      },
  { to: '/recovery',     icon: <KeyRound size={16} />,     label: 'Recovery Key'       },
  { to: '/test-lab',     icon: <FlaskConical size={16} />, label: 'Test Lab'           },
  { to: '/logs',         icon: <Terminal size={16} />,     label: 'Logs'               },
  { to: '/settings',     icon: <Settings size={16} />,     label: 'Settings'           },
  { to: '/about',        icon: <BookOpen size={16} />,     label: 'About'              },
];

export function App() {
  return (
    <AppContextProvider>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="flex h-screen overflow-hidden bg-slate-950">
        {/* Sidebar */}
        <nav className="w-52 flex-shrink-0 border-r border-slate-800 flex flex-col">
          <div className="px-4 py-4 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Archive size={16} className="text-sky-400" />
              <span className="text-sm font-semibold text-slate-100">NAS Backup Buddy</span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5 ml-6">v0.1.0 · alpha</div>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {NAV.map(({ to, icon, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${
                    isActive
                      ? 'text-sky-400 bg-sky-500/10'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`
                }
              >
                <span className="flex-shrink-0">{icon}</span>
                {label}
              </NavLink>
            ))}
          </div>
          <div className="px-4 py-3 border-t border-slate-800">
            <div className="flex items-center gap-2">
              <Sliders size={13} className="text-slate-500" />
              <span className="text-xs text-slate-500">Offline mode</span>
            </div>
          </div>
        </nav>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/"             element={<Dashboard />} />
            <Route path="/setup"        element={<SetupWizard />} />
            <Route path="/backup"       element={<BackupPlan />} />
            <Route path="/host"         element={<Host />} />
            <Route path="/host-setup"   element={<Navigate to="/host" replace />} />
            <Route path="/peer"         element={<Peer />} />
            <Route path="/peer-connection" element={<Navigate to="/peer" replace />} />
            <Route path="/peer-storage" element={<Navigate to="/peer" replace />} />
            <Route path="/overlay"      element={<Navigate to="/peer" replace />} />
            <Route path="/syncthing"    element={<Navigate to="/peer" replace />} />
            <Route path="/drills"       element={<RestoreDrill />} />
            <Route path="/health"       element={<HealthChecks />} />
            <Route path="/recovery"     element={<RecoveryKey />} />
            <Route path="/test-lab"     element={<TestLab />} />
            <Route path="/logs"         element={<Logs />} />
            <Route path="/settings"     element={<SettingsView />} />
            <Route path="/about"        element={<About />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
    </AppContextProvider>
  );
}
