import { createContext, useContext, useReducer, ReactNode } from 'react';
import {
  MATCHES,
  BACKUP_PACTS,
  RESTORE_DRILLS,
  INCIDENTS,
  MATCH_CANDIDATES,
  CURRENT_USER,
} from '../data/mockData';
import type {
  Match,
  BackupPact,
  RestoreDrill,
  Incident,
  IncidentStatus,
  MatchStatus,
  AdminLogEntry,
  AdminActionType,
} from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derive status from gate + health. Called after any state mutation. */
function deriveMatchStatus(m: Match): MatchStatus {
  if (m.status === 'Retired') return 'Retired';

  const g = m.gate;
  const h = m.health;

  const isCritical =
    !g.noCriticalAlerts ||
    h.lastBackupAgeHours > 72 ||
    h.lastSyncAgeHours > 72 ||
    h.freeQuotaPercent < 5 ||
    h.peerOfflineHours > 168 ||
    h.repositoryCheckStatus === 'failed';
  if (isCritical) return 'Critical';

  if (Object.values(g).every(Boolean)) return 'Protected';

  const isWarning =
    h.lastBackupAgeHours > 24 ||
    h.lastSyncAgeHours > 24 ||
    h.freeQuotaPercent < 15 ||
    h.restoreDrillAgeDays > 30 ||
    h.peerOfflineHours > 24;
  if (isWarning) return 'Warning';

  if (!m.pactAcceptedAt) return 'Pending';
  return 'Syncing';
}

// ─── State ────────────────────────────────────────────────────────────────────

export interface AppState {
  matches: Match[];
  pacts: BackupPact[];
  drills: RestoreDrill[];
  incidents: Incident[];
  adminLog: AdminLogEntry[];
  requestedCandidateIds: string[];
}

// Seed: bp-002 has storageHostAccepted=false so pact signing is reachable from the start.
const INITIAL_STATE: AppState = {
  matches: MATCHES,
  pacts: BACKUP_PACTS.map((p) =>
    p.id === 'bp-002'
      ? { ...p, storageHostAccepted: false, storageHostAcceptedAt: undefined }
      : p
  ),
  drills: RESTORE_DRILLS,
  incidents: INCIDENTS,
  adminLog: [],
  requestedCandidateIds: [],
};

// ─── Actions ──────────────────────────────────────────────────────────────────

type AppAction =
  | { type: 'RECORD_DRILL'; payload: Partial<RestoreDrill> & { matchId: string } }
  | { type: 'REQUEST_MATCH'; payload: { candidateProfileId: string; matchId: string; pactId: string } }
  | { type: 'ACCEPT_PACT'; payload: { pactId: string; role: 'owner' | 'host' } }
  | { type: 'UPDATE_INCIDENT_NOTES'; payload: { id: string; notes: string } }
  | { type: 'UPDATE_INCIDENT_STATUS'; payload: { id: string; status: IncidentStatus } }
  | { type: 'CREATE_INCIDENT'; payload: Incident }
  | { type: 'ADMIN_ACTION'; payload: { matchId: string; action: AdminActionType; note: string } };

