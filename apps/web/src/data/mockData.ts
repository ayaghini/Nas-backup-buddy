import type {
  UserProfile,
  Match,
  RestoreDrill,
  Incident,
  BackupPact,
  MatchCandidate,
} from '../types';

// ─── Current User ─────────────────────────────────────────────────────────────

export const CURRENT_USER: UserProfile = {
  id: 'u-001',
  name: 'Alex Yaghini',
  handle: 'ayaghini',
  region: 'Europe',
  country: 'United Kingdom',
  timezone: 'Europe/London',
  offeredStorageGB: 2048,
  requestedStorageGB: 1024,
  uploadSpeedMbps: 100,
  downloadSpeedMbps: 300,
  monthlyBandwidthCapGB: 0, // unlimited
  expectedUptimePercent: 99,
  nasServerType: 'Unraid',
  filesystem: 'ZFS',
  hasPowerBackup: true,
  willingToHostMultiple: true,
  reputation: 88,
  joinedAt: '2024-11-01',
  backupEngine: 'Kopia',
  isCurrentUser: true,
};

// ─── All Known Users ──────────────────────────────────────────────────────────

export const USERS: UserProfile[] = [
  CURRENT_USER,
  {
    id: 'u-002',
    name: 'Jordan Chen',
    handle: 'jchen',
    region: 'Asia Pacific',
    country: 'Hong Kong',
    timezone: 'Asia/Hong_Kong',
    offeredStorageGB: 4096,
    requestedStorageGB: 2048,
    uploadSpeedMbps: 500,
    downloadSpeedMbps: 500,
    monthlyBandwidthCapGB: 0,
    expectedUptimePercent: 99.5,
    nasServerType: 'TrueNAS SCALE',
    filesystem: 'ZFS',
    hasPowerBackup: true,
    willingToHostMultiple: true,
    reputation: 94,
    joinedAt: '2024-10-15',
    backupEngine: 'Kopia',
  },
  {
    id: 'u-003',
    name: 'Marcus Thompson',
    handle: 'mthompson',
    region: 'North America',
    country: 'United States',
    timezone: 'America/Los_Angeles',
    offeredStorageGB: 1024,
    requestedStorageGB: 512,
    uploadSpeedMbps: 35,
    downloadSpeedMbps: 200,
    monthlyBandwidthCapGB: 2000,
    expectedUptimePercent: 95,
    nasServerType: 'Synology DS923+',
    filesystem: 'Btrfs',
    hasPowerBackup: false,
    willingToHostMultiple: false,
    reputation: 72,
    joinedAt: '2024-12-01',
    backupEngine: 'restic',
  },
  {
    id: 'u-004',
    name: 'Priya Nair',
    handle: 'pnair',
    region: 'Asia Pacific',
    country: 'India',
    timezone: 'Asia/Kolkata',
    offeredStorageGB: 3072,
    requestedStorageGB: 1024,
    uploadSpeedMbps: 100,
    downloadSpeedMbps: 200,
    monthlyBandwidthCapGB: 0,
    expectedUptimePercent: 98,
    nasServerType: 'Proxmox',
    filesystem: 'ZFS',
    hasPowerBackup: true,
    willingToHostMultiple: true,
    reputation: 91,
    joinedAt: '2024-09-20',
    backupEngine: 'Kopia',
  },
  {
    id: 'u-005',
    name: 'Lars Eriksson',
    handle: 'leriksso',
    region: 'Europe',
    country: 'Sweden',
    timezone: 'Europe/Stockholm',
    offeredStorageGB: 8192,
    requestedStorageGB: 2048,
    uploadSpeedMbps: 1000,
    downloadSpeedMbps: 1000,
    monthlyBandwidthCapGB: 0,
    expectedUptimePercent: 99.9,
    nasServerType: 'Custom Proxmox Cluster',
    filesystem: 'ZFS',
    hasPowerBackup: true,
    willingToHostMultiple: true,
    reputation: 97,
    joinedAt: '2024-08-05',
    backupEngine: 'Kopia',
  },
  {
    id: 'u-006',
    name: 'Amira Osei',
    handle: 'aosei',
    region: 'Europe',
    country: 'Germany',
    timezone: 'Europe/Berlin',
    offeredStorageGB: 2048,
    requestedStorageGB: 1024,
    uploadSpeedMbps: 250,
    downloadSpeedMbps: 250,
    monthlyBandwidthCapGB: 0,
    expectedUptimePercent: 98.5,
    nasServerType: 'TrueNAS Core',
    filesystem: 'ZFS',
    hasPowerBackup: true,
    willingToHostMultiple: false,
    reputation: 89,
    joinedAt: '2024-10-28',
    backupEngine: 'restic',
  },
  {
    id: 'u-007',
    name: 'Tomás Varga',
    handle: 'tvarga',
    region: 'Europe',
    country: 'Czech Republic',
    timezone: 'Europe/Prague',
    offeredStorageGB: 1024,
    requestedStorageGB: 512,
    uploadSpeedMbps: 50,
    downloadSpeedMbps: 100,
    monthlyBandwidthCapGB: 3000,
    expectedUptimePercent: 96,
    nasServerType: 'OMV (OpenMediaVault)',
    filesystem: 'ext4',
    hasPowerBackup: false,
    willingToHostMultiple: false,
    reputation: 78,
    joinedAt: '2025-01-10',
    backupEngine: 'restic',
  },
  {
    id: 'u-008',
    name: 'Nadia Kowalski',
    handle: 'nkowalsk',
    region: 'Europe',
    country: 'Poland',
    timezone: 'Europe/Warsaw',
    offeredStorageGB: 4096,
    requestedStorageGB: 2048,
    uploadSpeedMbps: 300,
    downloadSpeedMbps: 600,
    monthlyBandwidthCapGB: 0,
    expectedUptimePercent: 99,
    nasServerType: 'Unraid',
    filesystem: 'XFS',
    hasPowerBackup: true,
    willingToHostMultiple: true,
    reputation: 86,
    joinedAt: '2024-11-15',
    backupEngine: 'Kopia',
  },
  {
    id: 'u-009',
    name: 'Kenji Watanabe',
    handle: 'kwatan',
    region: 'Asia Pacific',
    country: 'Japan',
    timezone: 'Asia/Tokyo',
    offeredStorageGB: 6144,
    requestedStorageGB: 1024,
    uploadSpeedMbps: 600,
    downloadSpeedMbps: 600,
    monthlyBandwidthCapGB: 0,
    expectedUptimePercent: 99.8,
    nasServerType: 'TrueNAS SCALE',
    filesystem: 'ZFS',
    hasPowerBackup: true,
    willingToHostMultiple: true,
    reputation: 95,
    joinedAt: '2024-07-12',
    backupEngine: 'Kopia',
  },
  {
    id: 'u-010',
    name: 'Fatima Al-Rashid',
    handle: 'falrash',
    region: 'Middle East',
    country: 'UAE',
    timezone: 'Asia/Dubai',
    offeredStorageGB: 2048,
    requestedStorageGB: 512,
    uploadSpeedMbps: 100,
    downloadSpeedMbps: 100,
    monthlyBandwidthCapGB: 5000,
    expectedUptimePercent: 97,
    nasServerType: 'Synology DS923+',
    filesystem: 'Btrfs',
    hasPowerBackup: false,
    willingToHostMultiple: false,
    reputation: 80,
    joinedAt: '2025-02-01',
    backupEngine: 'restic',
  },
  {
    id: 'u-011',
    name: 'Diego Herrera',
    handle: 'dherrera',
    region: 'South America',
    country: 'Brazil',
    timezone: 'America/Sao_Paulo',
    offeredStorageGB: 1024,
    requestedStorageGB: 1024,
    uploadSpeedMbps: 60,
    downloadSpeedMbps: 120,
    monthlyBandwidthCapGB: 4000,
    expectedUptimePercent: 94,
    nasServerType: 'OMV (OpenMediaVault)',
    filesystem: 'ext4',
    hasPowerBackup: false,
    willingToHostMultiple: true,
    reputation: 74,
    joinedAt: '2025-01-25',
    backupEngine: 'restic',
  },
];

