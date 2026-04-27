import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type {
  ClientSetupState,
  HealthReport,
  IntegrationCheckResult,
  RealBackupResult,
  RealCheckResult,
  RealDrillResult,
  RepoJobStatus,
  SetupDraftConfig,
  SyncthingLiveStatus,
  TestLabInfo,
  ToolStatus,
  TransportFolderInfo,
} from '../lib/types';
import {
  DEFAULT_HEALTH_REPORT,
  DEFAULT_SETUP_STATE,
  SAMPLE_LOG_LINES,
} from '../lib/mock-state';
import {
  getRealHealthReport,
  getSetupReadiness,
  getToolStatus,
  hasKopiaPassword,
  initializeKopiaRepository,
  loadMasterPasswordFromKeychain,
  probeRemoteTarget,
  runRealBackupFromConfig,
  runRealSftpBackupFromConfig,
} from '../lib/tauri-bridge';
import { loadPersistedConfig, savePersistedConfig } from '../lib/persistence';

export interface RealLabState {
  lab: TestLabInfo | null;
  backup: RealBackupResult | null;
  transport: TransportFolderInfo | null;
  check: RealCheckResult | null;
  drill: RealDrillResult | null;
}

interface AppContextValue {
  // State
  setupState: ClientSetupState;
  healthReport: HealthReport;
  readiness: IntegrationCheckResult | null;
  /** All wizard runs accumulated — each run adds an entry. */
  wizardConfigs: SetupDraftConfig[];
  /** Convenience alias: the last wizard config, or null if none. */
  wizardConfig: SetupDraftConfig | null;
  /** Whether a master encryption password has been set this session. */
  masterPasswordSet: boolean;
  /** Per-repo job statuses keyed by wizardConfigs index. */
  repoJobStatuses: Record<number, RepoJobStatus>;
  /** Live Syncthing status polled every 15 s. Null until first poll completes. */
  syncthingLiveStatus: SyncthingLiveStatus | null;
  offlineMode: boolean;
  healthReportConsent: boolean;
  recoveryKeyConfirmed: boolean;
  logLines: Array<{ raw: string; redacted: string }>;
  toolStatus: { kopia: string; syncthing: string };
  realLab: RealLabState;

