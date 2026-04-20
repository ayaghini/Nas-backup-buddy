# NAS Backup Buddy — Web App

Operational dashboard and coordination UI for the NAS Backup Buddy homelab backup exchange.

## Stack

- **Vite 5** + **React 18** + **TypeScript**
- **Tailwind CSS** for styling
- **React Router v6** for navigation
- **Lucide React** for icons
- Local mock data only — no backend required

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Other scripts

```bash
npm run build      # Production build → dist/
npm run typecheck  # TypeScript check only (no emit)
npm run preview    # Preview the production build locally
```

## Views

| Route | View |
| --- | --- |
| `/` | Dashboard — health summary, active matches, required actions, open incidents |
| `/matches` | Match Finder — browse and filter candidates, view score breakdowns |
| `/matches/:id` | Match Detail — peer profile, gate checks, health, score, pact link |
| `/pact/:matchId` | Backup Pact — pact terms, security agreement, accept/sign flow |
| `/health` | Health Checks — per-match live metrics + Protected gate status |
| `/restore` | Restore Drills — drill history, new drill form with audit evidence |
| `/incidents` | Incidents — create, update, filter, resolve incidents |
| `/profile` | Profile — edit storage profile, all match-scoring fields |
| `/admin` | Admin — pause, retire, flag matches; audit log |
| `/help` | Help & Docs — architecture, rules, scoring matrix, risk register |

## Source layout

```
src/
  types/index.ts        TypeScript interfaces for all domain objects
  data/mockData.ts      Realistic mock users, matches, drills, incidents, pacts
  components/
    Layout.tsx          Sidebar + top bar shell
    Sidebar.tsx         Navigation sidebar
    StatusPill.tsx      Coloured status badges (match, incident, drill, check)
    ScoreBar.tsx        Match score breakdown visualisation
    HealthCheckRow.tsx  Health check rows with warning/critical thresholds
  views/                One file per route (see table above)
  App.tsx               React Router route tree
  main.tsx              Entry point
```

## Product constraints

This app implements the alpha scope from `docs/implementation-map.md`:

- **No payment features.** Paid marketplace is blocked until controls defined in Phase 6 are in place.
- **No backup passwords or keys collected.** The platform handles metadata only.
- **Not a guaranteed cloud-backup service.** The UI communicates this explicitly.
- Syncthing is treated as transport; Kopia/restic as the backup engine.