// ─── Active Matches ───────────────────────────────────────────────────────────

export const MATCHES: Match[] = [
  {
    id: 'm-001',
    dataOwnerId: 'u-001',
    storageHostId: 'u-002',
    status: 'Protected',
    createdAt: '2024-11-20T10:00:00Z',
    pactAcceptedAt: '2024-11-22T14:30:00Z',
    lastBackupAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    lastSyncAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    repositorySizeGB: 187.4,
    quotaUsedGB: 187.4,
    quotaTotalGB: 2048,
    score: {
      storageFit: 23,
      uploadSpeed: 18,
      uptime: 19,
      regionDistance: 6,
      reputation: 14,
      reciprocalFairness: 9,
      total: 89,
    },
    health: {
      lastBackupAgeHours: 2,
      lastSyncAgeHours: 3,
      freeQuotaPercent: 90.8,
      restoreDrillAgeDays: 15,
      peerOfflineHours: 0,
      repositoryCheckStatus: 'ok',
    },
    gate: {
      backupSnapshotExists: true,
      encryptedRepoSyncedToPeer: true,
      restoreDrillCompleted: true,
      canaryChecksumMatches: true,
      userHasRecoveryKey: true,
      retentionPolicyConfigured: true,
      peerQuotaHasBuffer: true,
      noCriticalAlerts: true,
    },
    adminPaused: false,
  },
  {
    id: 'm-002',
    dataOwnerId: 'u-001',
    storageHostId: 'u-003',
    status: 'Warning',
    createdAt: '2024-12-10T09:00:00Z',
    pactAcceptedAt: '2024-12-12T11:00:00Z',
    lastBackupAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
    lastSyncAt: new Date(Date.now() - 28 * 3600 * 1000).toISOString(),
    repositorySizeGB: 44.1,
    quotaUsedGB: 44.1,
    quotaTotalGB: 512,
    score: {
      storageFit: 14,
      uploadSpeed: 9,
      uptime: 14,
      regionDistance: 7,
      reputation: 11,
      reciprocalFairness: 7,
      total: 62,
    },
    health: {
      lastBackupAgeHours: 26,
      lastSyncAgeHours: 28,
      freeQuotaPercent: 91.4,
      restoreDrillAgeDays: 35,
      peerOfflineHours: 0,
      repositoryCheckStatus: 'ok',
    },
    gate: {
      backupSnapshotExists: true,
      encryptedRepoSyncedToPeer: true,
      restoreDrillCompleted: true,
      canaryChecksumMatches: true,
      userHasRecoveryKey: true,
      retentionPolicyConfigured: true,
      peerQuotaHasBuffer: true,
      noCriticalAlerts: false, // warning state blocks Protected
    },
    adminPaused: false,
  },
];

