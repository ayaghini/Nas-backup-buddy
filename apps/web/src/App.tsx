import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { Layout } from './components/Layout';
import { Dashboard }     from './views/Dashboard';
import { MatchFinder }   from './views/MatchFinder';
import { MatchDetail }   from './views/MatchDetail';
import { BackupPact }    from './views/BackupPact';
import { HealthChecks }  from './views/HealthChecks';
import { RestoreDrills } from './views/RestoreDrill';
import { Incidents }     from './views/Incidents';
import { Profile }       from './views/Profile';
import { Admin }         from './views/Admin';
import { Help }          from './views/Help';

export function App() {
  return (
    <AppProvider>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index            element={<Dashboard />} />
          <Route path="matches"   element={<MatchFinder />} />
          <Route path="matches/:id" element={<MatchDetail />} />
          <Route path="pact/:matchId" element={<BackupPact />} />
          <Route path="health"    element={<HealthChecks />} />
          <Route path="restore"   element={<RestoreDrills />} />
          <Route path="incidents" element={<Incidents />} />
          <Route path="profile"   element={<Profile />} />
          <Route path="admin"     element={<Admin />} />
          <Route path="help"      element={<Help />} />
          <Route path="*"         element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </AppProvider>
  );
}

function NotFound() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="text-4xl font-mono text-slate-600 mb-3">404</div>
        <p className="text-sm text-slate-400">Page not found.</p>
      </div>
    </div>
  );
}
