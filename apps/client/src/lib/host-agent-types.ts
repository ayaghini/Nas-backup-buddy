// TypeScript types for the NAS Backup Buddy host-agent REST API.
// Mirrors the API contract in docs/host-agent/api-contract.md.

export type AllocState =
  | 'DRAFT'
  | 'PENDING_KEY'
  | 'READY'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'RETIRING'
  | 'RETIRED';

export type QuotaState = 'ok' | 'warning' | 'critical';
export type QuotaMode = 'soft';

export type ReachabilityClass =
  | 'overlay_ready'
  | 'local_test_only'
  | 'advertised_blocked'
  | 'unsafe_public'
  | 'unknown';

// ── API response types ────────────────────────────────────────────────────────

export interface HostAgentInfo {
  version: string;
  ready: boolean;
}

export interface HostAgentStatus {
  agentVersion: string;
  startedAt: string;
  configLoaded: boolean;
  allocationCount: number;
  readyCount: number;
  storageRoot: string;
  storageAvailableBytes: number;
  storageTotalBytes: number;
}

export interface HostAgentConfig {
  hostLabel: string;
  advertisedCapacityBytes: number;
  defaultQuotaBytes: number;
  defaultWarningThresholdPercent: number;
  defaultCriticalThresholdPercent: number;
  bandwidthCapBytesPerSecond: number;
}

export interface HostAgentHealthAllocation {
  allocId: string;
  state: AllocState;
  quotaMode: QuotaMode;
  quotaBytes: number;
  usedBytes: number;
  freeBytes: number;
  warningThresholdPercent: number;
  criticalThresholdPercent: number;
  quotaState: QuotaState;
  quotaEnforcedSuspend: boolean;
  sftpAccessActive: boolean;
  lastOwnerWriteAt: string;
}

export interface HostAgentHealth {
  agentRunning: boolean;
  sftpRunning: boolean;
  sftpBindAddress: string;
  sftpPublicExposureWarning: boolean;
  overlayStatus: 'connected' | 'disconnected' | 'unconfigured';
  storageRootAvailable: boolean;
  allocations: HostAgentHealthAllocation[];
  recentEvents: HostAgentEvent[];
}

export interface HostAgentOverlayStatus {
  provider: string;
  mode: string;
  available: boolean;
  hostAddress: string;
  sftpExpectedHost: string;
  sftpPort: number;
  publicExposureWarning: boolean;
}

export interface HostAgentSftpStatus {
  running: boolean;
  bindAddress: string;
  port: number;
  publicExposureWarning: boolean;
  hostKeyFingerprintSha256: string;
  activeUserCount: number;
}

export interface HostAgentStorageStatus {
  storageRoot: string;
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  allocationCount: number;
}

export interface HostAgentAllocation {
  allocId: string;
  matchId: string;
  connectionName: string;
  username: string;
  state: AllocState;
  quotaMode: QuotaMode;
  quotaBytes: number;
  usedBytes: number;
  freeBytes: number;
  warningThresholdPercent: number;
  criticalThresholdPercent: number;
  quotaState: QuotaState;
  quotaEnforcedSuspend: boolean;
  sftpAccessActive: boolean;
  bandwidthCapBytesPerSecond: number;
  accessWindowEnabled: boolean;
  accessWindowStart: string;
  accessWindowEnd: string;
  accessWindowEnforcement: string;
  inviteExpiresAt: string | null;
  inviteExportedAt: string | null;
  retirementGraceDays: number;
  retirementInitiatedAt: string | null;
  suspendedAt: string | null;
  lastOwnerWriteAt: string;
  createdAt: string;
}

export interface HostAgentInviteBundle {
  bundleVersion: number;
  kind: string;
  hostAgentVersion: string;
  matchId: string;
  allocId: string;
  connectionName: string;
  overlay: {
    provider: string;
    host: string;
    note: string;
  };
  sftp: {
    host: string;
    port: number;
    username: string;
    path: string;
  };
  quota: {
    quotaBytes: number;
    quotaMode: string;
  };
  hostKey: {
    fingerprintSha256: string;
    verificationNote: string;
  };
  expiresAt: string;
}

export interface OwnerAccessResponse {
  bundleVersion: number;
  kind: 'nasbb.owner_access_response';
  matchId: string;
  allocId: string;
  ownerDeviceLabel: string;
  ownerPublicKey: string;
  requestedSftpUsername: string;
  createdAt: string;
}

export interface HostAgentEvent {
  eventId: string;
  timestamp: string;
  kind: string;
  allocId: string;
  message: string;
}

export interface HostAgentError {
  error: string;
  code: string;
}

// ── Request types ─────────────────────────────────────────────────────────────

export interface CreateAllocationRequest {
  connectionName: string;
  quotaBytes: number;
  bandwidthCapBytesPerSecond: number;
  accessWindowEnabled: boolean;
  accessWindowStart: string;
  accessWindowEnd: string;
}

export interface PatchAllocationRequest {
  connectionName?: string;
  quotaBytes?: number;
  bandwidthCapBytesPerSecond?: number;
  warningThresholdPercent?: number;
  criticalThresholdPercent?: number;
  accessWindowEnabled?: boolean;
  accessWindowStart?: string;
  accessWindowEnd?: string;
  retirementGraceDays?: number;
}

// ── Tauri command result types ────────────────────────────────────────────────

export interface HostPrereqResult {
  docker_available: boolean;
  docker_version: string | null;
  compose_available: boolean;
  compose_version: string | null;
  compose_dir: string | null;
  error: string | null;
}

export interface HostEnvValues {
  NASBB_API_PORT: string;
  NASBB_API_TOKEN: string;
  NASBB_SFTP_PORT: string;
  NASBB_SFTP_BIND: string;
  TAILSCALE_ADDRESS: string;
}

export interface ComposeServiceStatus {
  name: string;
  state: string;
  status: string;
}

export interface ComposeStatus {
  services: ComposeServiceStatus[];
  error: string | null;
}

export interface ComposeLogs {
  agent_logs: string;
  sftp_logs: string;
  error: string | null;
}

export interface VerifyResult {
  output: string;
  passed: boolean;
  error: string | null;
}

// ── Persisted host tab state ──────────────────────────────────────────────────

export interface HostTabPersistedState {
  hostAgentApiUrl: string;
  hostAgentToken: string;
  lastKnownEnv: Partial<HostEnvValues>;
  lastSelectedTailscaleAddress: string;
  lastSelectedSftpBind: string;
  lastHostSetupCompletedAt: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function classifyReachability(env: Partial<HostEnvValues>): ReachabilityClass {
  const bind = env.NASBB_SFTP_BIND?.trim() ?? '127.0.0.1';
  const addr = env.TAILSCALE_ADDRESS?.trim() ?? '';
  if (bind === '0.0.0.0') return 'unsafe_public';
  if (addr && bind === '127.0.0.1') return 'advertised_blocked';
  if (!addr && (bind === '127.0.0.1' || !bind)) return 'local_test_only';
  if (addr && bind && bind !== '127.0.0.1' && bind !== '0.0.0.0') return 'overlay_ready';
  return 'unknown';
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[Math.min(i, units.length - 1)]}`;
}

export function generateSecureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