// ─── Restore Drills ───────────────────────────────────────────────────────────

export const RESTORE_DRILLS: RestoreDrill[] = [
  {
    id: 'rd-001',
    matchId: 'm-001',
    operatorName: 'Alex Yaghini',
    startedAt: new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 15 * 24 * 3600 * 1000 + 1800 * 1000).toISOString(),
    status: 'Pass',
    backupSnapshot: 'kopia:snap-2025-04-03T09:14:22Z',
    canaryChecksumExpected: 'sha256:a3f1bc29...d94e',
    canaryChecksumObserved: 'sha256:a3f1bc29...d94e',
    restoreDestination: '/tmp/restore-test-2025-04-03',
    repositorySizeGB: 178.2,
    toolVersions: 'Kopia 0.17.0 / Syncthing 1.27.7',
    restoreDurationSecs: 1740,
    warnings: 'None.',
    followUp: 'None required.',
  },
  {
    id: 'rd-002',
    matchId: 'm-001',
    operatorName: 'Alex Yaghini',
    startedAt: new Date(Date.now() - 46 * 24 * 3600 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 46 * 24 * 3600 * 1000 + 2100 * 1000).toISOString(),
    status: 'Pass',
    backupSnapshot: 'kopia:snap-2025-03-03T08:55:10Z',
    canaryChecksumExpected: 'sha256:7c2d4a11...88fb',
    canaryChecksumObserved: 'sha256:7c2d4a11...88fb',
    restoreDestination: '/tmp/restore-test-2025-03-03',
    repositorySizeGB: 161.5,
    toolVersions: 'Kopia 0.17.0 / Syncthing 1.27.6',
    restoreDurationSecs: 2095,
    warnings: 'Restore was slower than expected. Peer upload was throttled.',
    followUp: 'Discussed bandwidth expectations with Jordan. Will monitor next drill.',
  },
  {
    id: 'rd-003',
    matchId: 'm-002',
    operatorName: 'Alex Yaghini',
    startedAt: new Date(Date.now() - 35 * 24 * 3600 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 35 * 24 * 3600 * 1000 + 3600 * 1000).toISOString(),
    status: 'Pass',
    backupSnapshot: 'restic:snap/a1b2c3d4',
    canaryChecksumExpected: 'sha256:cc3e9f01...a122',
    canaryChecksumObserved: 'sha256:cc3e9f01...a122',
    restoreDestination: '/tmp/restore-marcus-2025-03-14',
    repositorySizeGB: 38.7,
    toolVersions: 'restic 0.16.5 / Syncthing 1.27.6',
    restoreDurationSecs: 3580,
    warnings: 'Restore was slow — Marcus has 35 Mbps upload. Estimate ~45 min for full restore at current repo size.',
    followUp: 'Flag bandwidth concern. Match score already reflects this.',
  },
];

