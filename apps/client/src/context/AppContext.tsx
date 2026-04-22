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
  runRealBackupFromConfig,
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
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppContextProvider({ children }: { children: React.ReactNode }) {
  const [setupState, setSetupState] = useState<ClientSetupState>(DEFAULT_SETUP_STATE);
  const [healthReport, setHealthReport] = useState<HealthReport>(DEFAULT_HEALTH_REPORT);
  const [readiness, setReadiness] = useState<IntegrationCheckResult | null>(null);
  const [wizardConfigs, setWizardConfigs] = useState<SetupDraftConfig[]>([]);
  const [masterPasswordSet, setMasterPasswordSetState] = useState(false);
  const [repoJobStatuses, setRepoJobStatuses] = useState<Record<number, RepoJobStatus>>({});
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
        if (last?.repository_path) {
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
      }
      if (saved.recoveryKeyConfirmed) setRecoveryKeyConfirmed(saved.recoveryKeyConfirmed);
      if (saved.healthReportConsent) setHealthReportConsent(saved.healthReportConsent);
      if (saved.offlineMode) setOfflineMode(saved.offlineMode);
    }).finally(() => setPersistedLoaded(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save wizardConfigs to disk whenever they change (after initial load)
  useEffect(() => {
    if (!persistedLoaded) return;
    void savePersistedConfig({ wizardConfigs });
  }, [wizardConfigs, persistedLoaded]);

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
    if (!config?.repository_path) return;

    const blank: RepoJobStatus = { init_state: 'idle', backup_state: 'idle', last_snapshot_at: null, snapshot_count: 0, error: null };

    const setStatus = (patch: Partial<RepoJobStatus>) =>
      setRepoJobStatuses(prev => ({
        ...prev,
        [configIndex]: { ...blank, ...prev[configIndex], ...patch },
      }));

    setStatus({ init_state: 'running', backup_state: 'idle', error: null });
    try {
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
    } catch (e: unknown) {
      setStatus({ init_state: 'error', backup_state: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  // Append the wizard draft to the list and sync role into setupState.
  // Deduplicates by repository_path — re-running the wizard for the same path
  // updates the existing entry rather than adding a duplicate.
  const applyWizardConfig = useCallback((draft: SetupDraftConfig) => {
    setWizardConfigs(prev => {
      const idx = prev.findIndex(c => c.repository_path === draft.repository_path);
      let next: SetupDraftConfig[];
      if (idx >= 0) {
        next = [...prev];
        next[idx] = draft;
      } else {
        next = [...prev, draft];
        // Auto-trigger backup for the new config if password is already set
        const newIdx = next.length - 1;
        if (masterPasswordSet) {
          // Delay slightly so wizardConfigsRef is updated before triggerRepoBackup reads it
          setTimeout(() => { void triggerRepoBackup(newIdx); }, 50);
        }
      }
      return next;
    });
    setSetupState(prev => ({
      ...prev,
      role: draft.role,
      // Repository status resets when config changes — user needs to re-run check
      kopia_repository: {
        ...prev.kopia_repository,
        status: draft.repository_path ? 'configured' : 'not_configured',
      },
    }));
  }, []);

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
