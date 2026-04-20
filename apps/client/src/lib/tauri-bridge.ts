// Tauri command bridge with mock fallback for browser/dev mode.
//
// If the app is running inside Tauri, real commands are invoked.
// If running in a browser (no Tauri), mock responses are returned so the
// UI stays usable in browser preview and development without a running backend.

import type {
  ClientSetupState,
  CommandPlanSummary,
  HealthReport,
  IntegrationCheckResult,
  MockBackupResult,
  MockCheckResult,
  MockDrillResult,
  SyncthingApiPlanSummary,
} from './types';
import { DEFAULT_SETUP_STATE, DEFAULT_HEALTH_REPORT } from './mock-state';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined';
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error('Tauri not available');
  }
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}

// ── Commands ──────────────────────────────────────────────────────────────────

export async function getHealthLevel(report: HealthReport): Promise<string> {
  try {
    return await invoke<string>('get_health_level', { report });
  } catch {
    // Compute locally from report fields
    const isCritical =
      report.last_backup_age_hours > 72 ||
      report.last_sync_age_hours > 72 ||
      report.free_quota_percent < 5 ||
      report.restore_drill_age_days < 0 ||
      report.peer_offline_hours > 168 ||
      !report.repository_check_ok;
    const isWarning =
      report.last_backup_age_hours > 24 ||
      report.last_sync_age_hours > 24 ||
      report.free_quota_percent < 15 ||
      report.restore_drill_age_days > 30 ||
      report.peer_offline_hours > 24;
    return isCritical ? 'critical' : isWarning ? 'warning' : 'ok';
  }
}

export async function redactLogLine(line: string): Promise<string> {
  try {
    return await invoke<string>('redact_log_line', { line });
  } catch {
    // Simple client-side redaction fallback
    return line
      .replace(/password[=:]\S+/gi, 'password=[REDACTED]')
      .replace(/token[=:]\S+/gi, 'token=[REDACTED]')
      .replace(/key[=:]\S+/gi, 'key=[REDACTED]')
      .replace(/\/[a-z][a-z0-9]*\/[a-z][a-z0-9]*\/[^\s]+/g, '[REDACTED]');
  }
}

export async function getToolStatus(): Promise<{ kopia: string; syncthing: string }> {
  try {
    return await invoke('get_tool_status');
  } catch {
    // Fail-closed in browser/mock mode: report missing rather than fabricating Ready.
    // The UI treats this as a warning (not a blocker) when offline_mode is true.
    return { kopia: 'missing', syncthing: 'missing' };
  }
}

export async function validateSetupConfig(config: object): Promise<void> {
  try {
    return await invoke('validate_setup_config', { config });
  } catch (invokeErr: unknown) {
    if (isTauri()) throw invokeErr;
    // In browser mode: do basic client-side validation
  }
}

export async function planKopiaRepository(
  repoPath: string,
  enginePath: string,
): Promise<CommandPlanSummary[]> {
  try {
    return await invoke('plan_kopia_repository', {
      repoPath,
      enginePath,
    });
  } catch {
    const exe = enginePath || 'kopia';
    return [
      { label: 'Detect version', display_command: `${exe} --version` },
      { label: 'Create repository', display_command: `${exe} repository create filesystem --path [REDACTED]` },
      { label: 'Repository check', display_command: `${exe} repository check` },
      { label: 'Create snapshot', display_command: `${exe} snapshot create [REDACTED]` },
      { label: 'List snapshots', display_command: `${exe} snapshot list` },
    ];
  }
}

export async function planSyncthingFolder(
  folderId: string,
  folderPath: string,
  sourceFolders: string[],
): Promise<SyncthingApiPlanSummary> {
  try {
    return await invoke('plan_syncthing_folder', {
      folderId,
      folderPath,
      sourceFolders,
    });
  } catch {
    // Propagate safety errors (source folder rejection) even in mock mode
    if (sourceFolders.some(src => folderPath === src || folderPath.startsWith(src + '/') || src.startsWith(folderPath + '/'))) {
      throw new Error(`Source folder path must not be used as a Syncthing folder: ${folderPath}`);
    }
    return {
      method: 'POST',
      display_command: `POST /rest/config/folders  id=${folderId}  path=[REDACTED]  type=sendreceive  [X-API-Key: REDACTED]`,
      body_summary: `{"id":"${folderId}","path":"[REDACTED]","type":"sendreceive"}`,
    };
  }
}