// ─── Incidents ────────────────────────────────────────────────────────────────

export const INCIDENTS: Incident[] = [
  {
    id: 'inc-001',
    matchId: 'm-002',
    severity: 'High',
    category: 'Sync stale',
    title: 'Sync stale > 24h on match m-002',
    description:
      'Syncthing sync to Marcus Thompson (u-003) has not completed in over 26 hours. Last confirmed sync was 28 hours ago.',
    createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    status: 'Open',
    notes: 'Checked Syncthing logs — Marcus\' peer was offline. Waiting for him to reconnect.',
    requiredAction: 'Monitor peer reconnect. If offline > 48h total, escalate to Critical.',
  },
  {
    id: 'inc-002',
    matchId: 'm-002',
    severity: 'Medium',
    category: 'Restore drill overdue',
    title: 'Restore drill overdue (35 days) for match m-002',
    description:
      'Restore drill for the Marcus Thompson match is 35 days old — 5 days past the 30-day warning threshold.',
    createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
    status: 'Open',
    notes: 'Scheduled drill for next available window. Waiting on sync to stabilise first.',
    requiredAction: 'Complete restore drill within 7 days to maintain Protected eligibility.',
  },
  {
    id: 'inc-003',
    matchId: 'm-001',
    severity: 'Medium',
    category: 'Sync stale',
    title: 'Sync delay during Jordan\'s router maintenance',
    description:
      'Syncthing sync was delayed for approximately 6 hours while Jordan performed scheduled router maintenance on 2025-04-10.',
    createdAt: '2025-04-10T02:00:00Z',
    resolvedAt: '2025-04-10T08:45:00Z',
    status: 'Resolved',
    notes: 'Jordan notified in advance. Sync resumed normally after maintenance window. No data loss.',
    requiredAction: 'None — resolved.',
  },
  {
    id: 'inc-004',
    matchId: 'm-001',
    severity: 'Low',
    category: 'Backup stale',
    title: 'Backup agent missed scheduled run (2025-03-28)',
    description:
      'Kopia backup agent did not run at scheduled time due to a local machine sleep state. Backup was 18 hours late.',
    createdAt: '2025-03-28T22:00:00Z',
    resolvedAt: '2025-03-29T08:30:00Z',
    status: 'Resolved',
    notes:
      'Root cause: machine sleep was not disabled correctly. Fixed power settings. No snapshots were missed overall.',
    requiredAction: 'None — resolved. Updated sleep policy documentation.',
  },
];

// ─── Backup Pacts ─────────────────────────────────────────────────────────────