// ─── Reducer ──────────────────────────────────────────────────────────────────

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {

    case 'RECORD_DRILL': {
      const p = action.payload;
      const checksumMismatch =
        !!p.canaryChecksumExpected &&
        !!p.canaryChecksumObserved &&
        p.canaryChecksumExpected.trim() !== p.canaryChecksumObserved.trim();
      const isDrillFail = p.status === 'Fail' || checksumMismatch;

      const newDrill: RestoreDrill = {
        ...p,
        id: `rd-${Date.now()}`,
        matchId: p.matchId,
        operatorName: CURRENT_USER.name,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: isDrillFail ? 'Fail' : p.status ?? 'Pass',
      };

      let extraIncidents = state.incidents;

      const updatedMatches = state.matches.map((m) => {
        if (m.id !== p.matchId) return m;

        if (isDrillFail) {
          const incident: Incident = {
            id: `inc-${Date.now()}`,
            matchId: p.matchId,
            severity: 'Critical',
            category: checksumMismatch ? 'Canary mismatch' : 'Restore failed',
            title: checksumMismatch
              ? 'Canary checksum mismatch — repository integrity at risk'
              : 'Restore drill failed — match is not Protected',
            description: checksumMismatch
              ? 'The canary checksum observed after restore did not match the expected value. ' +
                'Repository integrity may be compromised.'
              : 'A restore drill recorded a failure. The match cannot be marked Protected ' +
                'until a successful drill completes.',
            createdAt: new Date().toISOString(),
            status: 'Open',
            notes: '',
            requiredAction: checksumMismatch
              ? 'Mark unprotected. Preserve logs. Stop pruning. Test alternate snapshot.'
              : 'Mark unprotected. Stop pruning. Investigate repository and recovery keys.',
          };
          extraIncidents = [incident, ...state.incidents];

          return {
            ...m,
            status: 'Critical' as MatchStatus,
            gate: {
              ...m.gate,
              noCriticalAlerts: false,
              restoreDrillCompleted: false,
              ...(checksumMismatch ? { canaryChecksumMatches: false } : {}),
            },
          };
        }

        // Passing drill
        const newGate = {
          ...m.gate,
          restoreDrillCompleted: true,
          canaryChecksumMatches: true,
          noCriticalAlerts: true,
        };
        const updated = {
          ...m,
          health: { ...m.health, restoreDrillAgeDays: 0 },
          gate: newGate,
        };
        updated.status = deriveMatchStatus(updated);
        return updated;
      });

      return {
        ...state,
        drills: [newDrill, ...state.drills],
        matches: updatedMatches,
        incidents: extraIncidents,
      };
    }

    case 'REQUEST_MATCH': {
      const { candidateProfileId, matchId, pactId } = action.payload;
      const candidate = MATCH_CANDIDATES.find(
        (c) => c.profile.id === candidateProfileId
      );
      if (!candidate) return state;
      if (state.requestedCandidateIds.includes(candidateProfileId)) return state;

      const now = new Date().toISOString();

      const drillTarget = new Date(Date.now() + 7 * 86400_000)
        .toISOString()
        .split('T')[0];
      const reviewDate = new Date(Date.now() + 180 * 86400_000)
        .toISOString()
        .split('T')[0];
      const backupTarget = new Date(Date.now() + 3 * 86400_000)
        .toISOString()
        .split('T')[0];

      const newMatch: Match = {
        id: matchId,
        dataOwnerId: CURRENT_USER.id,
        storageHostId: candidateProfileId,
        status: 'Pending',
        createdAt: now,
        repositorySizeGB: 0,
        quotaUsedGB: 0,
        quotaTotalGB: candidate.profile.offeredStorageGB,
        score: candidate.score,
        health: {
          lastBackupAgeHours: 0,
          lastSyncAgeHours: 0,
          freeQuotaPercent: 100,
          restoreDrillAgeDays: -1,
          peerOfflineHours: 0,
          repositoryCheckStatus: 'ok',
        },
        gate: {
          backupSnapshotExists: false,
          encryptedRepoSyncedToPeer: false,
          restoreDrillCompleted: false,
          canaryChecksumMatches: false,
          userHasRecoveryKey: false,
          retentionPolicyConfigured: false,
          peerQuotaHasBuffer: true,
          noCriticalAlerts: true,
        },
        adminPaused: false,
        flagged: false,
      };

      const newPact: BackupPact = {
        id: pactId,
        matchId,
        dataOwnerId: CURRENT_USER.id,
        storageHostId: candidateProfileId,
        startDate: now.split('T')[0],
        reviewDate,
        offeredStorageGB: candidate.profile.offeredStorageGB,
        requestedStorageGB: CURRENT_USER.requestedStorageGB,
        quotaBufferGB: Math.round(candidate.profile.offeredStorageGB * 0.1),
        expectedMinUptimePercent: candidate.profile.expectedUptimePercent,
        expectedMonthlyBandwidthGB: candidate.profile.monthlyBandwidthCapGB,
        region: candidate.profile.region,
        retentionDaysAfterEnd: 30,
        initialBackupTargetDate: backupTarget,
        firstRestoreDrillTargetDate: drillTarget,
        restoreDrillFrequencyDays: 30,
        alertContactMethod: 'App notification',
        gracePeriodDays: 30,
        dataOwnerAccepted: false,
        storageHostAccepted: false,
      };

      return {
        ...state,
        matches: [...state.matches, newMatch],
        pacts: [...state.pacts, newPact],
        requestedCandidateIds: [
          ...state.requestedCandidateIds,
          candidateProfileId,
        ],
      };
    }

    case 'ACCEPT_PACT': {
      const { pactId, role } = action.payload;
      const now = new Date().toISOString();

      const updatedPacts = state.pacts.map((p) => {
        if (p.id !== pactId) return p;
        if (role === 'owner') {
          return { ...p, dataOwnerAccepted: true, dataOwnerAcceptedAt: now };
        }
        return { ...p, storageHostAccepted: true, storageHostAcceptedAt: now };
      });

      const updatedPact = updatedPacts.find((p) => p.id === pactId);
      let updatedMatches = state.matches;
      if (
        updatedPact &&
        updatedPact.dataOwnerAccepted &&
        updatedPact.storageHostAccepted
      ) {
        updatedMatches = state.matches.map((m) => {
          if (m.id !== updatedPact.matchId) return m;
          const updated = { ...m, pactAcceptedAt: now };
          updated.status = deriveMatchStatus(updated);
          return updated;
        });
      }

      return { ...state, pacts: updatedPacts, matches: updatedMatches };
    }

    case 'UPDATE_INCIDENT_NOTES':
      return {
        ...state,
        incidents: state.incidents.map((i) =>
          i.id === action.payload.id
            ? { ...i, notes: action.payload.notes }
            : i
        ),
      };

    case 'UPDATE_INCIDENT_STATUS':
      return {
        ...state,
        incidents: state.incidents.map((i) =>
          i.id === action.payload.id
            ? {
                ...i,
                status: action.payload.status,
                resolvedAt:
                  action.payload.status === 'Resolved'
                    ? new Date().toISOString()
                    : i.resolvedAt,
              }
            : i
        ),
      };

    case 'CREATE_INCIDENT':
      return {
        ...state,
        incidents: [action.payload, ...state.incidents],
      };

    case 'ADMIN_ACTION': {
      const { matchId, action: adminAction, note } = action.payload;
      const timestamp = new Date().toISOString();

      const updatedMatches = state.matches.map((m) => {
        if (m.id !== matchId) return m;
        switch (adminAction) {
          case 'pause':
            return { ...m, adminPaused: true, status: 'Warning' as MatchStatus, adminNotes: note };
          case 'resume': {
            const resumed = { ...m, adminPaused: false, adminNotes: note };
            resumed.status = deriveMatchStatus(resumed);
            return resumed;
          }
          case 'retire':
            return { ...m, status: 'Retired' as MatchStatus, adminNotes: note };
          case 'flag':
            return { ...m, flagged: true, adminNotes: note };
          case 'unflag':
            return { ...m, flagged: false, adminNotes: note };
        }
      });

      return {
        ...state,
        matches: updatedMatches,
        adminLog: [
          { type: adminAction, matchId, timestamp, note },
          ...state.adminLog,
        ],
      };
    }

    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface AppContextValue extends AppState {
  recordDrill: (drill: Partial<RestoreDrill> & { matchId: string }) => void;
  requestMatch: (candidateProfileId: string) => { matchId: string; pactId: string } | null;
  acceptPact: (pactId: string, role: 'owner' | 'host') => void;
  updateIncidentNotes: (id: string, notes: string) => void;
  updateIncidentStatus: (id: string, status: IncidentStatus) => void;
  createIncident: (inc: Incident) => void;
  adminAction: (matchId: string, action: AdminActionType, note: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  const requestMatch = (candidateProfileId: string) => {
    const candidate = MATCH_CANDIDATES.find(
      (c) => c.profile.id === candidateProfileId
    );
    if (!candidate || state.requestedCandidateIds.includes(candidateProfileId))
      return null;
    // Generate IDs here and pass into the reducer so both sides use the same values.
    const now = Date.now();
    const matchId = `m-${now}`;
    const pactId  = `bp-${now}`;
    dispatch({ type: 'REQUEST_MATCH', payload: { candidateProfileId, matchId, pactId } });
    return { matchId, pactId };
  };

  const value: AppContextValue = {
    ...state,
    recordDrill: (drill) => dispatch({ type: 'RECORD_DRILL', payload: drill }),
    requestMatch,
    acceptPact: (pactId, role) =>
      dispatch({ type: 'ACCEPT_PACT', payload: { pactId, role } }),
    updateIncidentNotes: (id, notes) =>
      dispatch({ type: 'UPDATE_INCIDENT_NOTES', payload: { id, notes } }),
    updateIncidentStatus: (id, status) =>
      dispatch({ type: 'UPDATE_INCIDENT_STATUS', payload: { id, status } }),
    createIncident: (inc) =>
      dispatch({ type: 'CREATE_INCIDENT', payload: inc }),
    adminAction: (matchId, action, note) =>
      dispatch({ type: 'ADMIN_ACTION', payload: { matchId, action, note } }),
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