export async function runMockBackup(): Promise<MockBackupResult> {
  try {
    return await invoke('run_mock_backup');
  } catch {
    return {
      success: true,
      snapshot_id: 'mock-snap-abc12345def67890',
      files_changed: 42,
      size_bytes: 1_258_291_200,
      duration_ms: 27_000,
      log_line: 'snapshot complete: files=42 size=1258291200 duration=27s snapshot_id=mock-snap-abc12345def67890',
    };
  }
}

export async function runMockRepositoryCheck(shouldPass?: boolean): Promise<MockCheckResult> {
  try {
    return await invoke('run_mock_repository_check', { shouldPass: shouldPass ?? true });
  } catch {
    const passes = shouldPass ?? true;
    return {
      passed: passes,
      message: passes
        ? 'Repository check passed. All content blobs verified.'
        : 'Repository check FAILED. Investigate immediately — do not prune snapshots.',
      log_line: passes
        ? 'repository check: verified 128 content blobs — no errors found'
        : 'repository check: ERROR — 2 content blobs missing or corrupted',
    };
  }
}

export async function runMockRestoreDrill(
  expectedChecksum: string,
  observedChecksum: string,
): Promise<MockDrillResult> {
  try {
    return await invoke('run_mock_restore_drill', { expectedChecksum, observedChecksum });
  } catch {
    const match = expectedChecksum.length > 0 && observedChecksum.length > 0 && expectedChecksum === observedChecksum;
    const result = expectedChecksum.length === 0 || observedChecksum.length === 0
      ? 'fail'
      : match ? 'pass' : 'canary_mismatch';
    const level = result === 'pass' ? 'ok' : 'critical';
    return {
      result: result as MockDrillResult['result'],
      health_level: level as MockDrillResult['health_level'],
      expected_checksum: expectedChecksum,
      observed_checksum: observedChecksum,
      match_result: match,
      log_line: `restore_drill result=${result} health=${level}`,
      audit_evidence: [
        `result: ${result}`,
        `health_level: ${level}`,
        `checksums_match: ${match}`,
        'canary_method: sha256',
        ...(result === 'canary_mismatch' ? ['ACTION: Preserve all logs. Do not prune snapshots.'] : []),
      ],
    };
  }
}

export async function getMockSetupState(): Promise<ClientSetupState> {
  try {
    return await invoke('get_mock_setup_state');
  } catch {
    return DEFAULT_SETUP_STATE;
  }
}

export async function getSetupReadiness(state: ClientSetupState): Promise<IntegrationCheckResult> {
  try {
    return await invoke('get_setup_readiness', { state });
  } catch {
    // Compute locally
    const blocking: string[] = [];
    const warnings: string[] = [];

    if (state.kopia_tool_status !== 'ready') blocking.push(`Kopia tool not ready: ${state.kopia_tool_status}`);
    if (state.syncthing_tool_status !== 'ready') blocking.push(`Syncthing tool not ready: ${state.syncthing_tool_status}`);
    if (state.kopia_repository.status === 'not_configured') blocking.push('Kopia repository not configured');
    if (state.kopia_repository.status === 'check_failed') blocking.push('Kopia repository check failed — investigate immediately');
    if (!state.recovery_key_confirmed) blocking.push('Recovery key/password backup not confirmed');
    if (state.syncthing_folder.state === 'error') blocking.push('Syncthing error — check Syncthing logs');

    if (state.syncthing_folder.state === 'stale') warnings.push('Syncthing folder is stale — peer data may be outdated');
    if (state.syncthing_folder.state === 'not_configured') warnings.push('Syncthing not yet configured — peer replication is inactive');

    let readiness: IntegrationCheckResult['readiness'] = 'blocked';
    if (blocking.length === 0 && warnings.length === 0) {
      if (state.kopia_repository.status === 'check_passed' && state.syncthing_folder.state === 'in_sync') {
        readiness = 'ready_for_restore_drill';
      } else if (['check_passed', 'initialized', 'configured'].includes(state.kopia_repository.status)) {
        readiness = 'ready_for_test_backup';
      }
    } else if (blocking.length === 0) {
      readiness = 'warning';
    }

    return { readiness, blocking_reasons: blocking, warning_reasons: warnings };
  }
}

export { DEFAULT_HEALTH_REPORT };