export const BACKUP_PACTS: BackupPact[] = [
  {
    id: 'bp-001',
    matchId: 'm-001',
    dataOwnerId: 'u-001',
    storageHostId: 'u-002',
    startDate: '2024-11-22',
    reviewDate: '2025-05-22',
    offeredStorageGB: 2048,
    requestedStorageGB: 2048,
    quotaBufferGB: 200,
    expectedMinUptimePercent: 99,
    expectedMonthlyBandwidthGB: 0,
    region: 'Asia Pacific',
    retentionDaysAfterEnd: 30,
    initialBackupTargetDate: '2024-11-25',
    firstRestoreDrillTargetDate: '2024-12-05',
    restoreDrillFrequencyDays: 30,
    alertContactMethod: 'Signal / app notification',
    gracePeriodDays: 30,
    dataOwnerAccepted: true,
    storageHostAccepted: true,
    dataOwnerAcceptedAt: '2024-11-22T14:30:00Z',
    storageHostAcceptedAt: '2024-11-22T14:32:00Z',
  },
  {
    id: 'bp-002',
    matchId: 'm-002',
    dataOwnerId: 'u-001',
    storageHostId: 'u-003',
    startDate: '2024-12-12',
    reviewDate: '2025-06-12',
    offeredStorageGB: 512,
    requestedStorageGB: 512,
    quotaBufferGB: 50,
    expectedMinUptimePercent: 95,
    expectedMonthlyBandwidthGB: 2000,
    region: 'North America',
    retentionDaysAfterEnd: 14,
    initialBackupTargetDate: '2024-12-15',
    firstRestoreDrillTargetDate: '2024-12-22',
    restoreDrillFrequencyDays: 30,
    alertContactMethod: 'Email',
    gracePeriodDays: 14,
    dataOwnerAccepted: true,
    storageHostAccepted: true,
    dataOwnerAcceptedAt: '2024-12-12T11:00:00Z',
    storageHostAcceptedAt: '2024-12-12T11:05:00Z',
  },
];

// ─── Match Candidates (potential new matches) ─────────────────────────────────

export const MATCH_CANDIDATES: MatchCandidate[] = [
  {
    profile: USERS[4], // Lars Eriksson
    score: {
      storageFit: 25,
      uploadSpeed: 20,
      uptime: 20,
      regionDistance: 9,
      reputation: 15,
      reciprocalFairness: 8,
      total: 97,
    },
    estimatedRestoreTimeMins: 18,
  },
  {
    profile: USERS[5], // Amira Osei
    score: {
      storageFit: 23,
      uploadSpeed: 17,
      uptime: 19,
      regionDistance: 9,
      reputation: 13,
      reciprocalFairness: 9,
      total: 90,
    },
    estimatedRestoreTimeMins: 42,
  },
  {
    profile: USERS[7], // Nadia Kowalski
    score: {
      storageFit: 24,
      uploadSpeed: 18,
      uptime: 19,
      regionDistance: 8,
      reputation: 13,
      reciprocalFairness: 9,
      total: 91,
    },
    estimatedRestoreTimeMins: 35,
  },
  {
    profile: USERS[3], // Priya Nair
    score: {
      storageFit: 22,
      uploadSpeed: 16,
      uptime: 18,
      regionDistance: 6,
      reputation: 14,
      reciprocalFairness: 8,
      total: 84,
    },
    estimatedRestoreTimeMins: 105,
  },
  {
    profile: USERS[8], // Kenji Watanabe
    score: {
      storageFit: 24,
      uploadSpeed: 20,
      uptime: 20,
      regionDistance: 5,
      reputation: 14,
      reciprocalFairness: 7,
      total: 90,
    },
    estimatedRestoreTimeMins: 22,
  },
  {
    profile: USERS[6], // Tomás Varga
    score: {
      storageFit: 13,
      uploadSpeed: 10,
      uptime: 14,
      regionDistance: 9,
      reputation: 12,
      reciprocalFairness: 7,
      total: 65,
    },
    estimatedRestoreTimeMins: 215,
  },
  {
    profile: USERS[9], // Fatima Al-Rashid
    score: {
      storageFit: 18,
      uploadSpeed: 13,
      uptime: 16,
      regionDistance: 7,
      reputation: 12,
      reciprocalFairness: 6,
      total: 72,
    },
    estimatedRestoreTimeMins: 110,
  },
  {
    profile: USERS[10], // Diego Herrera
    score: {
      storageFit: 12,
      uploadSpeed: 10,
      uptime: 13,
      regionDistance: 4,
      reputation: 11,
      reciprocalFairness: 8,
      total: 58,
    },
    estimatedRestoreTimeMins: 195,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getUserById(id: string): UserProfile | undefined {
  return USERS.find((u) => u.id === id);
}

export function getPactForMatch(matchId: string): BackupPact | undefined {
  return BACKUP_PACTS.find((p) => p.matchId === matchId);
}

export function getDrillsForMatch(matchId: string): RestoreDrill[] {
  return RESTORE_DRILLS.filter((d) => d.matchId === matchId);
}

export function getIncidentsForMatch(matchId: string): Incident[] {
  return INCIDENTS.filter((i) => i.matchId === matchId);
}

export function formatStorageGB(gb: number): string {
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`;
  return `${gb} GB`;
}

export function formatHoursAgo(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
