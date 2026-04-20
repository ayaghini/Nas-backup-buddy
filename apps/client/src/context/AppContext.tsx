import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type {
  ClientSetupState,
  HealthReport,
  IntegrationCheckResult,
  MockCheckResult,
  MockDrillResult,
  SetupDraftConfig,
  ToolStatus,
} from '../lib/types';
import {
  DEFAULT_HEALTH_REPORT,
  DEFAULT_SETUP_STATE,
  SAMPLE_LOG_LINES,
} from '../lib/mock-state';
import { getSetupReadiness, getToolStatus } from '../lib/tauri-bridge';

interface AppContextValue {
  // State
  setupState: ClientSetupState;
  healthReport: HealthReport;
  readiness: IntegrationCheckResult | null;
  wizardConfig: SetupDraftConfig | null;
  offlineMode: boolean;
  healthReportConsent: boolean;
  recoveryKeyConfirmed: boolean;
  logLines: Array<{ raw: string; redacted: string }>;
  toolStatus: { kopia: string; syncthing: string };

  // Actions
  setOfflineMode: (v: boolean) => void;
  setHealthReportConsent: (v: boolean) => void;
  setRecoveryKeyConfirmed: (v: boolean) => void;
  applyWizardConfig: (draft: SetupDraftConfig) => void;
  addLogLine: (raw: string, redacted: string) => void;
  updateHealthFromCheckResult: (result: MockCheckResult) => void;
  updateHealthFromDrillResult: (result: MockDrillResult) => void;
  refreshReadiness: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppContextProvider({ children }: { children: React.ReactNode }) {
  const [setupState, setSetupState] = useState<ClientSetupState>(DEFAULT_SETUP_STATE);
  const [healthReport, setHealthReport] = useState<HealthReport>(DEFAULT_HEALTH_REPORT);
  const [readiness, setReadiness] = useState<IntegrationCheckResult | null>(null);
  const [wizardConfig, setWizardConfig] = useState<SetupDraftConfig | null>(null);
  const [offlineMode, setOfflineMode] = useState(true);
  const [healthReportConsent, setHealthReportConsent] = useState(false);
  const [recoveryKeyConfirmed, setRecoveryKeyConfirmed] = useState(false);
  const [logLines, setLogLines] = useState(SAMPLE_LOG_LINES);
  const [toolStatus, setToolStatus] = useState({ kopia: 'missing', syncthing: 'missing' });

  // Ref to always have the latest setupState in callbacks without stale closures
  const setupStateRef = useRef(setupState);
  useEffect(() => { setupStateRef.current = setupState; }, [setupState]);

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

  // Store the full wizard draft and sync role + offline_mode into setupState
  const applyWizardConfig = useCallback((draft: SetupDraftConfig) => {
    setWizardConfig(draft);
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
  const updateHealthFromCheckResult = useCallback((result: MockCheckResult) => {
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
  // restore_drill_age_days = 0 means just passed, -1 means failed/never run.
  const updateHealthFromDrillResult = useCallback((result: MockDrillResult) => {
    setHealthReport(prev => ({
      ...prev,
      restore_drill_age_days: result.result === 'pass' ? 0 : -1,
    }));
  }, []);

  const addLogLine = useCallback((raw: string, redacted: string) => {
    setLogLines(prev => [{ raw, redacted }, ...prev.slice(0, 99)]);
  }, []);

  const handleSetRecoveryKeyConfirmed = useCallback((v: boolean) => {
    setRecoveryKeyConfirmed(v);
    setSetupState(prev => ({ ...prev, recovery_key_confirmed: v }));
  }, []);

  const handleSetHealthReportConsent = useCallback((v: boolean) => {
    setHealthReportConsent(v);
    setSetupState(prev => ({ ...prev, health_report_consent: v }));
  }, []);

  const handleSetOfflineMode = useCallback((v: boolean) => {
    setOfflineMode(v);
    setSetupState(prev => ({ ...prev, offline_mode: v }));
  }, []);

  return (
    <AppContext.Provider value={{
      setupState,
      healthReport,
      readiness,
      wizardConfig,
      offlineMode,
      healthReportConsent,
      recoveryKeyConfirmed,
      logLines,
      toolStatus,
      setOfflineMode: handleSetOfflineMode,
      setHealthReportConsent: handleSetHealthReportConsent,
      setRecoveryKeyConfirmed: handleSetRecoveryKeyConfirmed,
      applyWizardConfig,
      addLogLine,
      updateHealthFromCheckResult,
      updateHealthFromDrillResult,
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