  // Actions
  setOfflineMode: (v: boolean) => void;
  setHealthReportConsent: (v: boolean) => void;
  setRecoveryKeyConfirmed: (v: boolean) => void;
  setMasterPasswordSet: (v: boolean) => void;
  applyWizardConfig: (draft: SetupDraftConfig) => void;
  /** Init + backup for the config at wizardConfigs[index]. */
  triggerRepoBackup: (configIndex: number) => Promise<void>;
  addLogLine: (raw: string, redacted: string) => void;
  updateHealthFromCheckResult: (result: Pick<RealCheckResult, 'passed'>) => void;
  updateHealthFromDrillResult: (result: Pick<RealDrillResult, 'result'>) => void;
  updateKopiaRepositoryFromBackup: (result: Pick<RealBackupResult, 'timestamp'>) => void;
  updateRealLab: (patch: Partial<RealLabState>) => void;
  refreshRealHealth: () => Promise<void>;
  refreshReadiness: () => void;
  /**
   * Update shared remote repository state after a probe or connect operation.
   * Propagates to Health Checks and Protected gate automatically.
   *
   * @param status  The new remote target status string (e.g. 'reachable', 'unreachable').
   * @param lastOkHours  Hours since last successful connection. 0 = just connected. -1 = never.
   */
  updateRemoteRepositoryState: (status: string, lastOkHours: number) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppContextProvider({ children }: { children: React.ReactNode }) {
  const [setupState, setSetupState] = useState<ClientSetupState>(DEFAULT_SETUP_STATE);
  const [healthReport, setHealthReport] = useState<HealthReport>(DEFAULT_HEALTH_REPORT);
  const [readiness, setReadiness] = useState<IntegrationCheckResult | null>(null);
  const [wizardConfigs, setWizardConfigs] = useState<SetupDraftConfig[]>([]);
  const [masterPasswordSet, setMasterPasswordSetState] = useState(false);
  const [repoJobStatuses, setRepoJobStatuses] = useState<Record<number, RepoJobStatus>>({});
  const [syncthingLiveStatus] = useState<SyncthingLiveStatus | null>(null);
  // True once the persisted store has been loaded into state (prevents saving before loading)
  const [persistedLoaded, setPersistedLoaded] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [healthReportConsent, setHealthReportConsent] = useState(false);
  const [recoveryKeyConfirmed, setRecoveryKeyConfirmed] = useState(false);
  const [logLines, setLogLines] = useState(SAMPLE_LOG_LINES);
  const [toolStatus, setToolStatus] = useState({ kopia: 'missing', syncthing: 'missing' });
  const [realLab, setRealLab] = useState<RealLabState>({
    lab: null,
    backup: null,
    transport: null,
    check: null,
    drill: null,
  });

  // Refs to avoid stale closures in async callbacks
  const setupStateRef = useRef(setupState);
  useEffect(() => { setupStateRef.current = setupState; }, [setupState]);
  const wizardConfigsRef = useRef(wizardConfigs);
  useEffect(() => { wizardConfigsRef.current = wizardConfigs; }, [wizardConfigs]);
  const masterPasswordSetRef = useRef(masterPasswordSet);
  useEffect(() => { masterPasswordSetRef.current = masterPasswordSet; }, [masterPasswordSet]);

  // On mount: try to load the password from the OS keychain first.
  // Falls back to checking whether it was already set in this process session.
  // This covers the "app restarted" case — the Rust startup hook also tries
  // the keychain, so by the time this runs hasKopiaPassword() may already be true.
  useEffect(() => {
    async function initPassword() {
      try {
        const loaded = await loadMasterPasswordFromKeychain();
        if (loaded) { setMasterPasswordSetState(true); return; }
      } catch { /* keychain unavailable — fall through */ }
      try {
        const already = await hasKopiaPassword();
        setMasterPasswordSetState(already);
      } catch { /* no-op */ }
    }
    void initPassword();
  }, []);

  // On mount: restore persisted configuration from disk
  useEffect(() => {
    loadPersistedConfig().then(saved => {
      if (saved.wizardConfigs?.length) {
        setWizardConfigs(saved.wizardConfigs);
        // Derive setup state from the last wizard config so the readiness
        // check doesn't show "Kopia repository not configured" on restart.
        const last = saved.wizardConfigs[saved.wizardConfigs.length - 1];
        if (last?.repository_path || last?.overlay_host) {
          setSetupState(prev => ({
            ...prev,
            role: last.role,
            kopia_repository: {
              ...prev.kopia_repository,
              status: prev.kopia_repository.status === 'not_configured'
                ? 'configured'
                : prev.kopia_repository.status,
            },
          }));
        }

        // If the last config has SFTP fields, run a lightweight TCP probe to
        // restore remote_repository state after restart. This avoids showing
        // "not_configured" on the dashboard when a peer is configured but the
        // probe state was lost at shutdown.
        const last2 = saved.wizardConfigs[saved.wizardConfigs.length - 1];
        if (last2?.overlay_host?.trim()) {
          const host = last2.overlay_host.trim();
          const port = last2.sftp_port || 22;
          probeRemoteTarget(host, port).then(result => {
            const sharedStatus =
              result.status === 'tcp_port_reachable' ? 'reachable' : result.status;
            const lastOk = result.status === 'tcp_port_reachable' ? 0 : -1;
            setSetupState(prev => ({
              ...prev,
              remote_repository: { status: sharedStatus as 'reachable' | 'unreachable' | 'not_configured' | 'auth_failed' | 'host_key_mismatch' | 'quota_warning' | 'error', last_ok_hours: lastOk },
            }));
            setHealthReport(prev => ({
              ...prev,
              remote_target_status: sharedStatus as typeof prev.remote_target_status,
              remote_target_last_ok_hours: lastOk,
            }));
          }).catch(() => { /* probe failure is non-fatal on startup */ });
        }
      }
      if (saved.syncthingConfigured) {
        setSetupState(prev => ({
          ...prev,
          syncthing_folder: {
            ...prev.syncthing_folder,
            state: prev.syncthing_folder.state === 'not_configured'
              ? 'folder_configured'
              : prev.syncthing_folder.state,
          },
        }));
      }
      if (saved.recoveryKeyConfirmed) setRecoveryKeyConfirmed(saved.recoveryKeyConfirmed);
      if (saved.healthReportConsent) setHealthReportConsent(saved.healthReportConsent);
      if (saved.offlineMode) setOfflineMode(saved.offlineMode);
    }).finally(() => setPersistedLoaded(true));
  }, []);

  // Save wizardConfigs to disk whenever they change (after initial load)
  useEffect(() => {
    if (!persistedLoaded) return;
    void savePersistedConfig({ wizardConfigs });
  }, [wizardConfigs, persistedLoaded]);

  // Syncthing live polling is intentionally disabled in the default v1 path.
  // Kopia over SFTP on Tailscale is the primary transport; the Syncthing route
  // remains available only as a developer/legacy experiment.

  // On mount: detect real tool status and update setup state
  useEffect(() => {
    getToolStatus().then(status => {
      setToolStatus(status);
      setSetupState(prev => ({
        ...prev,
        kopia_tool_status: status.kopia as ToolStatus,
        syncthing_tool_status: status.syncthing as ToolStatus,
      }));
    });
  }, []);

  // Recompute readiness whenever setupState or recoveryKeyConfirmed changes
  useEffect(() => {
    const merged: ClientSetupState = {
      ...setupState,
      recovery_key_confirmed: recoveryKeyConfirmed,
      health_report_consent: healthReportConsent,
      offline_mode: offlineMode,
    };
    getSetupReadiness(merged).then(setReadiness);
  }, [setupState, recoveryKeyConfirmed, healthReportConsent, offlineMode]);

  const refreshReadiness = useCallback(() => {
    const merged: ClientSetupState = {
      ...setupStateRef.current,
      recovery_key_confirmed: recoveryKeyConfirmed,
      health_report_consent: healthReportConsent,
      offline_mode: offlineMode,
    };
    getSetupReadiness(merged).then(setReadiness);
  }, [recoveryKeyConfirmed, healthReportConsent, offlineMode]);

  const setMasterPasswordSet = useCallback((v: boolean) => {
    setMasterPasswordSetState(v);
    // Password set implies the user has it and we consider it confirmed.
    // The separate checkbox is removed — masterPasswordSet IS the confirmation.
    if (v) {
      setRecoveryKeyConfirmed(true);
      setSetupState(prev => ({ ...prev, recovery_key_confirmed: true }));
      void savePersistedConfig({ recoveryKeyConfirmed: true });
    }
  }, []);

  const triggerRepoBackup = useCallback(async (configIndex: number) => {
    const configs = wizardConfigsRef.current;
    const config = configs[configIndex];

    // Require either an SFTP target or a local repository path.
    const isSftp = !!(config?.overlay_host?.trim());
    const isLocal = !!(config?.repository_path);
    if (!config || (!isSftp && !isLocal)) return;

    const blank: RepoJobStatus = { init_state: 'idle', backup_state: 'idle', last_snapshot_at: null, snapshot_count: 0, error: null };

    const setStatus = (patch: Partial<RepoJobStatus>) =>
      setRepoJobStatuses(prev => ({
        ...prev,
        [configIndex]: { ...blank, ...prev[configIndex], ...patch },
      }));

    setStatus({ init_state: 'running', backup_state: 'idle', error: null });
    try {
      if (isSftp) {
        // SFTP path: repository must already be connected (via Peer Storage tab).
        // Skip init step — just run the snapshot directly.
        setStatus({ init_state: 'done', backup_state: 'running' });
        const result = await runRealSftpBackupFromConfig(
          config.source_folders,
          config.overlay_host.trim(),
          config.sftp_user.trim(),
          config.sftp_path.trim(),
          config.sftp_port || 22,
          config.ssh_key_ref.trim() || null,
        );
        setRepoJobStatuses(prev => {
          const current = prev[configIndex] ?? blank;
          return {
            ...prev,
            [configIndex]: { ...current, backup_state: 'done', last_snapshot_at: result.timestamp, snapshot_count: current.snapshot_count + 1 },
          };
        });
      } else {
        // Local filesystem path (test lab / legacy mode)
        await initializeKopiaRepository(config.repository_path);
        setStatus({ init_state: 'done', backup_state: 'running' });
        const result = await runRealBackupFromConfig(config.source_folders, config.repository_path);
        setRepoJobStatuses(prev => {
          const current = prev[configIndex] ?? blank;
          return {
            ...prev,
            [configIndex]: { ...current, backup_state: 'done', last_snapshot_at: result.timestamp, snapshot_count: current.snapshot_count + 1 },
          };
        });
      }
    } catch (e: unknown) {
      setStatus({ init_state: 'error', backup_state: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  // Append the wizard draft to the list and sync role into setupState.
  // Deduplicates by SFTP target (overlay_host + sftp_path) when set,
  // falling back to repository_path for legacy local-mode configs.
  const applyWizardConfig = useCallback((draft: SetupDraftConfig) => {
    setWizardConfigs(prev => {
      // Determine the dedup key: prefer SFTP target for v1 configs
      const draftKey = draft.overlay_host
        ? `sftp:${draft.overlay_host.trim()}:${draft.sftp_path.trim()}`
        : `local:${draft.repository_path}`;
      const idx = prev.findIndex(c => {
        const cKey = c.overlay_host
          ? `sftp:${c.overlay_host.trim()}:${c.sftp_path.trim()}`
          : `local:${c.repository_path}`;
        return cKey === draftKey;
      });
      let next: SetupDraftConfig[];
      if (idx >= 0) {
        next = [...prev];
        next[idx] = draft;
      } else {
        next = [...prev, draft];
        // Auto-trigger backup for the new config if password is already set
        const newIdx = next.length - 1;
        if (masterPasswordSetRef.current) {
          // Delay slightly so wizardConfigsRef is updated before triggerRepoBackup reads it
          setTimeout(() => { void triggerRepoBackup(newIdx); }, 50);
        }
      }
      return next;
    });
    setSetupState(prev => ({
      ...prev,
      role: draft.role,
      // Repository status: configured when either local path or SFTP target is set
      kopia_repository: {
        ...prev.kopia_repository,
        status: (draft.repository_path || draft.overlay_host) ? 'configured' : 'not_configured',
      },
    }));
  }, [triggerRepoBackup]);

  // Update health report + kopia repository status when a check result arrives
  const updateHealthFromCheckResult = useCallback((result: Pick<RealCheckResult, 'passed'>) => {
    setHealthReport(prev => ({ ...prev, repository_check_ok: result.passed }));
    setSetupState(prev => ({
      ...prev,
      kopia_repository: {
        ...prev.kopia_repository,
        status: result.passed ? 'check_passed' : 'check_failed',
      },
    }));
  }, []);

  // Update health report when a restore drill result arrives.
  const updateHealthFromDrillResult = useCallback((result: Pick<RealDrillResult, 'result'>) => {
    setHealthReport(prev => ({
      ...prev,
      restore_drill_age_days: result.result === 'pass' ? 0 : -1,
    }));
  }, []);

  // Update kopia_repository state after a real backup completes.
  // Marks the repo as initialized and records the snapshot timestamp.
  const updateKopiaRepositoryFromBackup = useCallback((result: Pick<RealBackupResult, 'timestamp'>) => {
    setSetupState(prev => ({
      ...prev,
      kopia_repository: {
        ...prev.kopia_repository,
        status: 'initialized',
        last_snapshot_at: result.timestamp,
        snapshot_count: (prev.kopia_repository.snapshot_count ?? 0) + 1,
      },
    }));
  }, []);

  const updateRealLab = useCallback((patch: Partial<RealLabState>) => {
    setRealLab(prev => ({ ...prev, ...patch }));
  }, []);

  const refreshRealHealth = useCallback(async () => {
    const report = await getRealHealthReport();
    setHealthReport(report);
  }, []);

  // Update shared remote repository state after probe or connect.
  // Propagates to Health Checks and Protected gate through setupState change.
  const updateRemoteRepositoryState = useCallback((status: string, lastOkHours: number) => {
    const remoteState = { status: status as ClientSetupState['remote_repository']['status'], last_ok_hours: lastOkHours };
    setSetupState(prev => ({ ...prev, remote_repository: remoteState }));
    setHealthReport(prev => ({
      ...prev,
      remote_target_status: status as typeof prev.remote_target_status,
      remote_target_last_ok_hours: lastOkHours,
    }));
    // Readiness re-evaluation is triggered by the setupState change via the existing useEffect.
  }, []);

  const addLogLine = useCallback((raw: string, redacted: string) => {
    setLogLines(prev => [{ raw, redacted }, ...prev.slice(0, 99)]);
  }, []);

  const handleSetRecoveryKeyConfirmed = useCallback((v: boolean) => {
    setRecoveryKeyConfirmed(v);
    setSetupState(prev => ({ ...prev, recovery_key_confirmed: v }));
    void savePersistedConfig({ recoveryKeyConfirmed: v });
  }, []);

  const handleSetHealthReportConsent = useCallback((v: boolean) => {
    setHealthReportConsent(v);
    setSetupState(prev => ({ ...prev, health_report_consent: v }));
    void savePersistedConfig({ healthReportConsent: v });
  }, []);

  const handleSetOfflineMode = useCallback((v: boolean) => {
    setOfflineMode(v);
    setSetupState(prev => ({ ...prev, offline_mode: v }));
    void savePersistedConfig({ offlineMode: v });
  }, []);

  const wizardConfig = wizardConfigs.length > 0 ? wizardConfigs[wizardConfigs.length - 1] : null;

  return (
    <AppContext.Provider value={{
      setupState,
      healthReport,
      readiness,
      wizardConfigs,
      wizardConfig,
      masterPasswordSet,
      repoJobStatuses,
      syncthingLiveStatus,
      offlineMode,
      healthReportConsent,
      recoveryKeyConfirmed,
      logLines,
      toolStatus,
      realLab,
      setOfflineMode: handleSetOfflineMode,
      setHealthReportConsent: handleSetHealthReportConsent,
      setRecoveryKeyConfirmed: handleSetRecoveryKeyConfirmed,
      setMasterPasswordSet,
      applyWizardConfig,
      triggerRepoBackup,
      addLogLine,
      updateHealthFromCheckResult,
      updateHealthFromDrillResult,
      updateKopiaRepositoryFromBackup,
      updateRealLab,
      refreshRealHealth,
      refreshReadiness,
      updateRemoteRepositoryState,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppContextProvider');
  return ctx;
}
