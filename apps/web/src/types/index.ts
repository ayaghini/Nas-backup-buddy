// ─── Match & Health Status ────────────────────────────────────────────────────

export type MatchStatus =
  | 'Pending'
  | 'Syncing'
  | 'Protected'
  | 'Warning'
  | 'Critical'
  | 'Retired';

export type IncidentSeverity = 'Critical' | 'High' | 'Medium' | 'Low';
export type IncidentStatus = 'Open' | 'Monitoring' | 'Resolved';
export type DrillStatus = 'Pass' | 'Fail' | 'Pending' | 'In Progress';
export type RepoCheckStatus = 'ok' | 'warning' | 'failed';

// ─── User Profile ─────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  name: string;
  handle: string;
  region: string;
  country: string;
  timezone: string;
  offeredStorageGB: number;
  requestedStorageGB: number;
  uploadSpeedMbps: number;
  downloadSpeedMbps: number;
  monthlyBandwidthCapGB: number;
  expectedUptimePercent: number;
  nasServerType: string;
  filesystem: string;
  hasPowerBackup: boolean;
  willingToHostMultiple: boolean;
  reputation: number; // 0–100
  joinedAt: string;   // ISO date
  backupEngine: string;
  isCurrentUser?: boolean;
}

// ─── Match Scoring ────────────────────────────────────────────────────────────
// Weights per implementation-map.md:
//   storageFit=25, uploadSpeed=20, uptime=20,
//   regionDistance=10, reputation=15, reciprocalFairness=10

export interface MatchScore {
  storageFit: number;          // max 25
  uploadSpeed: number;         // max 20
  uptime: number;              // max 20
  regionDistance: number;      // max 10
  reputation: number;          // max 15
  reciprocalFairness: number;  // max 10
  total: number;               // max 100
}

// ─── Health Checks ────────────────────────────────────────────────────────────

export interface HealthCheckData {
  lastBackupAgeHours: number;
  lastSyncAgeHours: number;
  freeQuotaPercent: number;
  restoreDrillAgeDays: number;
  peerOfflineHours: number;
  repositoryCheckStatus: RepoCheckStatus;
  repositoryCheckMessage?: string;
}

// ─── Protected Status Gate ────────────────────────────────────────────────────
// All 8 must pass — from docs/control-and-audit-plan.md

export interface ProtectedGateChecks {
  backupSnapshotExists: boolean;
  encryptedRepoSyncedToPeer: boolean;
  restoreDrillCompleted: boolean;
  canaryChecksumMatches: boolean;
  userHasRecoveryKey: boolean;
  retentionPolicyConfigured: boolean;
  peerQuotaHasBuffer: boolean;
  noCriticalAlerts: boolean;
}

// ─── Match ────────────────────────────────────────────────────────────────────

export interface Match {
  id: string;
  dataOwnerId: string;
  storageHostId: string;
  status: MatchStatus;
  createdAt: string;
  pactAcceptedAt?: string;
  lastBackupAt?: string;
  lastSyncAt?: string;
  repositorySizeGB: number;
  quotaUsedGB: number;
  quotaTotalGB: number;
  score: MatchScore;
  health: HealthCheckData;
  gate: ProtectedGateChecks;
  adminPaused: boolean;
  adminNotes?: string;
  flagged?: boolean;
}

// ─── Admin Audit Log ──────────────────────────────────────────────────────────

export type AdminActionType = 'pause' | 'resume' | 'retire' | 'flag' | 'unflag';

export interface AdminLogEntry {
  type: AdminActionType;
  matchId: string;
  timestamp: string;
  note: string;
}

// ─── Restore Drill ────────────────────────────────────────────────────────────

export interface RestoreDrill {
  id: string;
  matchId: string;
  operatorName: string;
  startedAt: string;
  completedAt?: string;
  status: DrillStatus;
  backupSnapshot?: string;
  canaryChecksumExpected?: string;
  canaryChecksumObserved?: string;
  restoreDestination?: string;
  repositorySizeGB?: number;
  toolVersions?: string;
  restoreDurationSecs?: number;
  warnings?: string;
  followUp?: string;
}

// ─── Incident ─────────────────────────────────────────────────────────────────

export interface Incident {
  id: string;
  matchId: string;
  severity: IncidentSeverity;
  category: string;
  title: string;
  description: string;
  createdAt: string;
  resolvedAt?: string;
  status: IncidentStatus;
  notes: string;
  requiredAction?: string;
}

// ─── Backup Pact ──────────────────────────────────────────────────────────────

export interface BackupPact {
  id: string;
  matchId: string;
  dataOwnerId: string;
  storageHostId: string;
  startDate: string;
  reviewDate: string;
  offeredStorageGB: number;
  requestedStorageGB: number;
  quotaBufferGB: number;
  expectedMinUptimePercent: number;
  expectedMonthlyBandwidthGB: number;
  region: string;
  retentionDaysAfterEnd: number;
  initialBackupTargetDate: string;
  firstRestoreDrillTargetDate: string;
  restoreDrillFrequencyDays: number;
  alertContactMethod: string;
  gracePeriodDays: number;
  dataOwnerAccepted: boolean;
  storageHostAccepted: boolean;
  dataOwnerAcceptedAt?: string;
  storageHostAcceptedAt?: string;
}

// ─── Match Candidate ─────────────────────────────────────────────────────────

export interface MatchCandidate {
  profile: UserProfile;
  score: MatchScore;
  estimatedRestoreTimeMins: number;
}
